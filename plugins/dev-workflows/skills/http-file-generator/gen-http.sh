#!/usr/bin/env bash
#
# gen-http.sh — stamp the deterministic boilerplate of a .http request file
# (VS Code REST Client / IntelliJ HTTP Client format).
#
# Faithfully extracted from the http-file-generator skill prose. It emits the fixed
# scaffold — the @baseUrl/@apiVersion/@requestId variables and the request stanza header.
# The request BODY is left as an empty object on purpose: choosing realistic fields and
# sample values is judgment the model fills in, not a fixed operation. SMOKE-TEST ON FIRST USE.
#
# Prints to stdout (redirect into a file). Usage:
#   gen-http.sh --name "Create generation" --method POST --path content/generate \
#     [--port 3000] [--api-version v1] [--dev-url https://dev.example.com]

set -euo pipefail

main() {
  local name="" method="POST" request_path="" port="3000" api_version="v1" dev_url=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name)        name="$2"; shift 2 ;;
      --method)      method="$2"; shift 2 ;;
      --path)        request_path="$2"; shift 2 ;;
      --port)        port="$2"; shift 2 ;;
      --api-version) api_version="$2"; shift 2 ;;
      --dev-url)     dev_url="$2"; shift 2 ;;
      *) printf 'error: unknown argument: %s\n' "$1" >&2; exit 1 ;;
    esac
  done

  if [[ -z "$name" || -z "$request_path" ]]; then
    printf 'error: --name and --path are required\n' >&2
    exit 1
  fi
  emit_http_scaffold "$name" "$method" "$request_path" "$port" "$api_version" "$dev_url"
}

emit_http_scaffold() {
  local name="$1" method="$2" request_path="$3" port="$4" api_version="$5" dev_url="$6"
  printf '### Variables\n'
  printf '@baseUrl = http://localhost:%s\n' "$port"
  if [[ -n "$dev_url" ]]; then
    printf '#@baseUrl = %s\n' "$dev_url"
  fi
  printf '@apiVersion = %s\n' "$api_version"
  printf '@requestId = {{$timestamp}}\n\n'
  printf '### %s\n' "$name"
  printf '%s {{baseUrl}}/{{apiVersion}}/%s\n' "$method" "$request_path"
  printf 'Content-Type: application/json\n\n'
  printf '{\n}\n'
}

main "$@"
