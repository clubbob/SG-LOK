import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import getPort, { portNumbers } from 'get-port';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const START_PORT = Number.parseInt(
  process.env.PORT ?? process.env.DEV_PORT ?? process.env.DEV_START_PORT ?? '3000',
  10
);
const AUTO_PORT =
  process.env.DEV_AUTO_PORT === '1' || /^true$/i.test(process.env.DEV_AUTO_PORT ?? '');
const NO_KILL =
  process.env.DEV_NO_KILL === '1' || /^true$/i.test(process.env.DEV_NO_KILL ?? '');

const MAX_TRIES = 30;
const END_PORT = START_PORT + MAX_TRIES - 1;

/**
 * Windows: kill-port 패키지의 netstat 파싱이 IPv6(::) 등에서 자주 실패함 → PowerShell 사용.
 * 그 외: kill-port (lsof).
 */
async function freeListeningPort(port) {
  const p = Number.parseInt(String(port), 10);
  if (!p) return;

  if (process.platform === 'win32') {
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `$x = Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($x) { $x | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`,
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 25_000 }
      );
    } catch {
      /* 포트 비어 있음 / 권한 / 정책 등 */
    }
    return;
  }

  try {
    await require('kill-port')(p);
  } catch {
    /* ignore */
  }
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

const port = AUTO_PORT
  ? await getPort({ port: portNumbers(START_PORT, END_PORT) })
  : START_PORT;

if (!AUTO_PORT && !NO_KILL) {
  await freeListeningPort(port);
}

if (AUTO_PORT && port !== START_PORT) {
  const baseUrl = `http://localhost:${port}`;
  console.log(
    `\n  [warn] 포트 ${START_PORT} 사용 중. 아래 주소로 접속하세요.\n        ${baseUrl}\n`
  );
}

const child = spawn(process.execPath, [nextBin, 'dev', '--port', String(port)], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_TRACE_SPAN_THRESHOLD_MS: process.env.NEXT_TRACE_SPAN_THRESHOLD_MS ?? '999999999',
  },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
