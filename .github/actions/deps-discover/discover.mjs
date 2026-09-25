#!/usr/bin/env node
// Lists the dependency upgrades a run may open pull requests for, deterministically:
// no model is involved. `planCandidates` is pure so the grouping, ordering and
// skip rules are testable; `main` gathers its inputs from npm and gh.
import { execFile } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { bumpLevel, compareVersions, highestStable, isPrerelease, parseVersion } from './semver.mjs';

const execFileAsync = promisify(execFile);

export const BRANCH_PREFIX = 'deps/';

const LEVEL_RANK = { patch: 0, minor: 1, major: 2 };

// Packages released together, so one pull request moves the whole set. `members`
// match a name exactly, `prefixes` match by scope; the leader names the branch.
export const LOCKSTEP_FAMILIES = [
  { slug: 'prisma', label: 'prisma', leader: 'prisma', members: ['prisma'], prefixes: ['@prisma/'] },
  { slug: 'mastra', label: '@mastra/*', leader: '@mastra/core', members: [], prefixes: ['@mastra/'] },
  { slug: 'mui', label: '@mui/*', leader: '@mui/material', members: [], prefixes: ['@mui/'] },
  { slug: 'emotion', label: '@emotion/*', leader: '@emotion/react', members: [], prefixes: ['@emotion/'] },
  { slug: 'next', label: 'next', leader: 'next', members: ['next', 'eslint-config-next'], prefixes: ['@next/'] },
  {
    slug: 'react',
    label: 'react',
    leader: 'react',
    members: ['react', 'react-dom', '@types/react', '@types/react-dom'],
    prefixes: [],
  },
  {
    slug: 'tanstack-query',
    label: '@tanstack/react-query',
    leader: '@tanstack/react-query',
    members: [],
    prefixes: ['@tanstack/react-query', '@tanstack/query-'],
  },
  { slug: 'vitest', label: 'vitest', leader: 'vitest', members: ['vitest'], prefixes: ['@vitest/'] },
  { slug: 'eslint', label: 'eslint', leader: 'eslint', members: ['eslint'], prefixes: ['@eslint/'] },
  {
    slug: 'typescript-eslint',
    label: 'typescript-eslint',
    leader: 'typescript-eslint',
    members: ['typescript-eslint'],
    prefixes: ['@typescript-eslint/'],
  },
  { slug: 'aws-sdk', label: '@aws-sdk/*', leader: '@aws-sdk/client-s3', members: [], prefixes: ['@aws-sdk/'] },
  { slug: 'ai-sdk', label: 'ai', leader: 'ai', members: ['ai'], prefixes: ['@ai-sdk/'] },
];

export function slugify(packageName) {
  return packageName
    .replace(/^@/, '')
    .replace(/\//g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-');
}

export function findFamily(packageName) {
  return (
    LOCKSTEP_FAMILIES.find(
      (family) =>
        family.members.includes(packageName) || family.prefixes.some((prefix) => packageName.startsWith(prefix)),
    ) ?? null
  );
}

// `@types/foo` pairs with `foo`, and `@types/scope__name` with `@scope/name`.
export function typesBaseName(packageName) {
  if (!packageName.startsWith('@types/')) {
    return packageName;
  }
  const bare = packageName.slice('@types/'.length);
  return bare.includes('__') ? `@${bare.replace('__', '/')}` : bare;
}

export function rangePrefix(spec) {
  if (spec.startsWith('^') || spec.startsWith('~')) {
    return spec[0];
  }
  if (/^\d/.test(spec)) {
    return '';
  }
  return '^';
}

export function titleMentions(title, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s(,:'"\`])${escaped}(?=$|[\\s,:)'"\`])`).test(title);
}

export function listDirectDependencies(packageJson, lockfile) {
  const direct = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(packageJson[section] ?? {})) {
      const locked = lockfile.packages?.[`node_modules/${name}`];
      if (!locked?.version) {
        continue;
      }
      direct.push({ name, spec, section, current: locked.version });
    }
  }
  return direct;
}

