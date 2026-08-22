#!/usr/bin/env bash
#
# provision_ssm.sh — write SecureString parameters to AWS SSM Parameter Store for one
# service in one environment, sourcing values from an env file.
#
# Smoke-test carefully before trusting it against a production account: it writes
# secrets and is prod-capable (irreversible).
#
# Every site-specific value — region, accounts, KMS keys, SSO profiles, path convention —
# comes from ~/.claude/infra-workflows.config.json (see the plugin's config.example.json).
# Nothing about a particular employer is baked into this file.
#
# Sequence:
#   1. Auth — per-environment: an SSO profile, or exported temporary STS credentials.
#      Either way the resolved identity is checked against the configured account ID,
#      so a stale AWS_PROFILE or the wrong exported creds cannot silently hit
#      another account.
#   2. One `aws ssm put-parameter` per KEY=VALUE in the env file, written under the
#      configured path prefix as SecureString with that environment's KMS key,
#      --overwrite so reruns are idempotent, retrying without --key-id if KMS rejects it.
#   3. A verification listing of the path (names only).
#
# Safety contract:
#   - Requires an explicit --confirm flag before ANY put-parameter call.
#   - Never echoes secret VALUES to stdout — only parameter NAMES.
#
# Usage:
#   provision_ssm.sh --env <env> --service <slug> --env-file <path> [--confirm]
#
set -euo pipefail

readonly CONFIG_PATH="${INFRA_WORKFLOWS_CONFIG:-$HOME/.claude/infra-workflows.config.json}"

environment=""
service=""
envFile=""
confirmed="false"

region=""
accountId=""
authMode=""
profile=""
kmsKey=""
pathPrefix=""
declare -a awsArgs=()

main() {
  parseArguments "$@"
  validateArguments
  loadConfig
  authenticate
  local -a parameterNames=()
  local parameterName
  while IFS= read -r parameterName; do
    parameterNames+=("$parameterName")
  done < <(extractParameterNames)
  if [[ "${#parameterNames[@]}" -eq 0 ]]; then
    echo "No KEY=VALUE pairs found in ${envFile}; nothing to provision." >&2
    exit 1
  fi
  printSummary "${parameterNames[@]}"
  requireConfirmation
  putAllParameters "${parameterNames[@]}"
  verify
}

parseArguments() {
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --env)      environment="${2:-}"; shift 2 ;;
      --service)  service="${2:-}";     shift 2 ;;
      --env-file) envFile="${2:-}";     shift 2 ;;
      --confirm)  confirmed="true";     shift ;;
      -h|--help)  sed -n '2,29p' "$0";  exit 0 ;;
      *) echo "unknown argument: $1" >&2; exit 1 ;;
    esac
  done
}

validateArguments() {
  if [[ -z "$environment" || -z "$service" || -z "$envFile" ]]; then
    echo "Usage: $0 --env <env> --service <slug> --env-file <path> [--confirm]" >&2
    exit 1
  fi
  if [[ ! -f "$envFile" ]]; then
    echo "Env file not found: ${envFile}" >&2
    exit 1
  fi
}

# Resolve every site-specific value up front, so the rest of the script is generic.
loadConfig() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required to read ${CONFIG_PATH}" >&2
    exit 1
  fi
  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "Config not found: ${CONFIG_PATH}" >&2
    echo "Copy the plugin's config.example.json there and fill in your accounts." >&2
    exit 1
  fi

  local env_json
  env_json="$(jq -r --arg e "$environment" '.ssm.environments[$e] // empty' "$CONFIG_PATH")"
  if [[ -z "$env_json" ]]; then
    echo "Environment '${environment}' is not defined under .ssm.environments in ${CONFIG_PATH}." >&2
    echo "Defined: $(jq -r '.ssm.environments | keys | join(", ")' "$CONFIG_PATH")" >&2
    exit 1
  fi

  region="$(jq -r '.ssm.region' "$CONFIG_PATH")"
  accountId="$(jq -r '.accountId // empty'  <<<"$env_json")"
  authMode="$( jq -r '.auth // "sso"'       <<<"$env_json")"
  profile="$(  jq -r '.profile // empty'    <<<"$env_json")"
  kmsKey="$(   jq -r '.kmsKey // empty'     <<<"$env_json")"

  local domain template
  domain="$(  jq -r '.ssm.domain // empty' "$CONFIG_PATH")"
  template="$(jq -r '.ssm.pathPrefix'      "$CONFIG_PATH")"
  pathPrefix="${template//\{domain\}/$domain}"
  pathPrefix="${pathPrefix//\{env\}/$environment}"
  pathPrefix="${pathPrefix//\{service\}/$service}"
  pathPrefix="${pathPrefix%/}"

  awsArgs=(--region "$region")
  if [[ "$authMode" == "sso" && -n "$profile" ]]; then
    awsArgs+=(--profile "$profile")
  fi
}

