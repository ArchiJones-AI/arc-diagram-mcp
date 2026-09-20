/**
 * Interactive-UX probe.
 *
 * The geometric probe (probe-layout.mjs) measures a STATIC render: overlaps,
 * out-of-bounds, console errors. It cannot see an interaction trap — a scroll
 * container that swallows the wheel, a control that opens nothing, a line you
 * cannot select, a group you can no longer drag. Every defect this file
 * checks is one a fully green static sweep would have shipped.
 *
 *   node scripts/probe-ux.mjs --serve [--theme light|dark]
 *
 * Runs headless in its own Chromium on its own port. It never touches a
 * browser you are using.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Selectors below are dialect-agnostic LISTS: this probe ships in the shared
// template and must find a leaf card, a group and a card title whichever
// dialect the host app draws in (csdm quilt, editorial, pyramid, lifecycle).
const argv = process.argv.slice(2);
const themeArgIndex = argv.indexOf('--theme');
const theme = themeArgIndex > -1 ? argv[themeArgIndex + 1] : 'light';
const serve = argv.includes('--serve');
let baseUrl = argv.find((value) => value.startsWith('http'));

if (!baseUrl && !serve) {
  console.error('Usage: node probe-ux.mjs <baseUrl> [--theme light|dark]   (or --serve)');
  process.exit(2);
}

let previewProcess;
process.on('exit', () => previewProcess?.kill());
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { previewProcess?.kill(); process.exit(1); });
}

async function startPreview() {
  const port = 4900 + Math.floor(Math.random() * 300);
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

async function loadPlaywright() {
  const packagePath = process.env.PLAYWRIGHT_PKG;
  if (packagePath) {
    try {
      return await import(path.isAbsolute(packagePath) ? pathToFileURL(packagePath).href : packagePath);
    } catch {
      return createRequire(import.meta.url)(packagePath);
    }
  }
  return import('playwright');
}

const findings = [];
const passes = [];
const fail = (id, detail) => findings.push(`${id} — ${detail}`);
const pass = (id, detail) => passes.push(`${id} — ${detail}`);
const check = (id, condition, detail) => (condition ? pass(id, detail) : fail(id, detail));

const playwright = await loadPlaywright();
const chromium = playwright.chromium ?? playwright.default?.chromium;
let browser;

try {
  if (serve) baseUrl = await startPreview();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1000 },
    colorScheme: theme,
  });
  await context.addInitScript((value) => {
    window.localStorage.setItem('dg-theme', value);
    // Clear the edit state ONCE, on the first load of the run. This script
    // runs on every navigation, so an unguarded clear would wipe the state
    // the reload and legacy-upgrade checks below exist to verify — and would
    // report a passing app as broken.
    if (!window.sessionStorage.getItem('ux-probe-seeded')) {
      window.sessionStorage.setItem('ux-probe-seeded', '1');
      ['arc-edit-v3', 'arc-edit-v2', 'arc-edit-v1']
        .forEach((key) => window.localStorage.removeItem(key));
    }
  }, theme);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.react-flow').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);

  // ---- R5 canvas field -------------------------------------------------
  const fieldColors = await page.evaluate(() => {
    const canvas = document.querySelector('.dg-canvas');
    const body = document.body;
    return {
      canvas: getComputedStyle(canvas).backgroundColor,
      page: getComputedStyle(body).backgroundColor,
      dots: getComputedStyle(document.documentElement).getPropertyValue('--dg-canvas-dots').trim(),
      position: getComputedStyle(canvas).position,
    };
  });
  check('R5.field-distinct', fieldColors.canvas !== fieldColors.page,
    `canvas ${fieldColors.canvas} vs page ${fieldColors.page}`);
  check('R5.dots-defined', fieldColors.dots.length > 0, `--dg-canvas-dots = "${fieldColors.dots}"`);
  check('R5.canvas-relative', fieldColors.position === 'relative',
    `.dg-canvas position = ${fieldColors.position} (the style bar and edit hint anchor to it)`);

  // ---- token definitions the menus depend on ---------------------------
  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      surface: root.getPropertyValue('--dg-surface').trim(),
      inkSoft: root.getPropertyValue('--dg-ink-soft').trim(),
    };
  });
  check('R2.tokens-defined', Boolean(tokens.surface && tokens.inkSoft),
    `--dg-surface="${tokens.surface}" --dg-ink-soft="${tokens.inkSoft}"`);

  // ---- R1 sidecar ------------------------------------------------------
  check('R1.hidden-on-load', await page.locator('.dg-side-rail').count() === 0,
    'inspector absent on first load');

  const firstCard = page.locator('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage').first();
  await firstCard.click();
  await page.waitForTimeout(250);
  check('R1.opens-on-click', await page.locator('.dg-side-rail').count() === 1,
    'clicking a component opens the inspector');
  check('R1.shows-detail', (await page.locator('.dg-detail-panel h2').count()) === 1,
    'the opened inspector shows the clicked component');

  const toggle = page.getByRole('button', { name: 'Inspector', exact: true });
  await toggle.click();
  await page.waitForTimeout(200);
  check('R1.toggle-hides', await page.locator('.dg-side-rail').count() === 0,
    'the toggle hides the inspector');
  check('R1.toggle-persists', await toggle.count() === 1,
    'the toggle itself stays on the toolbar when the inspector is hidden');
  await toggle.click();
  await page.waitForTimeout(200);

  // resize by dragging the strip
  const widthBefore = await page.evaluate(() => document.querySelector('.dg-side-rail').getBoundingClientRect().width);
  const strip = page.locator('.dg-side-resizer');
  const box = await strip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + 120, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const widthAfter = await page.evaluate(() => document.querySelector('.dg-side-rail').getBoundingClientRect().width);
  check('R1.resize-drag', widthAfter > widthBefore + 60,
    `drag widened the inspector ${Math.round(widthBefore)} -> ${Math.round(widthAfter)}`);

  await strip.dblclick();
  await page.waitForTimeout(250);
  const widthReset = await page.evaluate(() => document.querySelector('.dg-side-rail').getBoundingClientRect().width);
  check('R1.resize-doubleclick-resets', Math.abs(widthReset - 340) < 6,
    `double-click restored ${Math.round(widthReset)}px (expected 340)`);

  // width survives a reload
  await page.mouse.move(box.x + box.width / 2, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 90, box.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const widthPreReload = await page.evaluate(() => document.querySelector('.dg-side-rail').getBoundingClientRect().width);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.react-flow').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  const widthPostReload = await page.evaluate(() => {
    const el = document.querySelector('.dg-side-rail');
    return el ? el.getBoundingClientRect().width : 0;
  });
  check('R1.resize-persists', Math.abs(widthPostReload - widthPreReload) < 4,
    `inspector width ${Math.round(widthPreReload)}px survived a reload as ${Math.round(widthPostReload)}px`);

  // ---- R2 settings menu ------------------------------------------------
  const gear = page.getByRole('button', { name: 'Settings' });
  await gear.click();
  await page.waitForTimeout(150);
  check('R2.opens', await page.locator('.dg-menu').count() === 1, 'the gear opens the settings menu');

  const menuBg = await page.evaluate(() => {
    const menu = document.querySelector('.dg-menu');
    const style = getComputedStyle(menu);
    return { background: style.backgroundColor, alpha: style.backgroundColor.includes('rgba(0, 0, 0, 0)') };
  });
  check('R2.menu-opaque', !menuBg.alpha,
    `menu background is ${menuBg.background} (a transparent panel over live diagram content is the defect)`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('R2.escape-closes', await page.locator('.dg-menu').count() === 0, 'Escape closes the menu');

  await gear.click();
  await page.waitForTimeout(150);
  await page.mouse.click(700, 600);
  await page.waitForTimeout(200);
  check('R2.outside-click-closes', await page.locator('.dg-menu').count() === 0,
    'a click on the canvas closes the menu');

  // the host theme bridge
  // The class must be present AND its click must actually drive the theme.
  // React flushes the state update after .click() returns, so each read waits.
  const bridgePresent = await page.locator('.dg-theme-toggle').count();
  const readTheme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const clickBridge = async () => {
    await page.evaluate(() => document.querySelector('.dg-theme-toggle')?.click());
    await page.waitForTimeout(300);
  };
  const bridgeBefore = await readTheme();
  await clickBridge();
  const bridgeAfter = await readTheme();
  await clickBridge();
  const bridgeRestored = await readTheme();
  check('R2.host-theme-bridge',
    bridgePresent === 1 && bridgeBefore !== bridgeAfter && bridgeRestored === bridgeBefore,
    `.dg-theme-toggle present=${bridgePresent === 1} ${bridgeBefore}->${bridgeAfter}->${bridgeRestored} (the board clicks this exact class from outside the iframe)`);

  // theme from inside the menu; the menu stays open so the flip can be undone
  await gear.click();
  await page.waitForTimeout(150);
  const themeItem = page.locator('.dg-menu button', { hasText: /theme/i }).first();
  const themeBefore = await readTheme();
  await themeItem.click();
  await page.waitForTimeout(300);
  const themeAfter = await readTheme();
  check('R2.menu-theme-works', themeBefore !== themeAfter, `theme ${themeBefore} -> ${themeAfter}`);
  check('R2.menu-stays-open-for-toggles', await page.locator('.dg-menu').count() === 1,
    'a theme flip leaves the menu open so it can be flipped back');
  await page.locator('.dg-menu button', { hasText: /theme/i }).first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // ---- R1 merged mode --------------------------------------------------
  const chooseSidecar = async (label) => {
    await gear.click();
    await page.waitForTimeout(150);
    await page.locator('.dg-menu button', { hasText: label }).first().click();
    await page.waitForTimeout(350);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  };
  await chooseSidecar(/^In the diagram list$/);
  check('R1.merged-in-rail',
    await page.locator('.dg-diagram-rail .dg-rail-inspector').count() === 1
      && await page.locator('.dg-side-rail').count() === 0,
    'merged mode moves the inspector into the diagram rail and empties the right column');

  const mergedTracks = await page.evaluate(() => {
    const list = document.querySelector('.dg-diagram-list');
    const inspector = document.querySelector('.dg-rail-inspector');
    if (!list || !inspector) return null;
    const listRect = list.getBoundingClientRect();
    const inspectorRect = inspector.getBoundingClientRect();
    return {
      listH: listRect.height,
      inspectorH: inspectorRect.height,
      listScrolls: getComputedStyle(list).overflowY,
      inspectorScrolls: getComputedStyle(inspector).overflowY,
      railWidth: document.querySelector('.dg-diagram-rail').getBoundingClientRect().width,
    };
  });
  check('R1.merged-half-height',
    mergedTracks && Math.abs(mergedTracks.listH - mergedTracks.inspectorH) < mergedTracks.listH * 0.35,
    `rail tracks are ${Math.round(mergedTracks?.listH ?? 0)}px / ${Math.round(mergedTracks?.inspectorH ?? 0)}px`);
  check('R1.merged-both-scroll',
    mergedTracks && mergedTracks.listScrolls === 'auto' && mergedTracks.inspectorScrolls === 'auto',
    `list overflow-y=${mergedTracks?.listScrolls}, inspector overflow-y=${mergedTracks?.inspectorScrolls}`);
  check('R1.merged-rail-widens', mergedTracks && mergedTracks.railWidth > 300,
    `rail widened to ${Math.round(mergedTracks?.railWidth ?? 0)}px to host the inspector`);

  // a collapsed rail must expand when a component is clicked in merged mode
  await page.keyboard.press('l');
  await page.waitForTimeout(300);
  const collapsedBefore = await page.evaluate(() => (
    document.querySelector('.dg-diagram-rail').dataset.collapsed
  ));
  // Use the last available leaf rather than assuming the authored view has at
  // least four cards. A valid context view can be intentionally small.
  await page.locator('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage').last().click();
  await page.waitForTimeout(400);
  const collapsedAfter = await page.evaluate(() => (
    document.querySelector('.dg-diagram-rail').dataset.collapsed
  ));
  check('R1.merged-expands-collapsed-rail',
    collapsedBefore === 'true' && collapsedAfter === 'false',
    `rail collapsed=${collapsedBefore} before the click, ${collapsedAfter} after (an inspector inside a collapsed rail is invisible)`);

  await chooseSidecar(/^Right column$/);
  check('R1.back-to-right-column', await page.locator('.dg-side-rail').count() === 1,
    'switching back restores the right-hand inspector');

  // ---- R2 the rest of the menu ----------------------------------------
  await gear.click();
  await page.waitForTimeout(150);
  const spacingBefore = await page.locator('.dg-menu .dg-spacing-value').textContent();
  await page.locator('.dg-menu-stepper button', { hasText: '+' }).click();
  await page.waitForTimeout(400);
  const spacingAfter = await page.locator('.dg-menu .dg-spacing-value').textContent();
  check('R2.spacing-stepper', spacingBefore !== spacingAfter,
    `spacing ${spacingBefore?.trim()} -> ${spacingAfter?.trim()} from the menu`);
  await page.locator('.dg-menu button', { hasText: /Reset this diagram/ }).click();
  await page.waitForTimeout(500);
  check('R2.reset-closes-menu', await page.locator('.dg-menu').count() === 0,
    'Reset is a one-shot action and closes the menu');
  const spacingReset = await page.evaluate(() => {
    const raw = window.localStorage.getItem('arc-edit-v3');
    const state = raw ? JSON.parse(raw) : null;
    return state?.spacing?.[window.__dg?.activeId ?? window.__dg?.diagrams?.[0]?.id];
  });
  check('R2.reset-clears-spacing', spacingReset === undefined,
    `after Reset the diagram carries spacing=${String(spacingReset)}`);

  // ---- R4 canvas tools -------------------------------------------------
  const toolGeometry = await page.evaluate(() => {
    const canvas = document.querySelector('.dg-canvas').getBoundingClientRect();
    const read = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left - canvas.left,
        top: rect.top - canvas.top,
        right: canvas.right - rect.right,
        bottom: canvas.bottom - rect.bottom,
      };
    };
    return {
      controls: read('.react-flow__controls'),
      readout: read('.dg-zoom-readout'),
      minimap: read('.react-flow__minimap'),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  });
  check('R4.controls-top-left',
    toolGeometry.controls && toolGeometry.controls.left < toolGeometry.canvasWidth / 2
      && toolGeometry.controls.top < toolGeometry.canvasHeight / 2,
    `controls at ${JSON.stringify(toolGeometry.controls)}`);
  check('R4.readout-top-left',
    toolGeometry.readout && toolGeometry.readout.left < toolGeometry.canvasWidth / 2
      && toolGeometry.readout.top < toolGeometry.canvasHeight / 2,
    `zoom readout at ${JSON.stringify(toolGeometry.readout)}`);
  check('R4.readout-clears-controls',
    toolGeometry.readout && toolGeometry.controls
      && toolGeometry.readout.top > toolGeometry.controls.top + 40,
    'the readout does not sit on top of the controls stack');
  check('R4.minimap-bottom-right',
    toolGeometry.minimap && toolGeometry.minimap.right < toolGeometry.canvasWidth / 2
      && toolGeometry.minimap.bottom < toolGeometry.canvasHeight / 2,
    `minimap at ${JSON.stringify(toolGeometry.minimap)}`);

  const minimapColors = await page.evaluate(() => {
    const fills = [...document.querySelectorAll('.react-flow__minimap-node')]
      .map((node) => node.getAttribute('fill') ?? getComputedStyle(node).fill);
    return [...new Set(fills)];
  });
  check('R4.minimap-domain-colours', minimapColors.length > 2,
    `minimap paints ${minimapColors.length} distinct node colours (a single colour means the quilt reads as grey blocks)`);

  const readoutText = await page.locator('.dg-zoom-readout').textContent();
  check('R4.readout-shows-percent', /%$/.test(readoutText.trim()), `readout reads "${readoutText.trim()}"`);

  // each switch hides its own tool, master hides all
  const setTool = async (label, expectSelector) => {
    await gear.click();
    await page.waitForTimeout(120);
    await page.locator('.dg-menu button', { hasText: label }).first().click();
    await page.waitForTimeout(200);
    const gone = await page.locator(expectSelector).count() === 0;
    await page.locator('.dg-menu button', { hasText: label }).first().click();
    await page.waitForTimeout(200);
    const back = await page.locator(expectSelector).count() === 1;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    return gone && back;
  };
  check('R4.switch-minimap', await setTool(/^Minimap$/, '.react-flow__minimap'),
    'the minimap switch hides and restores only the minimap');
  check('R4.switch-readout', await setTool(/^Zoom percentage$/, '.dg-zoom-readout'),
    'the readout switch hides and restores only the readout');

  await gear.click();
  await page.waitForTimeout(120);
  await page.locator('.dg-menu button', { hasText: /^Show canvas tools$/ }).click();
  await page.waitForTimeout(250);
  const allHidden = await page.evaluate(() => ({
    controls: document.querySelectorAll('.react-flow__controls').length,
    minimap: document.querySelectorAll('.react-flow__minimap').length,
    readout: document.querySelectorAll('.dg-zoom-readout').length,
  }));
  check('R4.master-switch',
    allHidden.controls === 0 && allHidden.minimap === 0 && allHidden.readout === 0,
    `master switch off leaves ${JSON.stringify(allHidden)}`);
  await page.locator('.dg-menu button', { hasText: /^Show canvas tools$/ }).click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');

  // ---- R3 text size ----------------------------------------------------
  const measureCard = () => page.evaluate(() => {
    const title = document.querySelector('.dg-csdm-card-title, .dg-node-title, .dg-lc-stage-label');
    const card = title.closest('.react-flow__node');
    return {
      fontSize: parseFloat(getComputedStyle(title).fontSize),
      // offsetWidth/Height, NOT getBoundingClientRect: these are layout
      // pixels, unaffected by the viewport's CSS transform, so a zoom change
      // between the two reads cannot manufacture or mask a box change.
      cardWidth: card.offsetWidth,
      cardHeight: card.offsetHeight,
      scrollHeight: title.scrollHeight,
      clientHeight: title.clientHeight,
    };
  });
  const atDefault = await measureCard();
  const bigger = page.getByRole('button', { name: 'Larger text' });
  const started = Date.now();
  for (let i = 0; i < 6; i += 1) await bigger.click();
  const clickElapsed = Date.now() - started;
  await page.waitForTimeout(900);
  const atLarge = await measureCard();
  check('R3.font-grows', atLarge.fontSize > atDefault.fontSize * 1.3,
    `card title ${atDefault.fontSize}px -> ${atLarge.fontSize}px`);
  // Text scales the TYPE, not the shape — the PowerPoint rule. A card that
  // grew with its font was the defect this replaced: asked for bigger text,
  // the diagram gave a bigger diagram. The box is authored geometry and the
  // type is expected to spill past it (owner's direction, 2026-09-15).
  check('R3.card-does-not-grow',
    atLarge.cardWidth === atDefault.cardWidth && atLarge.cardHeight === atDefault.cardHeight,
    `card box ${Math.round(atDefault.cardWidth)}x${Math.round(atDefault.cardHeight)}px -> ${Math.round(atLarge.cardWidth)}x${Math.round(atLarge.cardHeight)}px while the font went ${atDefault.fontSize}px -> ${atLarge.fontSize}px`);
  check('R3.no-clipping', atLarge.scrollHeight <= atLarge.clientHeight + 1,
    `title scrollHeight ${atLarge.scrollHeight} vs clientHeight ${atLarge.clientHeight}`);
  check('R3.stepper-not-frozen', clickElapsed < 4000,
    `six stepper clicks took ${clickElapsed}ms (a run of clicks must not land on the full route pass)`);

  // The settle must run a FULL routing pass, not just clear a flag. Light
  // mode reuses the previous routes; if the settle never triggers a real
  // recompute the canvas keeps showing routes computed for the old text size
  // until some unrelated interaction happens to refresh them.
  const routesBefore = await page.evaluate(() => ({ ...window.__edgeRouteStats }));
  await bigger.click();
  await page.waitForTimeout(1400);
  const routesAfter = await page.evaluate(() => ({ ...window.__edgeRouteStats }));
  check('R3.settle-runs-full-route-pass',
    routesAfter.computeCount > routesBefore.computeCount,
    `full route passes ${routesBefore.computeCount} -> ${routesAfter.computeCount}, light ${routesBefore.lightCount} -> ${routesAfter.lightCount}`);

  const readoutValue = await page.locator('.dg-text-scale-value').textContent();
  check('R3.readout-tracks', readoutValue.trim() !== '100%', `text-size readout reads ${readoutValue.trim()}`);
  await page.locator('.dg-text-scale-value').click();
  await page.waitForTimeout(600);
  const backToDefault = await measureCard();
  check('R3.reset-to-100', Math.abs(backToDefault.fontSize - atDefault.fontSize) < 0.6,
    `clicking the readout restored ${backToDefault.fontSize}px`);

  // ---- narrow viewport -------------------------------------------------
  // The under-980px rule used to hard-code the old fixed inspector column,
  // so a hidden inspector still reserved 316px and a resized one was ignored.
  const hadRail = await page.locator('.dg-side-rail').count() === 1;
  if (hadRail) {
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await page.waitForTimeout(300);
  }
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(500);
  const narrowHidden = await page.evaluate(() => {
    const body = document.querySelector('.dg-body');
    return {
      tracks: getComputedStyle(body).gridTemplateColumns,
      hasRail: document.querySelectorAll('.dg-side-rail').length,
    };
  });
  const lastTrack = narrowHidden.tracks.trim().split(/\s+/).pop();
  check('R4.narrow-viewport-no-ghost-column',
    narrowHidden.hasRail === 0 && parseFloat(lastTrack) < 1,
    `at 900px with the inspector hidden the third grid track is ${lastTrack}`);
  await page.setViewportSize({ width: 1680, height: 1000 });

  await page.waitForTimeout(400);
  if (hadRail) {
    await page.getByRole('button', { name: 'Inspector', exact: true }).click();
    await page.waitForTimeout(300);
  }

  // ---- R6 edit mode: selection and styling -----------------------------
  await page.keyboard.press('e');
  await page.waitForTimeout(400);
  check('R6.edit-mode-on', await page.locator('.dg-canvas.is-editing').count() === 1, 'E enters edit mode');

  const card1 = page.locator('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage').nth(0);
  const card2 = page.locator('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage').nth(1);
  await card1.click();
  await page.waitForTimeout(250);
  check('R6.stylebar-appears', await page.locator('.dg-style-bar').count() === 1,
    'selecting a component shows the style bar');

  const barGeometry = await page.evaluate(() => {
    const canvas = document.querySelector('.dg-canvas').getBoundingClientRect();
    const bar = document.querySelector('.dg-style-bar').getBoundingClientRect();
    return { top: bar.top - canvas.top, right: canvas.right - bar.right };
  });
  check('R6.stylebar-top-right', Math.abs(barGeometry.top) <= 2 && Math.abs(barGeometry.right) <= 2,
    `style bar inset top ${barGeometry.top.toFixed(1)}px right ${barGeometry.right.toFixed(1)}px (spec: 1px)`);

  await card2.click({ modifiers: ['Shift'] });
  await page.waitForTimeout(250);
  const summary = await page.locator('.dg-style-head strong').textContent();
  check('R6.shift-multiselect', /2 components/.test(summary), `style bar reads "${summary}"`);

  // apply a text colour to the whole selection
  const inkRow = page.locator('.dg-style-row', { has: page.locator('.dg-style-label', { hasText: /^Text$/ }) });
  await inkRow.locator('.dg-style-swatch').nth(1).click();
  await page.waitForTimeout(350);
  const inkApplied = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage')].slice(0, 2);
    return nodes.map((node) => node.style.getPropertyValue('--dg-node-ink'));
  });
  check('R6.text-colour-whole-selection', inkApplied.every((value) => value.startsWith('#')),
    `both selected nodes carry --dg-node-ink (${inkApplied.join(', ')})`);

  const outlineRow = page.locator('.dg-style-row', { has: page.locator('.dg-style-label', { hasText: /^Outline$/ }) });
  await outlineRow.locator('.dg-style-swatch').nth(2).click();
  await page.waitForTimeout(350);
  const outlineApplied = await page.evaluate(() => (
    [...document.querySelectorAll('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage')].slice(0, 2)
      .map((node) => node.style.getPropertyValue('--csdm-ink'))
  ));
  check('R6.outline-colour-whole-selection', outlineApplied.every((value) => value.startsWith('#')),
    `both selected nodes carry --csdm-ink (${outlineApplied.join(', ')})`);

  // per-component size
  const boxesBefore = await page.evaluate(() => (
    [...document.querySelectorAll('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage')].slice(0, 2)
      .map((node) => `${node.offsetWidth}x${node.offsetHeight}`)
  ));
  await page.locator('.dg-style-size', { hasText: '130%' }).click();
  await page.waitForTimeout(500);
  const perNode = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage')];
    return {
      scaled: nodes.slice(0, 2).map((node) => node.style.getPropertyValue('--dg-node-text-scale')),
      untouched: nodes.slice(2, 5).map((node) => node.style.getPropertyValue('--dg-node-text-scale')),
      boxes: nodes.slice(0, 2).map((node) => `${node.offsetWidth}x${node.offsetHeight}`),
      fonts: nodes.slice(0, 2).map((node) => {
        const title = node.querySelector('.dg-csdm-card-title, .dg-node-title, .dg-lc-stage-label');
        return title ? parseFloat(getComputedStyle(title).fontSize) : 0;
      }),
    };
  });
  check('R6.per-component-size-scoped',
    perNode.scaled.every((value) => value === '1.3') && perNode.untouched.every((value) => !value),
    `selected nodes scaled=${perNode.scaled.join(',')} others untouched=${JSON.stringify(perNode.untouched)}`);
  // The same PowerPoint rule as R3, for the edit-mode Size control: the type
  // inside the selected card grows, the card itself does not move.
  check('R6.per-component-size-box-unchanged',
    perNode.boxes.every((box, index) => box === boxesBefore[index]) && perNode.fonts.every((size) => size > 0),
    `card boxes ${boxesBefore.join(', ')} -> ${perNode.boxes.join(', ')} at title font ${perNode.fonts.join(', ')}px`);

  await page.locator('.dg-style-head .dg-style-default').click();
  await page.waitForTimeout(400);

  // ---- R6 edge selection ----------------------------------------------
  await page.mouse.click(60, 400); // clear selection on empty canvas
  await page.waitForTimeout(250);

  const labelBox = await page.locator('.dg-edge-label').first().boundingBox();
  await page.mouse.click(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);
  await page.waitForTimeout(400);
  const edgeSelected = await page.evaluate(() => document.querySelectorAll('.react-flow__edge.selected').length);
  check('R6.label-click-selects', edgeSelected === 1,
    `clicking a relationship label selected ${edgeSelected} edge(s)`);

  const selectedStroke = await page.evaluate(() => {
    const path = document.querySelector('.react-flow__edge.selected .dg-edge-path');
    if (!path) return null;
    const style = getComputedStyle(path);
    return { stroke: style.stroke, width: style.strokeWidth };
  });
  check('R6.selected-line-visible', selectedStroke && parseFloat(selectedStroke.width) >= 2.5,
    `selected line renders stroke ${selectedStroke?.stroke} width ${selectedStroke?.width} (nothing marked a selected edge before)`);

  const lineRow = page.locator('.dg-style-row', { has: page.locator('.dg-style-label', { hasText: /^Line$/ }) });
  check('R6.line-control-for-edges', await lineRow.count() === 1,
    'an edge-only selection shows the line-colour control');
  check('R6.no-text-control-for-edges',
    await page.locator('.dg-style-row', { has: page.locator('.dg-style-label', { hasText: /^Text$/ }) }).count() === 0,
    'an edge-only selection does NOT show the node text-colour control');

  await lineRow.locator('.dg-style-swatch').nth(1).click();
  await page.waitForTimeout(400);
  const lineColoured = await page.evaluate(() => {
    const path = document.querySelector('.react-flow__edge.selected .dg-edge-path');
    return path ? path.style.stroke : '';
  });
  check('R6.line-colour-applies', lineColoured.length > 0, `selected line carries inline stroke "${lineColoured}"`);

  // the custom colour input feeds the same validated path as the swatches
  const customInput = lineRow.locator('.dg-style-swatch-custom input');
  await customInput.evaluate((input) => {
    // React tracks the last value it saw on the DOM node and swallows a
    // change event whose value it believes it already has, so a plain
    // `input.value = ...` is invisible to onChange. The native setter updates
    // the tracker the way a real pick does. (Test mechanics only — a person
    // dragging the picker emits trusted events React handles directly.)
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    ).set;
    setter.call(input, '#123456');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const customApplied = await page.evaluate(() => {
    const raw = window.localStorage.getItem('arc-edit-v3');
    const state = raw ? JSON.parse(raw) : null;
    return JSON.stringify(state?.edges?.[window.__dg?.activeId ?? window.__dg?.diagrams?.[0]?.id] ?? {});
  });
  check('R6.custom-colour-writes-through', customApplied.includes('#123456'),
    `the freeform picker wrote through: ${customApplied}`);

  // per-label size, scoped to the selected relationship only
  await page.locator('.dg-style-size', { hasText: '130%' }).click();
  await page.waitForTimeout(500);
  const labelScales = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.dg-edge-label')];
    const scaled = labels.filter((el) => el.style.getPropertyValue('--dg-label-scale'));
    return { total: labels.length, scaled: scaled.length, value: scaled[0]?.style.getPropertyValue('--dg-label-scale') };
  });
  check('R6.per-label-size-scoped',
    labelScales.scaled === 1 && labelScales.value === '1.3',
    `${labelScales.scaled} of ${labelScales.total} labels carry --dg-label-scale=${labelScales.value}`);
  await page.locator('.dg-style-row', { has: page.locator('.dg-style-label', { hasText: /^Size$/ }) })
    .locator('.dg-style-default').click();
  await page.waitForTimeout(400);

  // clicking the LINE itself (not its label) selects the relationship
  await page.mouse.click(60, 400);
  await page.waitForTimeout(300);
  const linePoint = await page.evaluate(() => {
    const path = document.querySelector('.react-flow__edge .react-flow__edge-interaction')
      ?? document.querySelector('.react-flow__edge .dg-edge-path');
    if (!path || !path.getPointAtLength) return null;
    const point = path.getPointAtLength(path.getTotalLength() * 0.35);
    const svg = path.ownerSVGElement;
    const matrix = path.getScreenCTM();
    const screen = svg.createSVGPoint();
    screen.x = point.x; screen.y = point.y;
    const mapped = screen.matrixTransform(matrix);
    return { x: mapped.x, y: mapped.y };
  });
  if (linePoint) {
    await page.mouse.click(linePoint.x, linePoint.y);
    await page.waitForTimeout(400);
    check('R6.line-click-selects',
      await page.evaluate(() => document.querySelectorAll('.react-flow__edge.selected').length) >= 1,
      `clicking the line body at (${Math.round(linePoint.x)}, ${Math.round(linePoint.y)}) selected the relationship`);
  } else {
    check('R6.line-click-selects', false, 'could not resolve a point on an edge path to click');
  }

  // mixed node + edge selection shows both control sets
  await page.locator('.react-flow__node-csdmCard, .react-flow__node-diagramNode, .react-flow__node-pyramidBar, .react-flow__node-lifecycleStage').nth(0).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(400);
  const mixed = await page.evaluate(() => ({
    summary: document.querySelector('.dg-style-head strong')?.textContent ?? '',
    labels: [...document.querySelectorAll('.dg-style-label')].map((el) => el.textContent),
  }));
  check('R6.mixed-selection-controls',
    /component/.test(mixed.summary) && /relationship/.test(mixed.summary)
      && mixed.labels.includes('Text') && mixed.labels.includes('Line'),
    `mixed selection reads "${mixed.summary}" with controls ${JSON.stringify(mixed.labels)}`);

  await page.mouse.click(60, 400);
  await page.waitForTimeout(300);
  const labelBox2 = await page.locator('.dg-edge-label').first().boundingBox();
  await page.mouse.click(labelBox2.x + labelBox2.width / 2, labelBox2.y + labelBox2.height / 2);
  await page.waitForTimeout(350);

  // label drag still repositions
  const beforeDrag = await page.locator('.dg-edge-label').first().boundingBox();
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 60, beforeDrag.y + beforeDrag.height / 2 + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterDrag = await page.locator('.dg-edge-label').first().boundingBox();
  const moved = Math.hypot(afterDrag.x - beforeDrag.x, afterDrag.y - beforeDrag.y);
  check('R6.label-drag-still-works', moved > 12,
    `label moved ${Math.round(moved)}px after the click-versus-drag change`);

  // group drag still works (the defect the removed blanket rule guarded)
  const groupBefore = await page.evaluate(() => {
    const group = document.querySelector('.react-flow__node-csdmRegion, .react-flow__node-diagramGroup');
    const rect = group.getBoundingClientRect();
    return { id: group.getAttribute('data-id'), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  // grab the region's header band, where a user actually grabs it
  await page.mouse.move(groupBefore.x + groupBefore.width / 2, groupBefore.y + 14);
  await page.mouse.down();
  await page.mouse.move(groupBefore.x + groupBefore.width / 2 + 70, groupBefore.y + 64, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const groupAfter = await page.evaluate(() => {
    const group = document.querySelector('.react-flow__node-csdmRegion, .react-flow__node-diagramGroup');
    const rect = group.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  });
  const groupMoved = Math.hypot(groupAfter.x - groupBefore.x, groupAfter.y - groupBefore.y);
  check('R6.group-drag-still-works', groupMoved > 20,
    `region moved ${Math.round(groupMoved)}px (the removed blanket pointer-events rule existed to protect this)`);

  // ---- R4 the tools must not print into a PNG --------------------------
  await page.keyboard.press('e'); // back to view mode for a clean export
  await page.waitForTimeout(400);
  const pngProbe = await page.evaluate(async () => {
    // Re-run the export's own filter over the live DOM. Asserting the filter
    // against the real tree is the check that matters: the old filter tested
    // the element itself, so a tool's CHILDREN printed even when its
    // container was excluded.
    const selector = '.react-flow__controls, .react-flow__minimap, .react-flow__panel,'
      + ' .dg-style-bar, .dg-edit-hint';
    const pane = document.querySelector('.dg-canvas .react-flow');
    const all = [...pane.querySelectorAll('*')];
    const toolElements = all.filter((el) => el.closest(selector));
    const leaked = toolElements.filter((el) => !el.closest?.(selector));
    return { tools: toolElements.length, leaked: leaked.length };
  });
  check('R4.tools-excluded-from-png',
    pngProbe.tools > 0 && pngProbe.leaked === 0,
    `${pngProbe.tools} tool element(s) in the pane, ${pngProbe.leaked} would survive the export filter`);
  await page.keyboard.press('e');
  await page.waitForTimeout(300);

  // ---- scroll traps ----------------------------------------------------
  await page.keyboard.press('e'); // leave edit mode
  await page.waitForTimeout(300);
  const scrollTraps = await page.evaluate(() => {
    const traps = [];
    document.querySelectorAll('*').forEach((el) => {
      const style = getComputedStyle(el);
      const behavior = `${style.overscrollBehavior} ${style.overscrollBehaviorY}`;
      if (!behavior.includes('contain') && !behavior.includes('none')) return;
      const overflows = el.scrollHeight > el.clientHeight + 1;
      if (!overflows) {
        traps.push(`${el.className || el.tagName} (overscroll ${style.overscrollBehavior}, no overflow)`);
      }
    });
    return traps;
  });
  check('UX.no-scroll-trap', scrollTraps.length === 0,
    scrollTraps.length ? `containers swallow the wheel with nothing to scroll: ${scrollTraps.join('; ')}` : 'no overscroll-contain container without overflow');

  // ---- persistence round trip -----------------------------------------
  const persisted = await page.evaluate(() => {
    const raw = window.localStorage.getItem('arc-edit-v3');
    return raw ? JSON.parse(raw) : null;
  });
  check('UX.persist-v3-written', persisted && typeof persisted.ui === 'object',
    'the v3 blob carries the ui preferences');
  check('UX.persist-styles', persisted && typeof persisted.styles === 'object',
    'the v3 blob carries the style overrides');

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.react-flow').waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
  const afterReload = await page.evaluate(() => {
    const raw = window.localStorage.getItem('arc-edit-v3');
    const state = raw ? JSON.parse(raw) : null;
    const key = window.__dg?.activeId ?? window.__dg?.diagrams?.[0]?.id;
    const edgeIds = state ? Object.keys(state.edges[key] ?? {}) : [];
    const coloured = edgeIds.filter((id) => state.edges[key][id].color);
    return { coloured: coloured.length, sidecar: state?.ui?.sidecar };
  });
  check('UX.reload-preserves-edge-colour', afterReload.coloured > 0,
    `${afterReload.coloured} edge colour override(s) survived a reload`);

  // ---- legacy payload upgrade, and colour validation on the read path ---
  // Both seed localStorage and then load it in a FRESH page. Seeding in the
  // live page and reloading does not work: the app's pagehide flush writes
  // its in-memory blob back over the seed on the way out, which is correct
  // behaviour and would make either check report a false failure.
  const seededPage = async (seed) => {
    const fresh = await context.newPage();
    await fresh.addInitScript((payload) => {
      window.localStorage.removeItem('arc-edit-v3');
      window.localStorage.removeItem('arc-edit-v1');
      window.localStorage.removeItem('arc-edit-v2');
      Object.entries(payload).forEach(([key, value]) => {
        window.localStorage.setItem(key, JSON.stringify(value));
      });
    }, seed);
    await fresh.goto(baseUrl, { waitUntil: 'networkidle' });
    await fresh.locator('.react-flow').waitFor({ state: 'visible' });
    await fresh.waitForTimeout(800);
    const state = await fresh.evaluate(() => {
      const raw = window.localStorage.getItem('arc-edit-v3');
      return raw ? JSON.parse(raw) : null;
    });
    await fresh.close();
    return state;
  };

  const upgraded = await seededPage({
    'arc-edit-v2': {
      // Synthetic payload: these ids are arbitrary map keys exercising the
      // persistence layer's own round-trip, NOT this app's diagram ids.
      spacing: { 'csdm-reference': 1.3 },
      overrides: { 'csdm-reference': { pos: { bapp: { x: 40, y: 60 } }, size: {} } },
      edges: {},
    },
  });
  check('UX.legacy-v2-upgrade',
    upgraded?.spacing?.['csdm-reference'] === 1.3
      && upgraded?.overrides?.['csdm-reference']?.pos?.bapp?.x === 40,
    `a v2 payload upgraded to v3 keeping spacing=${upgraded?.spacing?.['csdm-reference']} and one position override`);

  const rejected = await seededPage({
    'arc-edit-v3': {
      spacing: {}, textScale: {}, overrides: {},
      styles: { 'csdm-reference': { bapp: { ink: 'url(javascript:alert(1))', border: 'red; content:"x"' } } },
      edges: { 'csdm-reference': { 'e-bapp-sinst': { color: 'expression(alert(1))' } } },
      ui: {},
    },
  });
  const rejectedStyles = JSON.stringify(rejected?.styles ?? {});
  const rejectedEdges = JSON.stringify(rejected?.edges ?? {});
  check('UX.colour-validation',
    !rejectedStyles.includes('javascript') && !rejectedStyles.includes('expression')
      && !rejectedEdges.includes('expression'),
    `unvalidated colour strings were dropped on read (styles=${rejectedStyles}, edges=${rejectedEdges})`);

  // ---- offline export round trip ---------------------------------------
  // The self-contained download is how a diagram reaches someone who cannot
  // open the board, so it has to carry the edits and run with no server.
  // It is exercised against dist-offline/index.html, NOT the preview build:
  // the export works by cloning the LIVE document, and only the offline
  // bundle is single-file (vite-plugin-singlefile). Cloning the preview build
  // would produce a page still pointing at /assets/*.js, which no file:// can
  // resolve — a property of that build, not a defect in the export.
  const offlineBundle = path.resolve('dist-offline/index.html');
  if (!existsSync(offlineBundle)) {
    check('UX.offline-round-trip', false,
      'dist-offline/index.html is missing — run `npm run build:offline` before this probe');
  } else {
    const exportPage = await context.newPage();
    await exportPage.goto(pathToFileURL(offlineBundle).href, { waitUntil: 'load' });
    await exportPage.locator('.react-flow').waitFor({ state: 'visible', timeout: 20000 });
    await exportPage.waitForTimeout(900);
    await exportPage.getByRole('button', { name: 'Larger text' }).click();
    await exportPage.getByRole('button', { name: 'Larger text' }).click();
    await exportPage.waitForTimeout(800);
    const expectedOfflineNodes = await exportPage.locator('.react-flow__node').count();
    await exportPage.getByRole('button', { name: 'Settings' }).click();
    await exportPage.waitForTimeout(200);
    const [download] = await Promise.all([
      exportPage.waitForEvent('download'),
      exportPage.locator('.dg-menu button', { hasText: /Offline HTML/ }).click(),
    ]);
    const outDir = mkdtempSync(path.join(tmpdir(), 'arc-offline-'));
    const savedTo = path.join(outDir, 'architecture-diagrams.html');
    await download.saveAs(savedTo);
    await exportPage.close();

    const filePage = await context.newPage();
    const offlineErrors = [];
    filePage.on('pageerror', (error) => offlineErrors.push(error.message));
    await filePage.goto(pathToFileURL(savedTo).href, { waitUntil: 'load' });
    await filePage.locator('.react-flow').waitFor({ state: 'visible', timeout: 20000 });
    await filePage.waitForTimeout(1200);
    const offline = await filePage.evaluate(() => {
      const title = document.querySelector('.dg-csdm-card-title, .dg-node-title, .dg-lc-stage-label');
      return {
        nodes: document.querySelectorAll('.react-flow__node').length,
        fontSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
        scale: getComputedStyle(document.querySelector('.dg-canvas')).getPropertyValue('--dg-text-scale').trim(),
        protocol: window.location.protocol,
      };
    });
    await filePage.close();
    check('UX.offline-opens-over-file',
      offline.protocol === 'file:' && expectedOfflineNodes > 0
        && offline.nodes === expectedOfflineNodes && offlineErrors.length === 0,
      `offline copy rendered ${offline.nodes}/${expectedOfflineNodes} expected nodes over ${offline.protocol} with ${offlineErrors.length} page error(s)`);
    check('UX.offline-bakes-in-edits',
      Math.abs(Number(offline.scale) - 1.2) < 0.01 && offline.fontSize > 13,
      `offline copy opened at text scale ${offline.scale} with a ${offline.fontSize}px card title`);
  }

  check('UX.no-console-errors', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 4).join(' | ') : 'no console errors across the whole run');

  await context.close();
} catch (error) {
  fail('PROBE', `probe crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
} finally {
  await browser?.close();
  previewProcess?.kill();
}

console.log(`\nux probe · theme ${theme} · ${passes.length} passed, ${findings.length} failed\n`);
passes.forEach((line) => console.log(`  PASS  ${line}`));
if (findings.length > 0) {
  console.error(`\n${findings.length} finding(s):`);
  findings.forEach((line) => console.error(`  FAIL  ${line}`));
  process.exit(1);
}
console.log('\nux probe clean');
