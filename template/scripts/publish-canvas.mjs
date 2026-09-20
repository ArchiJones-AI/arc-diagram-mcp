#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ALLOWED_BOARDS = ['~/dev/sn-board-astro'];
const BRIDGE_ERROR = 'bundle exposes no usable window.__dg bridge (need diagrams[] non-empty and switchTo()) — retrofit src/App.tsx from the arc-diagram template (v1.2+)';
const BOARD_UNREACHABLE_ERROR = 'board not reachable at 127.0.0.1:4478 — is the launchd agent running? (launchctl print gui/$(id -u)/com.bluwingu.sn-board-astro)';
const META_TAG_RE = /<meta name="dg-canvas" content="([^"]*)"[^>]*>/;

function formatError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function loadPlaywright() {
  const packagePath = process.env.PLAYWRIGHT_PKG;

  if (packagePath) {
    try {
      const specifier = path.isAbsolute(packagePath)
        ? pathToFileURL(packagePath).href
        : packagePath;
      return await import(specifier);
    } catch {
      try {
        return createRequire(import.meta.url)(packagePath);
      } catch {}
    }
  }

  try {
    return await import('playwright');
  } catch {}

  try {
    const globalRoot = execFileSync('npm', ['root', '-g']).toString().trim();
    return createRequire(import.meta.url)(path.join(globalRoot, 'playwright'));
  } catch {}

  throw new Error('Playwright not found — set PLAYWRIGHT_PKG=<path-to-playwright-package> or npm i -g playwright');
}

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

export function validateCanvas(value) {
  const refuse = (reason) => {
    throw new Error(`refused: ${reason}`);
  };

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    refuse('canvas.json: expected a JSON object');
  }

  const canvas = value;
  if (typeof canvas.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(canvas.id)) {
    refuse('canvas.json: id must match /^[a-z0-9][a-z0-9-]*$/');
  }
  if (typeof canvas.file !== 'string' || !canvas.file.endsWith('.html')) {
    refuse('canvas.json: file must be a string ending in .html');
  }
  if (canvas.file.includes('/') || canvas.file.includes('\\') || canvas.file.includes('..')) {
    refuse("canvas.json: file must be a basename with no path separators or '..'");
  }
  if (!canvas.branch || typeof canvas.branch !== 'object' || Array.isArray(canvas.branch)) {
    refuse('canvas.json: branch must be an object');
  }
  if (typeof canvas.branch.id !== 'string' || canvas.branch.id.length === 0) {
    refuse('canvas.json: branch.id must be a non-empty string');
  }
  if (typeof canvas.branch.label !== 'string' || canvas.branch.label.length === 0) {
    refuse('canvas.json: branch.label must be a non-empty string');
  }
  if (canvas.family !== 'dg') {
    refuse("canvas.json: family must be 'dg'");
  }
  if (typeof canvas.confidential !== 'string' || !['internal', 'tier2', 'strict'].includes(canvas.confidential)) {
    refuse('canvas.json: confidential must be internal, tier2, or strict');
  }
  if (!canvas.caps || typeof canvas.caps !== 'object' || Array.isArray(canvas.caps)) {
    refuse('canvas.json: caps must be an object');
  }
  if (canvas.confidential === 'strict' && !canvas.file.startsWith('CONFIDENTIAL-')) {
    refuse("canvas.json: strict files must start with 'CONFIDENTIAL-'");
  }
}

async function readCanvasConfig(cwd) {
  const canvasPath = path.join(cwd, 'canvas.json');
  let source;

  try {
    source = await readFile(canvasPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('publish-canvas: no canvas.json — nothing published');
      return null;
    }
    throw error;
  }

  let canvas;
  try {
    canvas = JSON.parse(source);
  } catch (error) {
    throw new Error(`refused: canvas.json: invalid JSON: ${error.message}`);
  }
  validateCanvas(canvas);
  console.log(`publish-canvas: loaded canvas.json for ${canvas.id}`);
  return canvas;
}

async function resolveBoard(boardValue) {
  if (typeof boardValue !== 'string') throw new Error('canvas.json board must be a string');

  const board = path.resolve(expandHome(boardValue));
  const allowed = ALLOWED_BOARDS.map((candidate) => path.resolve(expandHome(candidate)));
  if (!allowed.includes(board)) {
    throw new Error(`refused: board ${board} is not on the allow-list`);
  }

  const visuals = path.join(board, 'visuals');
  let details;
  try {
    details = await stat(visuals);
  } catch {
    throw new Error(`board visuals directory does not exist: ${visuals}`);
  }
  if (!details.isDirectory()) throw new Error(`board visuals path is not a directory: ${visuals}`);

  console.log(`publish-canvas: board allow-list and visuals directory verified at ${board}`);
  return { board, visuals };
}

async function readBundle(cwd) {
  const bundlePath = path.join(cwd, 'dist-offline', 'index.html');
  let html;
  try {
    html = await readFile(bundlePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`offline bundle does not exist: ${bundlePath}`);
    throw error;
  }
  if (!html.includes('<meta name="dg-canvas"')) {
    throw new Error('bundle has no dg-canvas meta — build with `npm run build:offline`, not raw vite');
  }
  return { bundlePath, html };
}