# A lingering AWS_PROFILE overrides exported keys and silently targets the wrong
# account, so clear it before resolving identity either way.
authenticate() {
  unset AWS_PROFILE

  if [[ "$authMode" == "sso" ]]; then
    echo "Verifying SSO session for profile ${profile}..." >&2
    if ! aws sts get-caller-identity "${awsArgs[@]}" >/dev/null 2>&1; then
      echo "SSO session expired; running 'aws sso login'..." >&2
      aws sso login --profile "$profile"
    fi
  else
    echo "Verifying identity from exported temporary STS credentials..." >&2
  fi

  assertExpectedAccount
}

assertExpectedAccount() {
  [[ -n "$accountId" ]] || return 0
  local actual
  actual="$(aws sts get-caller-identity "${awsArgs[@]}" --query "Account" --output text)"
  if [[ "$actual" != "$accountId" ]]; then
    echo "Refusing to continue: credentials target account ${actual}, expected ${environment} account ${accountId}." >&2
    if [[ "$authMode" == "sso" ]]; then
      echo "Re-run 'aws sso login --profile ${profile}'." >&2
    else
      echo "Run 'unset AWS_PROFILE' and re-export the ${environment} temporary STS credentials." >&2
    fi
    exit 1
  fi
}

extractParameterNames() {
  while IFS= read -r line || [[ -n "$line" ]]; do
    local trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in ''|'#'*) continue ;; esac
    [[ "$trimmed" == *=* ]] || continue
    echo "${trimmed%%=*}"
  done < "$envFile"
}

stripSurroundingQuotes() {
  local value="$1"
  if [[ "${#value}" -ge 2 ]]; then
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}";;
      \'*\') value="${value#\'}"; value="${value%\'}";;
    esac
  fi
  printf '%s' "$value"
}

readParameterValue() {
  local wantedKey="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    local trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in ''|'#'*) continue ;; esac
    [[ "$trimmed" == *=* ]] || continue
    if [[ "${trimmed%%=*}" == "$wantedKey" ]]; then
      stripSurroundingQuotes "${trimmed#*=}"
      return 0
    fi
  done < "$envFile"
  return 1
}

parameterPath() {
  echo "${pathPrefix}/$1"
}

printSummary() {
  local -a parameterNames=("$@")
  echo ""
  echo "About to provision ${#parameterNames[@]} SecureString parameter(s):"
  echo "  Environment: ${environment}"
  echo "  Service:     ${service}"
  echo "  Account:     ${accountId:-<unverified>}"
  echo "  Auth:        ${authMode}${profile:+ (profile ${profile})}"
  echo "  KMS key:     ${kmsKey:-<default SSM key>}"
  echo "  Region:      ${region}"
  echo "  Path prefix: ${pathPrefix}/"
  echo "  Source file: ${envFile}"
  echo "  Parameters (names only):"
  local key
  for key in "${parameterNames[@]}"; do
    echo "    $(parameterPath "$key")"
  done
  echo ""
}

requireConfirmation() {
  if [[ "$confirmed" != "true" ]]; then
    echo "Refusing to write: re-run with --confirm to apply these put-parameter calls." >&2
    exit 1
  fi
}

putAllParameters() {
  local key
  for key in "$@"; do
    putParameter "$key"
  done
}

putParameter() {
  local key="$1" name value
  name="$(parameterPath "$key")"
  if ! value="$(readParameterValue "$key")"; then
    echo "FAILED ${name}: value not found in ${envFile}" >&2
    return 1
  fi
  if [[ -n "$kmsKey" ]] && putParameterWith "$name" "$value" --key-id "$kmsKey"; then
    echo "OK ${name}"
    return 0
  fi
  [[ -n "$kmsKey" ]] && echo "KMS key rejected for ${name}; retrying with default SSM KMS key..." >&2
  if putParameterWith "$name" "$value"; then
    echo "OK ${name} (default KMS key)"
    return 0
  fi
  echo "FAILED ${name}" >&2
  return 1
}

putParameterWith() {
  local name="$1" value="$2"
  shift 2
  aws ssm put-parameter "${awsArgs[@]}" \
    --name "$name" --value "$value" \
    --type SecureString --overwrite "$@" >/dev/null 2>&1
}

verify() {
  echo ""
  echo "Verification — parameters now under ${pathPrefix}:"
  aws ssm get-parameters-by-path "${awsArgs[@]}" \
    --path "$pathPrefix" --recursive \
    --query "Parameters[].Name" --output text
}

main "$@"
