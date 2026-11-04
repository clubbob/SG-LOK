import fs from 'fs';
import { spawnSync } from 'child_process';

const text = fs.readFileSync('.env.local', 'utf8');
const env = {};

for (const line of text.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  if (v === '') continue;
  env[k] = v;
}

const targets = ['production', 'preview', 'development'];
const targetsArg = targets.join(',');

function runVercel(args, input) {
  const result = spawnSync('npx', ['vercel', ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(
      `vercel ${args.join(' ')}\n${result.stderr || result.stdout}`
    );
  }
}

for (const [k, v] of Object.entries(env)) {
  try {
    runVercel(['env', 'rm', k, targetsArg, '--yes']);
  } catch {
    // not set yet
  }

  const isPublic = k.startsWith('NEXT_PUBLIC_');
  const args = [
    'env',
    'add',
    k,
    '--environment',
    targetsArg,
    ...(isPublic ? ['--no-sensitive'] : ['--sensitive']),
    '--force',
    '--yes',
  ];
  runVercel(args, v);
  console.log('set', k);
}