// `latest` is what the maintainer points at; a prerelease there falls back to
// the highest stable release in the version list.
export function resolveTarget(dependency, metadata) {
  const latest = metadata?.latest;
  if (!latest || !parseVersion(latest)) {
    return null;
  }
  const target = isPrerelease(latest) ? highestStable(metadata.versions ?? []) : latest;
  if (!target || !parseVersion(dependency.current)) {
    return null;
  }
  return compareVersions(target, dependency.current) > 0 ? target : null;
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
    const family = findFamily(upgrade.name);
    const key = family ? `family:${family.slug}` : `pair:${typesBaseName(upgrade.name)}`;
    if (!groups.has(key)) {
      groups.set(key, { family, packages: [] });
    }
    groups.get(key).packages.push(upgrade);
  }
  return [...groups.values()].map(({ family, packages }) => describeGroup(family, packages));
}

function describeGroup(family, packages) {
  const sorted = [...packages].sort((left, right) => left.name.localeCompare(right.name));
  const leader = pickLeader(family, sorted);
  const single = sorted.length === 1;
  const slug = single || !family ? slugify(leader.name) : family.slug;
  const level = sorted.reduce(
    (highest, item) => (LEVEL_RANK[item.level] > LEVEL_RANK[highest] ? item.level : highest),
    'patch',
  );
  const advisories = sorted.flatMap((item) => item.advisories);
  return {
    slug,
    branch: `${BRANCH_PREFIX}${slug}-${leader.to}`,
    title: buildTitle(family, sorted, leader),
    level,
    security: sorted.some((item) => item.security),
    advisories: dedupeById(advisories),
    packages: sorted.map(({ advisories: _advisories, security: _security, level: _level, ...item }) => item),
  };
}

function pickLeader(family, packages) {
  const familyLeader = family ? packages.find((item) => item.name === family.leader) : undefined;
  if (familyLeader) {
    return familyLeader;
  }
  const plain = packages.filter((item) => !item.name.startsWith('@types/'));
  const pool = plain.length > 0 ? plain : packages;
  return pool.reduce((shortest, item) => (item.name.length < shortest.name.length ? item : shortest));
}

