import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyAgainstPullRequests,
  groupCandidates,
  orderGroups,
  planCandidates,
  rangePrefix,
  resolveTarget,
  titleMentions,
  toMatrixEntries,
  typesBaseName,
} from './discover.mjs';
import { bumpLevel, compareVersions, highestStable } from './semver.mjs';

function lockfileFor(versions) {
  const packages = {};
  for (const [name, version] of Object.entries(versions)) {
    packages[`node_modules/${name}`] = { version };
  }
  return { packages };
}

function upgrade(name, from, to, extra = {}) {
  return {
    name,
    section: 'dependencies',
    from,
    to,
    spec: `^${to}`,
    level: bumpLevel(from, to),
    security: false,
    advisories: [],
    ...extra,
  };
}

test('semver helpers order releases and rank prereleases below their release', () => {
  assert.ok(compareVersions('8.0.0-rc.17', '8.0.0') < 0);
  assert.ok(compareVersions('7.10.0', '7.9.9') > 0);
  assert.equal(highestStable(['7.10.0', '8.0.0-rc.17', '8.1.0-dev.1', '7.9.0']), '7.10.0');
  assert.equal(highestStable(['1.0.0-beta.1']), null);
  assert.equal(bumpLevel('15.5.24', '16.3.6'), 'major');
  assert.equal(bumpLevel('1.57.0', '1.71.0'), 'minor');
  assert.equal(bumpLevel('4.5.0', '4.5.1'), 'patch');
});

test('a prerelease latest tag falls back to the highest stable published version', () => {
  const dependency = { name: 'prisma', spec: '^6.9.0', section: 'devDependencies', current: '6.19.3' };
  const versions = ['6.19.3', '7.10.0', '8.0.0-rc.17', '8.1.0-dev.7'];
  assert.equal(resolveTarget(dependency, { latest: '8.0.0-rc.17', versions }), '7.10.0');
  assert.equal(resolveTarget(dependency, { latest: '6.19.3', versions }), null);
  assert.equal(resolveTarget(dependency, undefined), null);
});

test('the range style of the existing spec is preserved', () => {
  assert.equal(rangePrefix('^7.3.9'), '^');
  assert.equal(rangePrefix('~1.2.3'), '~');
  assert.equal(rangePrefix('15.5.24'), '');
  assert.equal(rangePrefix('>=1.0.0'), '^');
});

test('@types packages pair with the package they type', () => {
  assert.equal(typesBaseName('@types/pg'), 'pg');
  assert.equal(typesBaseName('@types/babel__core'), '@babel/core');
  assert.equal(typesBaseName('pg'), 'pg');
  const groups = groupCandidates([upgrade('pg', '8.16.0', '8.23.0'), upgrade('@types/pg', '8.15.0', '8.21.0')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].slug, 'pg');
  assert.equal(groups[0].branch, 'deps/pg-8.23.0');
  assert.equal(groups[0].title, 'chore(deps): bump pg from 8.16.0 to 8.23.0 and 1 lockstep package');
});

test('lockstep families become one candidate led by the family leader', () => {
  const groups = groupCandidates([
    upgrade('@mui/system', '7.3.11', '9.4.0'),
    upgrade('@mui/material', '7.3.11', '9.4.0'),
    upgrade('@mui/icons-material', '7.3.11', '9.4.0'),
    upgrade('prisma', '6.19.3', '7.10.0'),
    upgrade('@prisma/client', '6.19.3', '7.10.0'),
    upgrade('@mastra/core', '1.57.0', '1.71.0'),
    upgrade('@mastra/memory', '1.26.0', '1.32.1'),
    upgrade('axios', '1.9.0', '1.20.0'),
  ]);
  const bySlug = Object.fromEntries(groups.map((group) => [group.slug, group]));
  assert.deepEqual(Object.keys(bySlug).sort(), ['axios', 'mastra', 'mui', 'prisma']);
  assert.equal(bySlug.mui.branch, 'deps/mui-9.4.0');
  assert.equal(bySlug.mui.title, 'chore(deps): bump @mui/* from 7.3.11 to 9.4.0');
  assert.equal(bySlug.prisma.title, 'chore(deps): bump @prisma/client and prisma from 6.19.3 to 7.10.0');
  assert.equal(bySlug.mastra.title, 'chore(deps): bump @mastra/core from 1.57.0 to 1.71.0 and 1 lockstep package');
  assert.equal(bySlug.mastra.branch, 'deps/mastra-1.71.0');
  assert.equal(bySlug.axios.branch, 'deps/axios-1.20.0');
  assert.equal(bySlug.mui.level, 'major');
});

test('a family with one outdated member is named after that member', () => {
  const [group] = groupCandidates([upgrade('@mui/material-nextjs', '7.3.9', '7.3.11')]);
  assert.equal(group.slug, 'mui-material-nextjs');
  assert.equal(group.branch, 'deps/mui-material-nextjs-7.3.11');
});

test('security fixes come first, then patch, minor, major, alphabetical within a level', () => {
  const ordered = orderGroups([
    { slug: 'zzz', level: 'patch', security: false },
    { slug: 'mui', level: 'major', security: false },
    { slug: 'next', level: 'major', security: true },
    { slug: 'axios', level: 'minor', security: false },
    { slug: 'aaa', level: 'patch', security: false },
  ]);
  assert.deepEqual(
    ordered.map((group) => group.slug),
    ['next', 'aaa', 'zzz', 'axios', 'mui'],
  );
});

