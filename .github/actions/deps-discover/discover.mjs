#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  bumpLevel,
  compareVersions,
  highestStable,
  highestStableWithinRange,
  isPrerelease,
  parseVersion,
} from './semver.mjs';

const execFileAsync = promisify(execFile);

export const BRANCH_PREFIX = 'deps/';

const TYPES_SCOPE = '@types/';
const PULL_REQUEST_STATE = { open: 'OPEN', closed: 'CLOSED' };
const LEVEL_RANK = { patch: 0, minor: 1, major: 2 };
const REGISTRY_FETCH_CONCURRENCY = 8;

// Packages released together, so one pull request moves the whole set. A family
// matches its leader, its `members` and any name under its `prefixes`; the
// leader names the branch.
export const LOCKSTEP_FAMILIES = [
  { slug: 'prisma', label: 'prisma', leader: 'prisma', prefixes: ['@prisma/'] },
  { slug: 'mastra', label: '@mastra/*', leader: '@mastra/core', prefixes: ['@mastra/'] },
  { slug: 'mui', label: '@mui/*', leader: '@mui/material', prefixes: ['@mui/'] },
  { slug: 'emotion', label: '@emotion/*', leader: '@emotion/react', prefixes: ['@emotion/'] },
  { slug: 'next', label: 'next', leader: 'next', members: ['eslint-config-next'], prefixes: ['@next/'] },
  { slug: 'react', label: 'react', leader: 'react', members: ['react-dom'] },
  {
    slug: 'tanstack-query',
    label: '@tanstack/react-query',
    leader: '@tanstack/react-query',
    prefixes: ['@tanstack/react-query', '@tanstack/query-'],
  },
  { slug: 'vitest', label: 'vitest', leader: 'vitest', prefixes: ['@vitest/'] },
  { slug: 'eslint', label: 'eslint', leader: 'eslint', prefixes: ['@eslint/'] },
  { slug: 'typescript-eslint', label: 'typescript-eslint', leader: 'typescript-eslint', prefixes: ['@typescript-eslint/'] },
  { slug: 'aws-sdk', label: '@aws-sdk/*', leader: '@aws-sdk/client-s3', prefixes: ['@aws-sdk/'] },
  { slug: 'ai-sdk', label: 'ai', leader: 'ai', prefixes: ['@ai-sdk/'] },
];

// The shape every upgrade PR title takes, dependabot's included, so a title
// names a package and a target version structurally rather than by prose.
const BUMP_TITLE = /\bbump (\S+) from (\S+) to (\S+)/i;

export function slugify(packageName) {
  return packageName
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-');
}

export function findFamily(packageName) {
  return (
    LOCKSTEP_FAMILIES.find(
      (family) =>
        family.leader === packageName ||
        (family.members ?? []).includes(packageName) ||
        (family.prefixes ?? []).some((prefix) => packageName.startsWith(prefix)),
    ) ?? null
  );
}

// `@types/foo` pairs with `foo`, and `@types/scope__name` with `@scope/name`.
export function typesBaseName(packageName) {
  if (!packageName.startsWith(TYPES_SCOPE)) {
    return packageName;
  }
  const bare = packageName.slice(TYPES_SCOPE.length);
  return bare.includes('__') ? `@${bare.replace('__', '/')}` : bare;
}

export function rangePrefix(spec) {
  if (spec.startsWith('^') || spec.startsWith('~')) {
    return spec[0];
  }
  return /^\d/.test(spec) ? '' : null;
}

export function parseBumpTitle(title) {
  const match = BUMP_TITLE.exec(title);
  return match ? { name: match[1], to: match[3] } : null;
}

export function listDirectDependencies(packageJson, lockfile) {
  if (!lockfile.packages) {
    throw new Error('package-lock.json has no "packages" map: lockfileVersion 2 or later is required');
  }
  const direct = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
      const locked = lockfile.packages[`node_modules/${name}`];
      if (!locked?.version) {
        continue;
      }
      direct.push({ name, spec, section, current: locked.version });
    }
  }
  return direct;
}

