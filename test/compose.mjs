import { execFileSync } from 'node:child_process';

export function compose(...args) {
  return execFileSync('docker', ['compose', ...args], {
    encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
