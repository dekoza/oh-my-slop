#!/usr/bin/env node
// Ensures bun's global install directory has a package.json so that
// `bun pm bin -g` works even when no packages have been installed globally.
// Without this file bun exits with "No package.json was found for directory …"
// which breaks @mariozechner/pi-coding-agent's DefaultResourceLoader.reload().

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function bunGlobalDir() {
  // Respect BUN_INSTALL if the user has overridden it.
  const bunInstall = process.env.BUN_INSTALL || join(homedir(), '.bun');
  return join(bunInstall, 'install', 'global');
}

function bunAvailable() {
  try {
    execFileSync('bun', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

if (!bunAvailable()) {
  process.exit(0);
}

const globalDir = bunGlobalDir();
const pkgPath = join(globalDir, 'package.json');

if (existsSync(pkgPath)) {
  process.exit(0);
}

mkdirSync(globalDir, { recursive: true });
writeFileSync(pkgPath, JSON.stringify({ name: 'bun-global-packages', version: '0.0.0', private: true }, null, 2) + '\n', 'utf8');
console.log(`[oh-my-slop] Created ${pkgPath} so that bun pm bin -g works correctly.`);