test('title matching is whole-name, so react does not match react-dom or @types/react', () => {
  assert.ok(titleMentions('build(deps): bump react from 19.1.0 to 19.3.0', 'react'));
  assert.ok(!titleMentions('build(deps): bump react-dom from 19.1.0 to 19.3.0', 'react'));
  assert.ok(!titleMentions('build(deps): bump @types/react from 19.1.0 to 19.3.0', 'react'));
  assert.ok(titleMentions('chore(deps): bump @mui/material from 7.3.11 to 9.4.0', '@mui/material'));
});

test('an open PR for the package skips it, whoever opened it', () => {
  const group = groupCandidates([upgrade('@mui/material', '7.3.11', '9.4.0'), upgrade('@mui/system', '7.3.11', '9.4.0')])[0];
  const dependabot = [
    { number: 138, state: 'OPEN', title: 'build(deps): bump @mui/material from 7.3.11 to 9.4.0', headRefName: 'dependabot/npm_and_yarn/mui/material-9.4.0' },
  ];
  assert.equal(classifyAgainstPullRequests(group, dependabot).status, 'skipped');
  const ownEarlierRun = [{ number: 5, state: 'OPEN', title: 'chore(deps): bump @mui/* from 7.3.11 to 9.3.0', headRefName: 'deps/mui-9.3.0' }];
  assert.equal(classifyAgainstPullRequests(group, ownEarlierRun).status, 'skipped');
  const unrelated = [{ number: 6, state: 'OPEN', title: 'feat(imports): flag card fees', headRefName: 'feat/flag-card-fees' }];
  assert.equal(classifyAgainstPullRequests(group, unrelated).status, 'eligible');
});

test('a PR for the same target version closed without merging means the version was rejected', () => {
  const group = groupCandidates([upgrade('recharts', '2.15.4', '3.10.1')])[0];
  const rejected = [{ number: 135, state: 'CLOSED', title: 'build(deps): bump recharts from 2.15.4 to 3.10.1', headRefName: 'dependabot/npm_and_yarn/recharts-3.10.1' }];
  assert.equal(classifyAgainstPullRequests(group, rejected).status, 'skipped');
  const merged = [{ number: 135, state: 'MERGED', title: 'chore(deps): bump recharts from 2.15.4 to 3.10.1', headRefName: 'deps/recharts-3.10.1' }];
  assert.equal(classifyAgainstPullRequests(group, merged).status, 'eligible');
  const olderVersionRejected = [{ number: 90, state: 'CLOSED', title: 'chore(deps): bump recharts from 2.15.4 to 3.9.0', headRefName: 'deps/recharts-3.9.0' }];
  assert.equal(classifyAgainstPullRequests(group, olderVersionRejected).status, 'eligible');
});

test('the plan honours the per-run budget and the open-PR ceiling', async () => {
  const packageJson = {
    dependencies: { a: '^1.0.0', b: '~1.0.0', c: '1.0.0', d: '^1.0.0', e: '^1.0.0', next: '15.0.0' },
  };
  const lockfile = lockfileFor({ a: '1.0.0', b: '1.0.0', c: '1.0.0', d: '1.0.0', e: '1.0.0', next: '15.0.0' });
  const registry = {
    a: { latest: '1.0.1', versions: ['1.0.0', '1.0.1'] },
    b: { latest: '1.1.0', versions: ['1.0.0', '1.1.0'] },
    c: { latest: '2.0.0', versions: ['1.0.0', '2.0.0'] },
    d: { latest: '1.0.2', versions: ['1.0.0', '1.0.2'] },
    e: { latest: '1.0.0', versions: ['1.0.0'] },
    next: { latest: '15.0.1', versions: ['15.0.0', '15.0.1'] },
  };
  const fetchMetadata = async (name) => registry[name];
  const audit = {
    vulnerabilities: {
      next: {
        isDirect: true,
        fixAvailable: true,
        via: [{ source: 1, title: 'next: something bad', severity: 'high', url: 'https://github.com/advisories/GHSA-xxxx' }],
      },
    },
  };
  const limits = { maxNewPullRequests: 2, maxOpenPullRequests: 8 };
  const plan = await planCandidates({ packageJson, lockfile, fetchMetadata, audit, pullRequests: [], limits });
  assert.deepEqual(
    plan.report.map((group) => [group.slug, group.status]),
    [
      ['next', 'selected'],
      ['a', 'selected'],
      ['d', 'deferred'],
      ['b', 'deferred'],
      ['c', 'deferred'],
    ],
  );
  assert.equal(plan.selected[0].advisories[0].id, 'GHSA-xxxx');
  assert.deepEqual(plan.selected[0].packages[0], {
    name: 'next',
    section: 'dependencies',
    from: '15.0.0',
    to: '15.0.1',
    spec: '15.0.1',
  });
  assert.equal(plan.report.find((group) => group.slug === 'b').packages[0].spec, '~1.1.0');

  const eightOpen = Array.from({ length: 8 }, (_, index) => ({
    number: index,
    state: 'OPEN',
    title: `chore(deps): bump x${index}`,
    headRefName: `deps/x${index}-1.0.0`,
  }));
  const throttled = await planCandidates({ packageJson, lockfile, fetchMetadata, audit, pullRequests: eightOpen, limits });
  assert.equal(throttled.selected.length, 0);
  assert.ok(throttled.report.every((group) => group.status === 'deferred'));

  const matrix = toMatrixEntries(plan.selected);
  assert.equal(matrix.length, 2);
  assert.ok(matrix.every((entry) => Object.values(entry).every((value) => typeof value === 'string')));
});