function buildTitle(family, packages, leader) {
  const sameJump = packages.every((item) => item.from === leader.from && item.to === leader.to);
  if (packages.length === 1) {
    return `chore(deps): bump ${leader.name} from ${leader.from} to ${leader.to}`;
  }
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

export function classifyAgainstPullRequests(group, pullRequests) {
  const memberBranches = group.packages.map((item) => `${BRANCH_PREFIX}${slugify(item.name)}-${item.to}`);
  const mentionsMember = (title) => group.packages.some((item) => titleMentions(title, item.name));
  const open = pullRequests.find(
    (pullRequest) =>
      pullRequest.state === 'OPEN' &&
      (pullRequest.headRefName.startsWith(`${BRANCH_PREFIX}${group.slug}-`) ||
        group.packages.some((item) => pullRequest.headRefName.startsWith(`${BRANCH_PREFIX}${slugify(item.name)}-`)) ||
        mentionsMember(pullRequest.title)),
  );
  if (open) {
    return { status: 'skipped', reason: `open PR #${open.number} (${open.headRefName})` };
  }
  const rejected = pullRequests.find(
    (pullRequest) =>
      pullRequest.state === 'CLOSED' &&
      (pullRequest.headRefName === group.branch ||
        memberBranches.includes(pullRequest.headRefName) ||
        group.packages.some(
          (item) => titleMentions(pullRequest.title, item.name) && pullRequest.title.includes(` to ${item.to}`),
        )),
  );
  if (rejected) {
    return { status: 'skipped', reason: `PR #${rejected.number} for this version was closed without merging` };
  }
  return { status: 'eligible', reason: '' };
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
  const upgrades = [];
  const dependencies = listDirectDependencies(packageJson, lockfile);
  const metadataByName = await mapWithConcurrency(dependencies, 8, async (dependency) => [
    dependency.name,
    await fetchMetadata(dependency.name),
  ]);
  for (const dependency of dependencies) {
    const target = resolveTarget(dependency, metadataByName.get(dependency.name));
    if (!target) {
      continue;
    }
    upgrades.push({
      name: dependency.name,
      section: dependency.section,
      from: dependency.current,
      to: target,
      spec: `${rangePrefix(dependency.spec)}${target}`,
      level: bumpLevel(dependency.current, target),
      security: isSecurityFix(audit, dependency.name),
      advisories: collectAdvisories(audit, dependency.name),
    });
  }

  const ordered = orderGroups(groupCandidates(upgrades));
  const openDepsPullRequests = pullRequests.filter(
    (pullRequest) => pullRequest.state === 'OPEN' && pullRequest.headRefName.startsWith(BRANCH_PREFIX),
  ).length;
  const budget = openDepsPullRequests >= limits.maxOpenPullRequests ? 0 : limits.maxNewPullRequests;

  let selectedCount = 0;
  const report = ordered.map((group) => {
    const verdict = classifyAgainstPullRequests(group, pullRequests);
    if (verdict.status === 'eligible' && selectedCount < budget) {
      selectedCount += 1;
      return { ...group, status: 'selected', reason: '' };
    }
    if (verdict.status === 'eligible') {
      const reason =
        budget === 0
          ? `${openDepsPullRequests} ${BRANCH_PREFIX}* PRs already open (limit ${limits.maxOpenPullRequests})`
          : `over the ${limits.maxNewPullRequests}-per-run budget`;
      return { ...group, status: 'deferred', reason };
    }
    return { ...group, ...verdict };
  });

  return { openDepsPullRequests, budget, report, selected: report.filter((group) => group.status === 'selected') };
}

// The matrix carries scalars only: nested objects are not reliably addressable
// from `matrix.<key>` expressions, so packages and advisories travel as JSON.
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
  return `${lines.join('\n')}\n`;
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

async function runNpmJson(args) {
  try {
    const { stdout } = await execFileAsync('npm', args, { maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(stdout || '{}');
  } catch (error) {
    // npm audit exits 1 whenever anything is vulnerable and still prints the report.
    if (error.stdout) {
      return JSON.parse(error.stdout);
    }
    throw error;
  }
}

// One registry document per direct dependency: the latest tag and every
// published version, which is what the prerelease fallback needs.
async function fetchRegistryMetadata(packageName) {
  const document = await runNpmJson(['view', packageName, 'dist-tags.latest', 'versions', '--json']);
  const versions = document.versions ?? [];
  return { latest: document['dist-tags.latest'], versions: Array.isArray(versions) ? versions : [versions] };
}

function parseArguments(argv) {
  const options = { pullRequestsFile: null, maxNewPullRequests: 4, maxOpenPullRequests: 8, outputFile: 'deps-candidates.json' };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--pull-requests':
        options.pullRequestsFile = value;
        break;
      case '--max-new':
        options.maxNewPullRequests = Number(value);
        break;
      case '--max-open':
        options.maxOpenPullRequests = Number(value);
        break;
      case '--output':
        options.outputFile = value;
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
  const pullRequests = options.pullRequestsFile ? readJson(options.pullRequestsFile) : [];
  const audit = await runNpmJson(['audit', '--json']);
  const plan = await planCandidates({
    packageJson: readJson('package.json'),
    lockfile: readJson('package-lock.json'),
    fetchMetadata: fetchRegistryMetadata,
    audit,
    pullRequests,
    limits: { maxNewPullRequests: options.maxNewPullRequests, maxOpenPullRequests: options.maxOpenPullRequests },
  });

  const summary = renderSummary(plan);
  const matrix = toMatrixEntries(plan.selected);
  writeFileSync(options.outputFile, `${JSON.stringify(plan.report, null, 2)}\n`);
  process.stdout.write(summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `candidates=${JSON.stringify(matrix)}\ncount=${matrix.length}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main();
}