// A prerelease `latest` tag falls back to the highest stable release. A security
// fix npm reports as reachable without a spec change stays inside the range, so
// the smallest PR that closes the advisory comes first and the major follows.
export function resolveTarget(dependency, metadata, audit, { stayInRange = false } = {}) {
  const latest = metadata?.latest;
  if (!latest || !parseVersion(latest) || !parseVersion(dependency.current)) {
    return null;
  }
  const versions = metadata.versions ?? [];
  const fixIsInRange = audit.vulnerabilities?.[dependency.name]?.fixAvailable === true;
  const prefix = rangePrefix(dependency.spec) || (stayInRange ? '^' : '');
  const inRange = highestStableWithinRange(versions, dependency.current, prefix);
  const wantsInRange = stayInRange || (isSecurityFix(audit, dependency.name) && fixIsInRange);
  const takesInRangeTarget = wantsInRange && inRange !== null && isNewer(inRange, dependency.current);
  if (takesInRangeTarget) {
    return inRange;
  }
  if (stayInRange) {
    return null;
  }
  const target = isPrerelease(latest) ? highestStable(versions) : latest;
  return target && isNewer(target, dependency.current) ? target : null;
}

export function collectAdvisories(audit, packageName) {
  const advisories = new Map();
  const visited = new Set();
  const visit = (name) => {
    if (visited.has(name)) {
      return;
    }
    visited.add(name);
    for (const via of audit.vulnerabilities?.[name]?.via ?? []) {
      if (typeof via === 'string') {
        visit(via);
        continue;
      }
      const id = via.url?.split('/').pop() ?? String(via.source);
      advisories.set(id, { id, title: via.title, severity: via.severity, url: via.url, through: name });
    }
  };
  visit(packageName);
  return [...advisories.values()];
}

export function isSecurityFix(audit, packageName) {
  const entry = audit.vulnerabilities?.[packageName];
  return Boolean(entry?.isDirect && entry.fixAvailable);
}

export function groupCandidates(upgrades) {
  const groups = new Map();
  for (const upgrade of upgrades) {
    const key = groupKey(upgrade.name);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(upgrade);
  }
  return [...groups.values()].map(describeGroup);
}

export function classifyAgainstPullRequests(group, pullRequests) {
  const slugs = [group.slug, ...group.packages.map((item) => slugify(item.name))];
  const bumpOf = (pullRequest) => parseBumpTitle(pullRequest.title);
  const open = pullRequests.find(
    (pullRequest) =>
      pullRequest.state === PULL_REQUEST_STATE.open &&
      (slugs.some((slug) => branchIsFor(pullRequest.headRefName, slug)) ||
        group.packages.some((item) => item.name === bumpOf(pullRequest)?.name)),
  );
  if (open) {
    return { status: 'skipped', reason: `open PR #${open.number} (${open.headRefName})` };
  }
  const rejected = pullRequests.find(
    (pullRequest) =>
      pullRequest.state === PULL_REQUEST_STATE.closed &&
      (pullRequest.headRefName === group.branch ||
        group.packages.some((item) => pullRequest.headRefName === `${BRANCH_PREFIX}${slugify(item.name)}-${item.to}`) ||
        group.packages.some((item) => item.name === bumpOf(pullRequest)?.name && item.to === bumpOf(pullRequest)?.to)),
  );
  if (rejected) {
    return { status: 'skipped', reason: `PR #${rejected.number} for this version was closed without merging` };
  }
  return { status: 'eligible' };
}

export function orderGroups(groups) {
  return [...groups].sort((left, right) => {
    if (left.security !== right.security) {
      return left.security ? -1 : 1;
    }
    if (LEVEL_RANK[left.level] !== LEVEL_RANK[right.level]) {
      return LEVEL_RANK[left.level] - LEVEL_RANK[right.level];
    }
    return left.slug.localeCompare(right.slug);
  });
}

