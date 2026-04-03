import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import getPort, { portNumbers } from 'get-port';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const START_PORT = Number.parseInt(process.env.DEV_START_PORT ?? '3000', 10);
const MAX_TRIES = 30;
const END_PORT = START_PORT + MAX_TRIES - 1;

let nextBin;
try {
  nextBin = require.resolve('next/dist/bin/next', { paths: [projectRoot] });
} catch {
  console.error('next 패키지를 찾을 수 없습니다. 프로젝트 루트에서 npm install을 실행했는지 확인하세요.');
  process.exit(1);
}

const port = await getPort({
  port: portNumbers(START_PORT, END_PORT),
});

console.log(`\n  ▶ 개발 서버: http://localhost:${port} (${START_PORT}이(가) 사용 중이면 ${START_PORT + 1}~${END_PORT} 중 빈 포트를 사용)\n`);

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
