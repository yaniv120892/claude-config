import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySpecs } from './bump.mjs';

test('specs are replaced in place and nothing else moves', () => {
  const packageJson = {
    name: 'app',
    dependencies: { next: '15.5.24', '@mui/material': '^7.3.9' },
    devDependencies: { prisma: '^6.9.0', eslint: '^9' },
  };
  const updated = applySpecs(packageJson, [
    { name: 'next', section: 'dependencies', spec: '16.3.6' },
    { name: 'prisma', section: 'devDependencies', spec: '^7.10.0' },
  ]);
  assert.deepEqual(updated, {
    name: 'app',
    dependencies: { next: '16.3.6', '@mui/material': '^7.3.9' },
    devDependencies: { prisma: '^7.10.0', eslint: '^9' },
  });
  assert.equal(packageJson.dependencies.next, '15.5.24');
});

test('a package missing from the named section is an error, not a silent add', () => {
  assert.throws(
    () => applySpecs({ dependencies: {} }, [{ name: 'next', section: 'dependencies', spec: '16.3.6' }]),
    /package.json has no next under dependencies/,
  );
});
