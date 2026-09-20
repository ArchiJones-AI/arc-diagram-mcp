#!/usr/bin/env node
/**
 * Copy the built single-file page to wherever the deliverable lives.
 *
 * DELIVER_TO unset is the normal template state, so it is a SKIP, not a
 * failure: the gate must run green in a fork that has no delivery target yet.
 *   DELIVER_TO=../architecture.html npm run deliver
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const target = process.env.DELIVER_TO;

if (!target) {
  console.log('deliver: DELIVER_TO not set, skipping');
  process.exit(0);
}

const source = path.join(appRoot, 'dist-offline/index.html');
const destination = path.resolve(appRoot, target);
try {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
} catch (error) {
  // Name the likely cause rather than printing a raw stack trace: the two
  // real ones are "no offline build yet" and "destination not writable".
  const why = error.code === 'ENOENT' && error.path === source
    ? 'dist-offline/index.html does not exist — run `npm run build:offline` first'
    : `${error.code ?? 'error'} writing to ${destination}`;
  console.error(`deliver: ${why}`);
  process.exit(1);
}
console.log(`deliver: ${path.relative(appRoot, source)} → ${destination}`);
