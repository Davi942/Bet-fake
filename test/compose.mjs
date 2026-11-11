import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const composeFile = fileURLToPath(new URL('../compose.yaml', import.meta.url));

export function compose(...args) {
  return execFileSync('docker', ['compose', '--file', composeFile, ...args], {
    encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