export async function planCandidates({ packageJson, lockfile, fetchMetadata, audit, pullRequests, limits }) {
  const dependencies = listDirectDependencies(packageJson, lockfile);
  const [metadataByName, resolvedAudit] = await Promise.all([
    mapWithConcurrency(dependencies, REGISTRY_FETCH_CONCURRENCY, async (dependency) => [
      dependency.name,
      await fetchMetadata(dependency.name),
    ]),
    audit,
  ]);

  const upgrades = [];
  const unsupportedSpecs = [];
  const targetOf = (dependency, options) =>
    resolveTarget(dependency, metadataByName.get(dependency.name), resolvedAudit, options);
  const staysInRange = (dependency) => {
    const target = targetOf(dependency);
    return target !== null && bumpLevel(dependency.current, target) !== 'major';
  };
  for (const dependency of dependencies) {
    const prefix = rangePrefix(dependency.spec);
    // `@types/x` follows `x`: when `x` stays inside its range, so do its types.
    const typedPackage = dependencies.find((other) => other.name === typesBaseName(dependency.name));
    const stayInRange = typedPackage !== undefined && typedPackage !== dependency && staysInRange(typedPackage);
    const target = targetOf(dependency, { stayInRange });
    if (!target) {
      continue;
    }
    if (prefix === null) {
      unsupportedSpecs.push(`${dependency.name} (${dependency.spec})`);
      continue;
    }
    upgrades.push({
      name: dependency.name,
      section: dependency.section,
      from: dependency.current,
      to: target,
      spec: `${prefix}${target}`,
      level: bumpLevel(dependency.current, target),
      security: isSecurityFix(resolvedAudit, dependency.name),
      advisories: collectAdvisories(resolvedAudit, dependency.name),
    });
  }

  const openDepsPullRequests = pullRequests.filter(
    (pullRequest) => pullRequest.state === PULL_REQUEST_STATE.open && pullRequest.headRefName.startsWith(BRANCH_PREFIX),
  ).length;
  const budget = openDepsPullRequests >= limits.maxOpenPullRequests ? 0 : limits.maxNewPullRequests;
  const deferredReason =
    budget === 0
      ? `${openDepsPullRequests} ${BRANCH_PREFIX}* PRs already open (limit ${limits.maxOpenPullRequests})`
      : `over the ${limits.maxNewPullRequests}-per-run budget`;

  let selectedCount = 0;
  const report = orderGroups(groupCandidates(upgrades)).map((group) => {
    const verdict = classifyAgainstPullRequests(group, pullRequests);
    if (verdict.status !== 'eligible') {
      return { ...group, ...verdict };
    }
    if (selectedCount < budget) {
      selectedCount += 1;
      return { ...group, status: 'selected', reason: '' };
    }
    return { ...group, status: 'deferred', reason: deferredReason };
  });

  return {
    openDepsPullRequests,
    budget,
    report,
    unsupportedSpecs,
    selected: report.filter((group) => group.status === 'selected'),
  };
}

// The bump action and the prompt read the matrix values directly, so the
// structured fields travel as JSON strings rather than through another file.
export function toMatrixEntries(selected) {
  return selected.map((group) => ({
    slug: group.slug,
    branch: group.branch,
    title: group.title,
    level: group.level,
    security: group.security ? 'true' : 'false',
    packages: JSON.stringify(group.packages),
    advisories: JSON.stringify(group.advisories),
  }));
}

export function renderSummary(plan) {
  const lines = [
    '## Dependency upgrade candidates',
    '',
    `Open \`${BRANCH_PREFIX}*\` PRs: ${plan.openDepsPullRequests}. Budget this run: ${plan.budget}.`,
    '',
    '| Status | Packages | From → To | Level | Reason |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const group of plan.report) {
    const packages = group.packages.map((item) => `\`${item.name}\``).join(', ');
    const jump = group.packages.map((item) => `${item.from} → ${item.to}`).join('<br>');
    const level = group.security ? `security (${group.level})` : group.level;
    lines.push(`| ${group.status} | ${packages} | ${jump} | ${level} | ${group.reason} |`);
  }
  if (plan.report.length === 0) {
    lines.push('| — | everything is at its latest stable version | | | |');
  }
  if (plan.unsupportedSpecs.length > 0) {
    lines.push('', `Left alone, range style not \`^\`, \`~\` or exact: ${plan.unsupportedSpecs.join(', ')}.`);
  }
  return `${lines.join('\n')}\n`;
}

function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function groupKey(packageName) {
  const base = typesBaseName(packageName);
  const family = findFamily(base);
  return family ? `family:${family.slug}` : `pair:${base}`;
}

