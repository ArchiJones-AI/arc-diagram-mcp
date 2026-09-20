#!/usr/bin/env node
/**
 * Baseline comparator — the durable form of the optional-fields-only rule.
 *
 * The overlay adds OPTIONAL fields, so a view that sets none of them must
 * render byte-identically after any change to this template. That invariant
 * was a sentence in the docs and got broken anyway; here it is a gate.
 *
 * scripts/baseline.json records, per export, the sha256 and the pixel
 * dimensions of the PNG. Dimensions changing is unambiguous evidence the
 * layout moved. A hash changing with identical dimensions is usually the
 * same thing, but font rendering differs between machines, so the message
 * says so and --dims-only exists for a foreign machine — use it knowingly.
 *
 * Refresh the file deliberately, never to make a red gate green:
 *   node scripts/cmp-baseline.mjs --write
 */
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const write = argv.includes('--write');
const dimsOnly = argv.includes('--dims-only');
const exportsDirArg = argv.find((value) => !value.startsWith('--'));
const exportsDir = path.resolve(appRoot, exportsDirArg ?? 'exports');
const baselinePath = path.join(appRoot, 'scripts/baseline.json');

/** PNG dimensions from the IHDR chunk — no image library needed. */
function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Minimal PNG decoder for what Playwright writes: 8-bit non-interlaced RGB or
 * RGBA. It exists so this gate can compare PIXELS with a tolerance instead of
 * bytes. A byte hash calls a 3-pixel antialiasing difference on one hairline a
 * failure, and a gate that cries wolf is a gate people re-run until it is
 * green — which is exactly how a real regression gets waved through.
 * Returns null for anything it does not understand, and the caller falls back
 * to the hash comparison rather than pretending it checked.
 */
function decodePng(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colourType = buffer[25];
  const interlace = buffer[28];
  if (depth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) return null;
  const channels = colourType === 6 ? 4 : 3;
  const parts = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += length + 12;
  }
  if (parts.length === 0) return null;
  let raw;
  try { raw = inflateSync(Buffer.concat(parts)); } catch { return null; }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c); const pb = Math.abs(a - c); const pc = Math.abs(a + b - 2 * c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) return null;
      cur[x] = value & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** Per-channel difference tolerated before a pixel counts as changed. */
const CHANNEL_TOLERANCE = 8;
/** Changed pixels tolerated before the export counts as moved. */
const pixelBudget = (width, height) => Math.max(24, Math.round(width * height * 0.0001));

/** null when either image cannot be decoded — the caller then uses the hash. */
function pixelDelta(a, b) {
  const left = decodePng(a);
  const right = decodePng(b);
  if (!left || !right || left.channels !== right.channels) return null;
  if (left.width !== right.width || left.height !== right.height) return null;
  let changed = 0;
  let worst = 0;
  for (let i = 0; i < left.data.length; i += left.channels) {
    let delta = 0;
    for (let c = 0; c < 3; c += 1) delta = Math.max(delta, Math.abs(left.data[i + c] - right.data[i + c]));
    if (delta > CHANNEL_TOLERANCE) changed += 1;
    worst = Math.max(worst, delta);
  }
  return { changed, worst, budget: pixelBudget(left.width, left.height) };
}

async function measure(fileName) {
  const buffer = await readFile(path.join(exportsDir, fileName));
  return { sha256: createHash('sha256').update(buffer).digest('hex'), ...pngSize(buffer) };
}

/** The recorded PNGs live beside the baseline so pixels can be compared. */
const baselinePngDir = path.join(appRoot, 'scripts/baseline-exports');

let baseline;
try {
  baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
} catch (error) {
  if (error instanceof SyntaxError) {
    console.error(`cmp:baseline: scripts/baseline.json is not valid JSON — ${error.message}`);
    console.log('FAIL — unreadable baseline');
    process.exit(1);
  }
  if (error.code !== 'ENOENT') throw error;
  if (!write) {
    console.error('cmp:baseline: scripts/baseline.json is missing — take one with `node scripts/cmp-baseline.mjs --write` once the rest of the gate is green');
    console.log('FAIL — no baseline to compare against');
    process.exit(1);
  }
  baseline = { note: 'Exports that must not move when optional fields are added elsewhere.', files: {} };
}

