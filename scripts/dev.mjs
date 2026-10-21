import { execFileSync, execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import getPort, { portNumbers } from 'get-port';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const onWin = process.platform === 'win32';

function envFlag(name) {
  const v = process.env[name];
  if (v === '1' || /^true$/i.test(v ?? '')) return true;
  if (v === '0' || /^false$/i.test(v ?? '')) return false;
  return undefined;
}

const START_PORT = Number.parseInt(
  process.env.PORT ?? process.env.DEV_PORT ?? process.env.DEV_START_PORT ?? '3000',
  10
);
const AUTO_PORT =
  process.env.DEV_AUTO_PORT === '1' || /^true$/i.test(process.env.DEV_AUTO_PORT ?? '');

const DEV_NO_KILL = envFlag('DEV_NO_KILL') === true;

/** 포트 비우기 실패 시 다음 빈 포트로 자동 전환 (기본: 켬) */
const AUTO_FALLBACK_PORT = envFlag('DEV_AUTO_FALLBACK') !== false;

const USE_TURBO = envFlag('DEV_TURBO') ?? false;
const AUTO_RESTART = envFlag('DEV_RESTART') ?? true;

const MAX_PORT_RECLAIM_TRIES = 4;
const MAX_TRIES = 30;
const END_PORT = START_PORT + MAX_TRIES - 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortAvailable(port) {
  const chosen = await getPort({ port });
  return chosen === port;
}

function killPortWinNetstat(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    const portPattern = new RegExp(`:${port}\\s`);
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING') || !portPattern.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', pid], {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 15_000,
        });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function killPortWinPowerShell(port) {
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$p=${port}; $pids = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($pid in $pids) { if ($pid -and $pid -ne 0) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } }`,
      ],
      { stdio: 'ignore', windowsHide: true, timeout: 25_000 }
    );
  } catch {
    /* ignore */
  }
}

async function freeListeningPort(port) {
  const p = Number.parseInt(String(port), 10);
  if (!p || DEV_NO_KILL) return;

  if (onWin) {
    killPortWinNetstat(p);
    killPortWinPowerShell(p);
  }

  try {
    await require('kill-port')(p);
  } catch {
    /* ignore */
  }

  await sleep(onWin ? 800 : 200);
}

async function ensurePortReady(port) {
  if (DEV_NO_KILL) return port;
  for (let i = 0; i < 3; i += 1) {
    if (await isPortAvailable(port)) return port;
    await freeListeningPort(port);
    await sleep(600);
  }
  return port;
}

let nextBin;
try {
  nextBin = require.resolve('next/dist/bin/next', { paths: [projectRoot] });
} catch {
  console.error(
    '[error] next 패키지를 찾을 수 없습니다. 프로젝트 루트에서 npm install을 실행했는지 확인하세요.'
  );
  process.exit(1);
}

/** @type {number} */
let activePort = AUTO_PORT
  ? await getPort({ port: portNumbers(START_PORT, END_PORT) })
  : START_PORT;

if (!AUTO_PORT && !DEV_NO_KILL) {
  activePort = await ensurePortReady(activePort);
}

if (AUTO_PORT && activePort !== START_PORT) {
  console.log(`\n  [warn] 포트 ${START_PORT} 사용 중 → http://127.0.0.1:${activePort}\n`);
}

if (onWin) {
  console.log(
    `\n  [dev] http://127.0.0.1:${activePort} · (UNKNOWN open / 500 시: npm run dev:clean)\n`
  );
}

let shuttingDown = false;
let restartTimer = null;
let portReclaimAttempts = 0;
let restartScheduled = false;
/** @type {import('node:child_process').ChildProcess | null} */
let activeChild = null;

function devChildEnv() {
  const base = {
    ...process.env,
    NEXT_TRACE_SPAN_THRESHOLD_MS: process.env.NEXT_TRACE_SPAN_THRESHOLD_MS ?? '999999999',
  };
  if (!onWin) return base;
  return {
    ...base,
    WATCHPACK_POLLING: process.env.WATCHPACK_POLLING ?? 'true',
    WATCHPACK_POLLING_INTERVAL: process.env.WATCHPACK_POLLING_INTERVAL ?? '1000',
    CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING ?? 'true',
    CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL ?? '1000',
  };
}

async function switchToAlternatePort() {
  const next = await getPort({ port: portNumbers(START_PORT + 1, END_PORT) });
  console.log(
    `\n  [dev] 포트 ${activePort}을 비울 수 없습니다 → http://127.0.0.1:${next} 에서 실행합니다.\n`
  );
  activePort = next;
  portReclaimAttempts = 0;
  spawnDev();
}

async function reclaimPortAndRespawn() {
  if (DEV_NO_KILL) return false;
  if (portReclaimAttempts >= MAX_PORT_RECLAIM_TRIES) {
    if (AUTO_FALLBACK_PORT && activePort === START_PORT) {
      await switchToAlternatePort();
      return true;
    }
    return false;
  }
  portReclaimAttempts += 1;
  console.log(
    `\n  [dev] 포트 ${activePort} 사용 중 → 점유 프로세스 종료 후 재시도 (${portReclaimAttempts}/${MAX_PORT_RECLAIM_TRIES})…\n`
  );
  await freeListeningPort(activePort);
  await sleep(700);
  if (!(await isPortAvailable(activePort)) && portReclaimAttempts >= MAX_PORT_RECLAIM_TRIES) {
    if (AUTO_FALLBACK_PORT && activePort === START_PORT) {
      await switchToAlternatePort();
      return true;
    }
  }
  spawnDev();
  return true;
}

function spawnDev() {
  if (restartScheduled) return activeChild;
  const args = ['dev', '--port', String(activePort), '--hostname', '127.0.0.1'];
  if (USE_TURBO) args.push('--turbopack');

  const startedAt = Date.now();
  const child = spawn(process.execPath, [nextBin, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: devChildEnv(),
  });
  activeChild = child;

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? 0);
      return;
    }

    const ranMs = Date.now() - startedAt;
    if (ranMs < 5000) {
      void (async () => {
        const retried = await reclaimPortAndRespawn();
        if (!retried) {
          console.error(
            `\n  [dev] 시작 실패 (code=${code ?? 'null'}).` +
              ` 작업 관리자에서 node.exe를 종료하거나: npm run dev:auto\n`
          );
          process.exit(1);
        }
      })();
      return;
    }

    portReclaimAttempts = 0;

    if (AUTO_RESTART) {
      if (restartScheduled) return;
      restartScheduled = true;
      const waitMs = onWin ? 3500 : 2000;
      console.log(
        `\n  [dev] 개발 서버가 멈춤 (code=${code ?? 'null'}). ${waitMs / 1000}초 후 다시 시작… (Ctrl+C로 완전 종료)\n`
      );
      restartTimer = setTimeout(() => {
        restartTimer = null;
        void (async () => {
          if (!DEV_NO_KILL) await freeListeningPort(activePort);
          await sleep(onWin ? 1200 : 400);
          restartScheduled = false;
          spawnDev();
        })();
      }, waitMs);
      return;
    }

    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });

  return child;
}

spawnDev();

function shutdown() {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  try {
    activeChild?.kill('SIGINT');
  } catch {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