function describeGroup(packages) {
  const sorted = [...packages].sort((left, right) => left.name.localeCompare(right.name));
  const family = findFamily(typesBaseName(sorted[0].name));
  const leader =
    sorted.find((item) => item.name === family?.leader) ??
    sorted.find((item) => !item.name.startsWith(TYPES_SCOPE)) ??
    sorted[0];
  const slug = sorted.length === 1 || !family ? slugify(leader.name) : family.slug;
  const level = sorted.reduce(
    (highest, item) => (LEVEL_RANK[item.level] > LEVEL_RANK[highest] ? item.level : highest),
    'patch',
  );
  return {
    slug,
    branch: `${BRANCH_PREFIX}${slug}-${leader.to}`,
    title: buildTitle(family, sorted, leader),
    level,
    security: sorted.some((item) => item.security),
    advisories: dedupeById(sorted.flatMap((item) => item.advisories)),
    packages: sorted.map(({ advisories: _advisories, security: _security, level: _level, ...item }) => item),
  };
}

function buildTitle(family, packages, leader) {
  const sameJump = packages.every((item) => item.from === leader.from && item.to === leader.to);
  if (sameJump) {
    const names = family && packages.length > 2 ? family.label : joinNames(packages.map((item) => item.name));
    return `chore(deps): bump ${names} from ${leader.from} to ${leader.to}`;
  }
  const others = packages.length - 1;
  return `chore(deps): bump ${leader.name} from ${leader.from} to ${leader.to} and ${others} lockstep ${others === 1 ? 'package' : 'packages'}`;
}

function joinNames(names) {
  if (names.length <= 2) {
    return names.join(' and ');
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function dedupeById(advisories) {
  const byId = new Map();
  for (const advisory of advisories) {
    byId.set(advisory.id, advisory);
  }
  return [...byId.values()];
}

// `deps/next-16.3.6` is next's branch; `deps/next-auth-5.0.0` is not.
function branchIsFor(headRefName, slug) {
  const prefix = `${BRANCH_PREFIX}${slug}-`;
  return headRefName.startsWith(prefix) && /^\d+\.\d+\.\d+/.test(headRefName.slice(prefix.length));
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Map();
  let nextIndex = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      const [key, value] = await worker(item);
      results.set(key, value);
    }
  });
  await Promise.all(lanes);
  return results;
}

// npm audit exits 1 whenever anything is vulnerable and still prints the
// report; an unreachable advisory endpoint also exits 1 but prints an error
// object, which must not read as "no vulnerabilities".
async function runNpmAudit() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('npm', ['audit', '--json'], { maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    if (!error.stdout) {
      throw error;
    }
    stdout = error.stdout;
  }
  const report = JSON.parse(stdout || '{}');
  if (!report.vulnerabilities) {
    throw new Error(`npm audit returned no report: ${JSON.stringify(report.error ?? report)}`);
  }
  return report;
}

// The abbreviated registry document carries the tags and the version list
// and nothing else, a few KB where the full one runs to megabytes. A package
// the registry does not serve (a git or file dependency, a private scope) is
// left alone; any other failure is the registry's and fails the run.
async function fetchRegistryMetadata(registry, packageName) {
  const url = new URL(packageName.replace('/', '%2F'), registry.endsWith('/') ? registry : `${registry}/`);
  const response = await fetch(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } });
  if (response.status === 404) {
    process.stderr.write(`skipping ${packageName}: not served by ${registry}\n`);
    return null;
  }
  if (!response.ok) {
    throw new Error(`registry answered ${response.status} for ${packageName} (${url})`);
  }
  const document = await response.json();
  return { latest: document['dist-tags']?.latest, versions: Object.keys(document.versions ?? {}) };
}

async function main() {
  const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const { stdout: registryLine } = await execFileAsync('npm', ['config', 'get', 'registry']);
  const registry = registryLine.trim();
  const plan = await planCandidates({
    packageJson: readJson('package.json'),
    lockfile: readJson('package-lock.json'),
    fetchMetadata: (packageName) => fetchRegistryMetadata(registry, packageName),
    audit: runNpmAudit(),
    pullRequests: process.env.PULL_REQUESTS_FILE ? readJson(process.env.PULL_REQUESTS_FILE) : [],
    limits: {
      maxNewPullRequests: Number(process.env.MAX_NEW_PRS ?? 4),
      maxOpenPullRequests: Number(process.env.MAX_OPEN_PRS ?? 8),
    },
  });

  const summary = renderSummary(plan);
  process.stdout.write(summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `candidates=${JSON.stringify(toMatrixEntries(plan.selected))}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