if (write) {
  const { readdir } = await import('node:fs/promises');
  let entries;
  try {
    entries = await readdir(exportsDir);
  } catch (error) {
    console.error(`cmp:baseline: ${path.relative(appRoot, exportsDir)} could not be read (${error.code ?? 'unreadable'}) — run the export step first`);
    process.exit(1);
  }
  const names = entries.filter((name) => name.endsWith('.png')).sort();
  if (names.length === 0) {
    console.error(`cmp:baseline: ${path.relative(appRoot, exportsDir)} holds no PNGs — refusing to write an empty baseline`);
    process.exit(1);
  }
  const files = {};
  for (const name of names) files[name] = await measure(name);
  // Keep the reference PNGs in step with the recorded hashes. They are what
  // makes the tolerant pixel comparison possible; a baseline.json without
  // them silently degrades this gate to a byte hash.
  const { mkdir, copyFile, readdir: readRefs, rm } = await import('node:fs/promises');
  await mkdir(baselinePngDir, { recursive: true });
  const stale = await readRefs(baselinePngDir).catch(() => []);
  for (const name of stale) if (!files[name]) await rm(path.join(baselinePngDir, name));
  for (const name of names) await copyFile(path.join(exportsDir, name), path.join(baselinePngDir, name));
  // Say what is being changed. A baseline re-take is a deliberate act and
  // the operator should see which exports moved before it is recorded.
  const before = baseline.files ?? {};
  for (const name of new Set([...Object.keys(before), ...Object.keys(files)])) {
    if (!before[name]) console.log(`  + ${name} (new)`);
    else if (!files[name]) console.log(`  - ${name} (dropped)`);
    else if (before[name].sha256 !== files[name].sha256) {
      const dim = before[name].width !== files[name].width || before[name].height !== files[name].height
        ? ` ${before[name].width}x${before[name].height} -> ${files[name].width}x${files[name].height}`
        : ' pixels only';
      console.log(`  ~ ${name}${dim}`);
    }
  }
  await writeFile(baselinePath, `${JSON.stringify({ ...baseline, files }, null, 2)}\n`);
  console.log(`cmp:baseline — wrote ${names.length} entries to scripts/baseline.json`);
  process.exit(0);
}

// An empty baseline compares nothing and would report PASS — a gate that
// passes because it has nothing to check is worse than no gate.
const entries = Object.entries(baseline.files ?? {});
if (entries.length === 0) {
  console.error('cmp:baseline: scripts/baseline.json lists no files — take a baseline first with `node scripts/cmp-baseline.mjs --write`');
  console.log('FAIL — no baseline to compare against');
  process.exit(1);
}

const findings = [];
for (const [name, expected] of entries) {
  let actual;
  try { actual = await measure(name); }
  catch (error) {
    findings.push(`${name}: missing from ${path.relative(appRoot, exportsDir)} (${error.code ?? 'unreadable'})`);
    continue;
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    findings.push(`${name}: dimensions ${actual.width}x${actual.height}, expected ${expected.width}x${expected.height} — the layout moved`);
    continue;
  }
  if (dimsOnly || actual.sha256 === expected.sha256) continue;
  // Bytes differ. Compare PIXELS with a tolerance before calling it a change:
  // antialiasing on a hairline moves a handful of pixels by a few levels
  // between runs, and failing on that teaches the reader to ignore the gate.
  let delta = null;
  try {
    delta = pixelDelta(
      await readFile(path.join(baselinePngDir, name)),
      await readFile(path.join(exportsDir, name)),
    );
  } catch { /* no recorded PNG — fall through to the hash verdict */ }
  if (delta === null) {
    findings.push(`${name}: bytes changed at identical dimensions, and no recorded PNG was available to compare pixels against — record one under scripts/baseline-exports/, or re-run with --dims-only`);
  } else if (delta.changed > delta.budget) {
    findings.push(`${name}: ${delta.changed} pixels changed (budget ${delta.budget}, worst channel delta ${delta.worst}) — a real visual change`);
  } else if (delta.changed > 0) {
    console.log(`cmp:baseline: ${name} — ${delta.changed} pixel(s) differ within the ${delta.budget}-pixel antialiasing budget; not a change`);
  }
}

for (const finding of findings) console.error(`cmp:baseline: ${finding}`);
console.log(findings.length
  ? `FAIL — ${findings.length} baseline export(s) changed`
  : `PASS — ${Object.keys(baseline.files ?? {}).length} baseline export(s) unchanged`);
process.exitCode = findings.length ? 1 : 0;
