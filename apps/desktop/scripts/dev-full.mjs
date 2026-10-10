import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.resolve(desktopDir, '..', '..', 'services', 'backend');
const viteEntry = path.join(desktopDir, 'node_modules', 'vite', 'bin', 'vite.js');
const node = process.execPath;

const backend = spawn(node, ['index.js'], {
  cwd: backendDir,
  stdio: 'inherit',
  env: process.env,
});

console.log('[dev] Starting TaxFlow.AI backend on http://localhost:5000');

const vite = spawn(node, [viteEntry], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: process.env,
});

console.log('[dev] Starting Vite frontend on http://localhost:5173');

let shuttingDown = false;

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  backend.kill();
  vite.kill();
}

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});

backend.on('error', (error) => {
  console.error(`[backend] Failed to start: ${error.message}`);
});

vite.on('error', (error) => {
  console.error(`[vite] Failed to start: ${error.message}`);
  stop();
  process.exit(1);
});

vite.on('exit', (code, signal) => {
  const wasAlreadyStopping = shuttingDown;
  stop();
  if (!wasAlreadyStopping) {
    process.exit(code ?? (signal ? 1 : 0));
  }
});
