#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const serve = argv.includes('--serve');
const positional = argv.filter((value) => !value.startsWith('--'));
const outDir = serve ? (positional[0] ?? 'exports') : positional[1];
let baseUrl = serve ? undefined : positional[0];

if ((!baseUrl && !serve) || !outDir) {
  console.error('Usage: node export-statics.mjs <baseUrl> <outDir>   (or --serve [outDir])');
  process.exit(2);
}

/**
 * --serve: run `vite preview` ourselves and tear it down after, so the whole
 * gate is ONE command. Note localhost, not 127.0.0.1 — vite preview binds ::1
 * and the IPv4 literal gets connection refused.
 */
let previewProcess;
async function startPreview() {
  const port = 4900 + Math.floor(Math.random() * 400);
  previewProcess = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    stdio: 'ignore', detached: false,
  });
  const url = `http://localhost:${port}/`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const response = await fetch(url);
      if (response.ok) return url;
    } catch { /* not listening yet */ }
  }
  throw new Error(`vite preview did not come up on ${url} — run \`npm run build\` first?`);
}
// Any failure from here on must still tear the preview down; a leaked
// listening process is the worst outcome of a failed gate run.
process.on('exit', () => previewProcess?.kill());
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { previewProcess?.kill(); process.exit(1); });
if (serve) baseUrl = await startPreview();

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
    } catch (importError) {
      try {
        return createRequire(import.meta.url)(packagePath);
      } catch (requireError) {
        console.warn(`PLAYWRIGHT_PKG could not be loaded; falling back to playwright.\n${formatError(importError)}\n${formatError(requireError)}`);
      }
    }
  }

  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(`Unable to import Playwright. Set PLAYWRIGHT_PKG or install playwright.\n${formatError(error)}`);
  }
}

const playwright = await loadPlaywright();
const chromium = playwright.chromium ?? playwright.default?.chromium;

if (!chromium) {
  throw new Error('The loaded Playwright package does not expose chromium.');
}

const outputDirectory = path.resolve(outDir);
await mkdir(outputDirectory, { recursive: true });

// Diagram ids are generated with the project and shared by every probe/export.
const manifest = JSON.parse(await readFile(new URL('../arc-diagram.project.json', import.meta.url), 'utf8'));
const diagramIds = manifest.diagramIds;
if (!Array.isArray(diagramIds) || diagramIds.length === 0) throw new Error('arc-diagram.project.json must contain a non-empty diagramIds array');
const themes = ['light', 'dark'];
const CROP_PADDING = 48;
const VIEWPORT = { width: 1920, height: 1080 };
const results = [];

/**
 * Union of every rendered node's screen-space bounding rect (already accounts
 * for pan/zoom — getBoundingClientRect is post-transform), padded and clamped
 * to the viewport. Null if nothing rendered.
 */
async function diagramClipRect(page) {
  const rect = await page.evaluate(() => {
    // Includes legendChrome: its layout box keeps the whole legend in the crop.
    const nodes = document.querySelectorAll('.react-flow__node');
    if (nodes.length === 0) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    nodes.forEach((element) => {
      const box = element.getBoundingClientRect();
      minX = Math.min(minX, box.left);
      minY = Math.min(minY, box.top);
      maxX = Math.max(maxX, box.right);
      maxY = Math.max(maxY, box.bottom);
    });
    return { minX, minY, maxX, maxY };
  });
  if (!rect) return null;
  const x = Math.max(0, rect.minX - CROP_PADDING);
  const y = Math.max(0, rect.minY - CROP_PADDING);
  const right = Math.min(VIEWPORT.width, rect.maxX + CROP_PADDING);
  const bottom = Math.min(VIEWPORT.height, rect.maxY + CROP_PADDING);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/**
 * Hides overlay chrome that must never appear in a diagram-only crop.
 * visibility, NOT display: display:none reflows the page and shifts the
 * content out of the clip rect computed a moment earlier (blank PNGs).
 */
async function hideChrome(page) {
  await page.evaluate(() => {
    ['.dg-topbar', '.react-flow__controls', '.dg-edit-hint', '.dg-download-menu'].forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.style.setProperty('visibility', 'hidden', 'important');
      });
    });
  });
}
const browser = await chromium.launch({ headless: true });

try {
  for (const id of diagramIds) {
    for (const theme of themes) {
      const fileName = `diagram-${id}-${theme}.png`;
      const errors = [];
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        colorScheme: theme,
      });

      await context.addInitScript(({ storageKey, storageValue }) => {
        window.localStorage.setItem(storageKey, storageValue);
      }, { storageKey: 'dg-theme', storageValue: theme });

      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`pageerror: ${formatError(error)}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      page.on('requestfailed', (request) => {
        errors.push(`request: ${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'failed'}`);
      });
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`response: ${response.status()} ${response.url()}`);
      });

      try {
        const url = new URL(baseUrl);
        url.searchParams.set('embed', id);
        await page.goto(url.toString(), { waitUntil: 'networkidle' });
        await page.locator('.react-flow').waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        // Settles the post-mount fitView (rAF + 300ms transition).
        await page.waitForTimeout(900);

        const clip = await diagramClipRect(page);
        if (!clip) errors.push('capture: no .react-flow__node elements found to bound the crop');

        await hideChrome(page);
        await page.screenshot({
          path: path.join(outputDirectory, fileName),
          fullPage: false,
          ...(clip ? { clip } : {}),
        });
      } catch (error) {
        errors.push(`capture: ${formatError(error)}`);
      } finally {
        await context.close();
      }

      results.push({ fileName, errors });
    }
  }
} finally {
  // Independently guarded: a throwing browser.close() must not skip the kill.
  try { await browser.close(); } catch { /* already gone */ }
  previewProcess?.kill();
}

console.log('\nStatic export report');
for (const result of results) {
  console.log(`${result.fileName}: ${result.errors.length === 0 ? 'OK' : `${result.errors.length} error(s)`}`);
  for (const error of result.errors) console.log(`  - ${error}`);
}

if (results.some((result) => result.errors.length > 0)) process.exitCode = 1;