async function inspectBridge(page, bundlePath) {
  let bridge;
  try {
    await page.goto(pathToFileURL(bundlePath).href);
    await page.waitForFunction(
      () => window.__dg && Array.isArray(window.__dg.diagrams),
      null,
      { timeout: 20000 },
    );
    bridge = await page.evaluate(() => ({
      n: window.__dg.diagrams.length,
      hasSwitch: typeof window.__dg.switchTo === 'function',
    }));
  } catch {
    throw new Error(BRIDGE_ERROR);
  }

  if (bridge.n === 0 || !bridge.hasSwitch) throw new Error(BRIDGE_ERROR);
  console.log(`publish-canvas: bundle bridge verified with ${bridge.n} views`);
  return bridge.n;
}

function unescapeAttribute(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;');
}

function setMeasuredViews(html, views) {
  const match = html.match(META_TAG_RE);
  if (!match) throw new Error('bundle dg-canvas meta tag could not be parsed');

  const meta = JSON.parse(unescapeAttribute(match[1]));
  if (!meta.caps || typeof meta.caps !== 'object' || Array.isArray(meta.caps)) {
    throw new Error('bundle dg-canvas metadata has no usable caps object');
  }
  meta.caps.views = views;

  const tag = match[0];
  const replacement = tag.replace(
    `content="${match[1]}"`,
    `content="${escapeAttribute(JSON.stringify(meta))}"`,
  );
  return html.replace(tag, replacement);
}

async function publishBundle(html, visuals, file, views) {
  const target = path.resolve(visuals, file);
  const relativeTarget = path.relative(visuals, target);
  if (relativeTarget.startsWith('..') || relativeTarget.includes(path.sep)) {
    throw new Error(`refused: canvas.json: file resolves outside the visuals root: ${file}`);
  }
  const temporary = path.join(visuals, `${file}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, html, 'utf8');
    await rename(temporary, target);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {}
    throw error;
  }
  console.log(`publish-canvas: published ${Buffer.byteLength(html, 'utf8')} bytes with ${views} views to ${target}`);
}

function capturedText(value) {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

function refreshRegistry(board) {
  try {
    execFileSync('node', ['scripts/visuals-sync.mjs'], { cwd: board, stdio: 'inherit' });
  } catch {
    throw new Error('visuals registry sync failed');
  }

  try {
    execFileSync('node', ['--test', 'test/visuals-registry.test.mjs'], {
      cwd: board,
      stdio: 'pipe',
    });
  } catch (error) {
    const output = `${capturedText(error.stdout)}${capturedText(error.stderr)}`;
    if (output) process.stderr.write(output.endsWith('\n') ? output : `${output}\n`);
    throw new Error('visuals registry test failed');
  }

  console.log('publish-canvas: registry regenerated and registry tests passed');
}

async function verifyCanvas(page, id, views) {
  const route = `/canvas?v=${encodeURIComponent(id)}`;
  let response;
  try {
    response = await page.goto(`http://127.0.0.1:4478${route}`, { waitUntil: 'networkidle' });
  } catch (error) {
    if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(formatError(error))) {
      throw new Error(BOARD_UNREACHABLE_ERROR);
    }
    throw error;
  }

  let status = response?.status() ?? 0;
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.canvas-diagram-row').length > 0,
      null,
      { timeout: 15000 },
    );
  } catch {
    // Count below turns the timeout into the required zero-row failure.
  }
  let rows = await page.evaluate(
    () => document.querySelectorAll('.canvas-diagram-row').length,
  );

  if (status === 200 && rows !== views) {
    console.log(`publish-canvas: first canvas read showed ${rows} rows; retrying once after registry settle`);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    response = await page.reload({ waitUntil: 'networkidle' });
    status = response?.status() ?? 0;
    try {
      await page.waitForFunction(
        (expected) => document.querySelectorAll('.canvas-diagram-row').length === expected,
        views,
        { timeout: 15000 },
      );
    } catch {
      // Count below turns the timeout into the required row-count failure.
    }
    rows = await page.evaluate(
      () => document.querySelectorAll('.canvas-diagram-row').length,
    );
  }

  console.log(`publish-canvas: /canvas?v=${id} → ${status}, ${rows} diagram rows (bundle declares ${views})`);
  if (status !== 200) throw new Error(`/canvas?v=${id} returned ${status}, expected 200`);
  if (rows === 0) throw new Error(`/canvas?v=${id} listed no diagram rows`);
  if (rows !== views) {
    throw new Error(`/canvas?v=${id} listed ${rows} diagram rows but bundle declares ${views}`);
  }
}

async function main() {
  const cwd = process.cwd();
  const canvas = await readCanvasConfig(cwd);
  if (!canvas) return;

  const { board, visuals } = await resolveBoard(canvas.board);
  const { bundlePath, html } = await readBundle(cwd);
  const playwright = await loadPlaywright();
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  if (!chromium) throw new Error('The loaded Playwright package does not expose chromium.');

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const views = await inspectBridge(page, bundlePath);
    const publishedHtml = setMeasuredViews(html, views);
    await publishBundle(publishedHtml, visuals, canvas.file, views);
    refreshRegistry(board);
    await verifyCanvas(page, canvas.id, views);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error('publish-canvas: ' + e.message);
    process.exit(1);
  });
}
