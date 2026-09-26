#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Outside the working tree, so it can never ride along in the commit.
const INSTALL_LOG = join(process.env.RUNNER_TEMP ?? tmpdir(), 'deps-install.log');

export function applySpecs(packageJson, packages) {
  const updated = structuredClone(packageJson);
  for (const { name, section, spec } of packages) {
    if (!updated[section]?.[name]) {
      throw new Error(`package.json has no ${name} under ${section}`);
    }
    updated[section][name] = spec;
  }
  return updated;
}

function main() {
  const packages = JSON.parse(process.env.PACKAGES ?? '[]');
  if (packages.length === 0) {
    throw new Error('PACKAGES is empty: nothing to bump');
  }
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  writeFileSync('package.json', `${JSON.stringify(applySpecs(packageJson, packages), null, 2)}\n`);

  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const log = `${install.stdout ?? ''}${install.stderr ?? ''}`;
  writeFileSync(INSTALL_LOG, log);
  const result = install.status === 0 ? 'ok' : 'failed';
  process.stdout.write(`npm install: ${result}\n${log.split('\n').slice(-40).join('\n')}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `install=${result}\ninstall_log=${INSTALL_LOG}\n`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main();
}
