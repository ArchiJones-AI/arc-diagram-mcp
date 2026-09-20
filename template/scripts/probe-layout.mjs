#!/usr/bin/env node
/**
 * Geometric layout probe — the gate that replaces "screenshot, look, adjust".
 *
 * For every diagram, in embed mode, it reports six defect classes that used
 * to be found by eye (and often by the client, not the build):
 *   1. console errors (buildGraph shouts here about edges that will not render)
 *   2. card-on-card overlap  — cramped layouts, colliding col/row hints
 *   3. edge-label chip overlap — the EDGE_POSITION_FRACTIONS tuning signal
 *   4. edge label on card — chip obscures a leaf card
 *   5. floating edge through card — relationship crosses a non-endpoint card
 *   6. annotation on a sibling — an owner/status/control chip painted over a
 *      neighbouring card or an edge label (the controls-and-ownership overlay)
 *
 * Usage:
 *   npm run probe                                  — builds nothing, serves dist itself
 *   node scripts/probe-layout.mjs <baseUrl>        — against an already-served build
 *   ... [--theme light|dark]
 *
 * Exits non-zero when anything is found, so it can gate a build.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const themeArgIndex = argv.indexOf('--theme');
const theme = themeArgIndex > -1 ? argv[themeArgIndex + 1] : 'light';
const serve = argv.includes('--serve');
/**
 * --text-scale <n>: run the whole defect sweep with the global text scale
 * seeded to n. Scaled text is the change most likely to produce overlap or
 * out-of-bounds geometry, and a default-scale run cannot see it.
 */
const textScaleArgIndex = argv.indexOf('--text-scale');
const textScale = textScaleArgIndex > -1 ? Number(argv[textScaleArgIndex + 1]) : 1;
if (!Number.isFinite(textScale) || textScale <= 0) {
  console.error(`--text-scale must be a positive number (got ${argv[textScaleArgIndex + 1]})`);
  process.exit(2);
}
/**
 * --spill: list the individual spilling elements, not just the counts. The
 * summary line always prints; this is for choosing a working scale from the
 * actual worst offenders.
 */
const verboseSpill = argv.includes('--spill');
let baseUrl = argv.find((value) => value.startsWith('http'));

if (!baseUrl && !serve) {
  console.error('Usage: node probe-layout.mjs <baseUrl> [--theme light|dark]   (or --serve)');
  process.exit(2);
}

/**
 * --serve: run `vite preview` ourselves and tear it down after. Note localhost,
 * not 127.0.0.1 — vite preview binds ::1 and the IPv4 literal gets connection
 * refused.
 */
let previewProcess;
process.on('exit', () => previewProcess?.kill());
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { previewProcess?.kill(); process.exit(1); });
async function startPreview() {
  const port = 4500 + Math.floor(Math.random() * 400);
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

// Diagram ids are generated with the project and shared by every probe/export.
const manifest = JSON.parse(await readFile(new URL('../arc-diagram.project.json', import.meta.url), 'utf8'));
const diagramIds = manifest.diagramIds;
if (!Array.isArray(diagramIds) || diagramIds.length === 0) throw new Error('arc-diagram.project.json must contain a non-empty diagramIds array');

const formatError = (error) => (error instanceof Error ? error.stack ?? error.message : String(error));

async function loadPlaywright() {
  const packagePath = process.env.PLAYWRIGHT_PKG;
  if (packagePath) {
    try {
      // ESM import() of a package DIRECTORY fails (ERR_UNSUPPORTED_DIR_IMPORT);
      // the createRequire fallback below is the working path for a global install.
      return await import(path.isAbsolute(packagePath) ? pathToFileURL(packagePath).href : packagePath);
    } catch {
      return createRequire(import.meta.url)(packagePath);
    }
  }
  return import('playwright');
}

const playwright = await loadPlaywright();
const chromium = playwright.chromium ?? playwright.default?.chromium;

const findings = [];
let browser;

try {
  if (serve) baseUrl = await startPreview();
  browser = await chromium.launch({ headless: true });
  for (const id of diagramIds) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      colorScheme: theme,
    });
    await context.addInitScript((seed) => {
      window.localStorage.setItem('dg-theme', seed.theme);
      if (seed.textScale !== 1) {
        window.localStorage.setItem('arc-edit-v3', JSON.stringify({
          spacing: {},
          textScale: Object.fromEntries(seed.diagramIds.map((id) => [id, seed.textScale])),
          overrides: {},
          styles: {},
          edges: {},
          ui: { sidecar: 'hidden', sideWidth: 340, tools: { master: true, zoom: true, lock: true, minimap: true, readout: true } },
        }));
      }
    }, { theme, textScale, diagramIds });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(formatError(error)));

    const url = new URL(baseUrl);
    url.searchParams.set('embed', id);
    await page.goto(url.toString(), { waitUntil: 'networkidle' });
    await page.locator('.react-flow').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);

    const geometry = await page.evaluate(() => {
      const rects = (selector, label) => [...document.querySelectorAll(selector)].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          id: element.getAttribute('data-id')
            ?? element.getAttribute('data-edge-id')
            ?? element.textContent?.trim().slice(0, 40)
            ?? label,
          left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        };
      });
      const overlaps = (items, tolerance) => {
        const hits = [];
        for (let i = 0; i < items.length; i += 1) {
          for (let j = i + 1; j < items.length; j += 1) {
            const a = items[i]; const b = items[j];
            const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (dx > tolerance && dy > tolerance) hits.push(`${a.id} ↔ ${b.id}`);
          }
        }
        return hits;
      };
      // Group/chrome containers are excluded: their children legitimately sit inside them.
      const cards = rects([
        '.react-flow__node-diagramNode',
        '.react-flow__node-awsTile',
        '.react-flow__node-pyramidBar',
        '.react-flow__node-csdmCard',
        '.react-flow__node-lifecycleStage',
        '.react-flow__node-lifecycleBand',
      ].join(','), 'node');
      // `.dg-edge-annotation` is an edge that carries control tags but no text
      // label. It is the same class of obstacle and the same class of defect,
      // so it belongs in every check the labelled chips are in.
      const labels = rects('.dg-edge-label, .dg-edge-annotation', 'label');
      const labelCardOverlaps = [];
      labels.forEach((label) => {
        cards.forEach((card) => {
          const dx = Math.min(label.right, card.right) - Math.max(label.left, card.left);
          const dy = Math.min(label.bottom, card.bottom) - Math.max(label.top, card.top);
          if (dx > 4 && dy > 4) labelCardOverlaps.push(`${label.id} ↔ ${card.id}`);
        });
      });

      // Class 6 — controls-and-ownership annotations. React Flow parents are
      // logical, not DOM ancestors, so the renderers expose their authored
      // parent id: legitimate containment is never reported as a collision.
      // LEAF cards only — group containers are excluded on the same principle
      // as the card-overlap class: things legitimately sit inside a group, and
      // a group's opaque HEADER band is the placer's obstacle, not its body.
      const nodeElements = [...document.querySelectorAll(
        '.react-flow__node-diagramNode, .react-flow__node-awsTile, .react-flow__node-pyramidBar, .react-flow__node-csdmCard, .react-flow__node-lifecycleStage, .react-flow__node-lifecycleBand',
      )];
      const annotationOverlaps = [];
      const annotationElements = [...document.querySelectorAll('.dg-control-chips, .dg-owner-chip, .dg-owner-tag, .dg-status-chip')];
      annotationElements
        .forEach((annotation) => {
          const box = annotation.getBoundingClientRect();
          const ownerNode = annotation.closest('.react-flow__node');
          const annotationId = `${ownerNode?.getAttribute('data-id') ?? annotation.closest('[data-edge-id]')?.getAttribute('data-edge-id') ?? 'edge'}:${annotation.classList[0]}:${annotation.textContent?.trim()}`;
          const intersects = (other) => (
            Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
            && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1
          );
          // Exclude ONLY the annotation's own card. Every other LEAF card is
          // fair game — including one in a different group, which is exactly
          // where a chip that overflows its card lands, and which a
          // same-parent-only comparison would miss.
          nodeElements.forEach((element) => {
            if (element === ownerNode) return;
            if (intersects(element.getBoundingClientRect())) {
              annotationOverlaps.push(`${annotationId} ↔ node ${element.getAttribute('data-id')}`);
            }
          });
          labels.forEach((label) => {
            if (intersects(label)) annotationOverlaps.push(`${annotationId} ↔ edge label ${label.id}`);
          });
          // Annotation on annotation: two control-only edge chips landing on
          // one another produce no `.dg-edge-label` at all, so neither the
          // label-overlap class nor the loop above would see them.
          annotationElements.forEach((other) => {
            if (other === annotation || other.contains(annotation) || annotation.contains(other)) return;
            // Compare each unordered pair ONCE, like the card and label
            // checks do, so one collision is one finding.
            if (annotationElements.indexOf(other) < annotationElements.indexOf(annotation)) return;
            const otherOwner = other.closest('.react-flow__node');
            // Two annotations on the SAME node are still a defect — an owner
            // tag over a status chip is exactly the kind of thing a card that
            // grew the wrong way produces — so same-node pairs are NOT
            // skipped. Only two annotations of the same EDGE are, because a
            // label and its own chip row are one composed element.
            if (!otherOwner && !ownerNode && other.closest('[data-edge-id]') === annotation.closest('[data-edge-id]')) return;
            if (intersects(other.getBoundingClientRect())) {
              annotationOverlaps.push(`${annotationId} ↔ annotation ${otherOwner?.getAttribute('data-id') ?? other.closest('[data-edge-id]')?.getAttribute('data-edge-id') ?? '?'}:${other.classList[0]}`);
            }
          });
        });

      const edgeCardCrossings = [];
      document.querySelectorAll('.react-flow__edge path.dg-edge-path.dg-floating-edge')
        .forEach((pathElement) => {
          if (!(pathElement instanceof SVGPathElement)) return;
          const edgeElement = pathElement.closest('.react-flow__edge');
          const edgeId = pathElement.dataset.edgeId
            ?? edgeElement?.getAttribute('data-id')
            ?? 'unknown';
          const sourceId = pathElement.dataset.source;
          const targetId = pathElement.dataset.target;
          const matrix = pathElement.getScreenCTM();
          if (!matrix) return;
          let totalLength;
          try {
            totalLength = pathElement.getTotalLength();
          } catch {
            return;
          }
          cards.forEach((card) => {
            if (card.id === sourceId || card.id === targetId) return;
            let crosses = false;
            const sampleDistances = [];
            for (let distance = 0; distance < totalLength; distance += 8) {
              sampleDistances.push(distance);
            }
            sampleDistances.push(totalLength);
            for (const distance of sampleDistances) {
              const local = pathElement.getPointAtLength(distance);
              const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
              if (screen.x > card.left + 2 && screen.x < card.right - 2
                && screen.y > card.top + 2 && screen.y < card.bottom - 2) {
                crosses = true;
                break;
              }
            }
            if (crosses) edgeCardCrossings.push({ edgeId, cardId: card.id });
          });
        });
      /**
       * Hidden text. Every overlap check above compares WRAPPER rectangles,
       * so a label whose type has outgrown its own box produces no collision
       * and no finding — which is precisely the failure the text-scale work
       * risks, and precisely what those checks cannot see (cross-vendor
       * review, 2026-09-15).
       *
       * Two measurements that look right and are not:
       *   - scrollHeight vs clientHeight. A `-webkit-line-clamp` box
       *     truncates rather than overflows, so a clamped element reports
       *     scrollHeight === clientHeight and looks healthy.
       *   - counting line boxes from a Range. The clamped-away lines produce
       *     no client rects at all, so the count equals the visible count.
       * What does work is measuring a CLONE with the clamp lifted: its
       * natural height is what the text needs, and the original's clientHeight
       * is what the reader gets.
       */
      const measurer = document.createElement('div');
      measurer.setAttribute('aria-hidden', 'true');
      measurer.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;';
      document.body.appendChild(measurer);
      const clipped = [
        '.dg-csdm-card-title', '.dg-csdm-card-subtitle', '.dg-csdm-figure-label',
        '.dg-node-title', '.dg-node-subtitle', '.dg-csdm-region-title',
      ].flatMap((selector) => [...document.querySelectorAll(selector)].flatMap((element) => {
        const style = window.getComputedStyle(element);
        // The AVAILABLE width, not the element's own. These labels are
        // shrink-to-fit flex items, so `clientWidth` equals the text width
        // exactly — constraining a clone to that forces a wrap the live
        // element never has, which reported every single-line title as
        // hidden text.
        // The PARENT's content width is the constraint. Not the element's own
        // (these are shrink-to-fit flex items, so that equals the text width
        // and forces a spurious wrap), and not the max of the two (an element
        // already overflowing reports its overflow as available width, which
        // hides the very truncation being looked for).
        const width = element.parentElement?.clientWidth || element.clientWidth;
        if (width <= 0) return [];
        // A `nowrap` element (the region titles) truncates SIDEWAYS with an
        // ellipsis, so its test is horizontal. Measuring it as a wrapped block
        // reports every two-word title as hidden text, which is a false
        // positive, not a finding.
        if (style.whiteSpace === 'nowrap') {
          const overflowX = element.scrollWidth - element.clientWidth;
          if (overflowX <= 1) return [];
          return [{
            selector,
            text: element.textContent?.trim().slice(0, 48) ?? '',
            needed: Math.round(element.scrollWidth),
            shown: Math.round(element.clientWidth),
            axis: 'across',
          }];
        }
        const clone = element.cloneNode(true);
        clone.style.cssText = '';
        clone.style.font = style.font;
        clone.style.fontSize = style.fontSize;
        clone.style.fontWeight = style.fontWeight;
        clone.style.fontFamily = style.fontFamily;
        clone.style.lineHeight = style.lineHeight;
        clone.style.letterSpacing = style.letterSpacing;
        clone.style.textTransform = style.textTransform;
        clone.style.width = `${width}px`;
        clone.style.display = 'block';
        clone.style.overflow = 'visible';
        clone.style.whiteSpace = style.whiteSpace;
        clone.style.webkitLineClamp = 'unset';
        clone.style.height = 'auto';
        measurer.replaceChildren(clone);
        const needed = clone.getBoundingClientRect().height;
        const shown = element.clientHeight;
        // One line of tolerance: sub-pixel line-height rounding and a
        // trailing half-line are not a swallowed line.
        const lineHeight = parseFloat(style.lineHeight) || 1;
        if (needed - shown <= lineHeight * 0.5) return [];
        return [{
          selector,
          text: element.textContent?.trim().slice(0, 48) ?? '',
          needed: Math.round(needed),
          shown: Math.round(shown),
          axis: 'down',
        }];
      }));
      measurer.remove();

      /**
       * Spill. With the card box frozen as authored geometry, scaled type is
       * MEANT to run past its own border — so this is a DIAGNOSTIC, never a
       * finding: it reports how far each text element extends beyond the
       * component that holds it, and whether that overflow lands on another
       * component or on another component's text. The number exists so the
       * working range of the size stepper can be chosen from evidence rather
       * than guessed. The `clipped` check above is the one that still fails a
       * run: text must spill, and it must never be swallowed.
       *
       * The ink box is the union of the element's own rect and its text's
       * client rects. The element rect alone is not enough: a flex item is
       * width-constrained by its container, so a long word overflows the
       * ELEMENT as well as the card, and only the Range sees that.
       */
      // Every rect below is in SCREEN pixels at whatever zoom fitView chose,
      // so a raw overflow figure would change with the viewport and could not
      // be compared between runs. Dividing by the viewport scale reports
      // LAYOUT pixels — the same unit the card box is authored in.
      const viewportScale = (() => {
        const viewport = document.querySelector('.react-flow__viewport');
        if (!viewport) return 1;
        const scale = new DOMMatrix(window.getComputedStyle(viewport).transform).a;
        return Number.isFinite(scale) && scale > 0 ? scale : 1;
      })();
      const inkBox = (element) => {
        const box = element.getBoundingClientRect();
        let left = box.left; let top = box.top; let right = box.right; let bottom = box.bottom;
        try {
          const range = document.createRange();
          range.selectNodeContents(element);
          for (const rect of range.getClientRects()) {
            if (rect.width <= 0 && rect.height <= 0) continue;
            left = Math.min(left, rect.left); top = Math.min(top, rect.top);
            right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
          }
        } catch { /* a detached or empty element keeps its own rect */ }
        return { left, top, right, bottom };
      };
      const intersects = (a, b, tolerance) => (
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance
      );
      const spillTexts = [
        '.dg-csdm-card-title', '.dg-csdm-card-subtitle', '.dg-csdm-figure-label',
        '.dg-node-title', '.dg-node-subtitle', '.dg-node-eyebrow',
        '.dg-csdm-region-title', '.dg-csdm-hub-title',
      ].flatMap((selector) => [...document.querySelectorAll(selector)].flatMap((element) => {
        const host = element.closest('.react-flow__node');
        if (!host) return [];
        const hostBox = host.getBoundingClientRect();
        if (hostBox.width <= 0 || hostBox.height <= 0) return [];
        const ink = inkBox(element);
        const over = {
          left: Math.round(Math.max(0, hostBox.left - ink.left) / viewportScale),
          right: Math.round(Math.max(0, ink.right - hostBox.right) / viewportScale),
          top: Math.round(Math.max(0, hostBox.top - ink.top) / viewportScale),
          down: Math.round(Math.max(0, ink.bottom - hostBox.bottom) / viewportScale),
        };
        const worst = Math.max(over.left, over.right, over.top, over.down);
        // 1px absorbs sub-pixel rounding at the border; below that nothing spilled.
        if (worst <= 1) return [];
        const hostId = host.getAttribute('data-id') ?? '';
        // Only LEAF components count as things spilled-on: a region or hub is
        // an ancestor container, and its own cards legitimately sit inside it.
        const onComponents = [...document.querySelectorAll(
          '.react-flow__node-diagramNode, .react-flow__node-awsTile,'
          + ' .react-flow__node-pyramidBar, .react-flow__node-csdmCard'
          + ' , .react-flow__node-lifecycleStage, .react-flow__node-lifecycleBand',
        )].filter((other) => other !== host && !other.contains(element)
          && intersects(ink, other.getBoundingClientRect(), 2))
          .map((other) => other.getAttribute('data-id') ?? 'node');
        return [{
          selector,
          hostId,
          text: element.textContent?.trim().slice(0, 40) ?? '',
          over,
          worst,
          onComponents,
          ink,
        }];
      }));
      // Text landing on OTHER text is the spill that actually costs
      // legibility, so it is counted separately from spill onto a card face.
      // Only pairs from DIFFERENT components count: a title sitting above its
      // own subtitle is the layout working, not a collision.
      const allTextBoxes = [
        '.dg-csdm-card-title', '.dg-csdm-card-subtitle', '.dg-csdm-figure-label',
        '.dg-node-title', '.dg-node-subtitle', '.dg-node-eyebrow',
        '.dg-csdm-region-title', '.dg-csdm-hub-title',
      ].flatMap((selector) => [...document.querySelectorAll(selector)].flatMap((element) => {
        const host = element.closest('.react-flow__node');
        if (!host) return [];
        return [{
          hostId: host.getAttribute('data-id') ?? '',
          text: element.textContent?.trim().slice(0, 40) ?? '',
          ink: inkBox(element),
        }];
      }));
      const spillOnText = [];
      spillTexts.forEach((spilled) => {
        allTextBoxes.forEach((other) => {
          if (other.hostId === spilled.hostId) return;
          if (!intersects(spilled.ink, other.ink, 2)) return;
          spillOnText.push(`${spilled.hostId}:"${spilled.text}" ↔ ${other.hostId}:"${other.text}"`);
        });
      });

      return {
        nodeCount: cards.length,
        clipped,
        spillTexts,
        spillOnText,
        cardOverlaps: overlaps(cards, 1),
        labelOverlaps: overlaps(labels, 1),
        labelCardOverlaps,
        edgeCardCrossings,
        annotationOverlaps,
      };
    });

    if (geometry.nodeCount === 0) findings.push(`${id}: no nodes rendered`);
    consoleErrors.forEach((text) => findings.push(`${id}: console error — ${text}`));
    geometry.cardOverlaps.forEach((pair) => findings.push(`${id}: cards overlap — ${pair}`));
    geometry.labelOverlaps.forEach((pair) => findings.push(`${id}: edge labels overlap — ${pair}`));
    geometry.labelCardOverlaps.forEach((pair) => findings.push(`${id}: label-on-card — ${pair}`));
    geometry.annotationOverlaps.forEach((pair) => findings.push(`${id}: annotation overlap — ${pair}`));
    geometry.clipped.forEach((entry) => findings.push(
      `${id}: text hidden in ${entry.selector} — "${entry.text}" needs ${entry.needed}px ${entry.axis}, the box shows ${entry.shown}px`,
    ));
    geometry.edgeCardCrossings.forEach(({ edgeId, cardId }) => {
      findings.push(`${id}: edge ${edgeId} crosses card ${cardId}`);
    });

    console.log(`${id}: ${geometry.nodeCount} nodes · ${geometry.cardOverlaps.length} card overlaps · ${geometry.labelOverlaps.length} label overlaps · ${geometry.labelCardOverlaps.length} labels on cards · ${geometry.edgeCardCrossings.length} edges through cards · ${geometry.annotationOverlaps.length} annotation overlaps · ${geometry.clipped.length} hidden texts · ${consoleErrors.length} console errors`);

    // DIAGNOSTIC, not a gate. Text spilling past a frozen card box is the
    // intended behaviour of the size controls; this reports its extent so the
    // useful range of the stepper is an evidenced choice. Nothing here can
    // fail a run.
    const spill = geometry.spillTexts;
    const worstSpill = spill.reduce((max, entry) => Math.max(max, entry.worst), 0);
    const onCards = spill.filter((entry) => entry.onComponents.length > 0);
    console.log(`    spill @ ${textScale.toFixed(2)}x: ${spill.length} text element(s) past their component, worst ${worstSpill}px (layout px) · ${onCards.length} onto another component · ${geometry.spillOnText.length} onto other text`);
    if (verboseSpill) {
      spill.sort((a, b) => b.worst - a.worst).slice(0, 12).forEach((entry) => {
        const dirs = Object.entries(entry.over)
          .filter(([, value]) => value > 1)
          .map(([key, value]) => `${key} ${value}px`).join(', ');
        const onto = entry.onComponents.length ? ` → over ${entry.onComponents.join(', ')}` : '';
        console.log(`      ${entry.hostId} ${entry.selector} "${entry.text}" — ${dirs}${onto}`);
      });
      geometry.spillOnText.slice(0, 12).forEach((pair) => console.log(`      text-on-text: ${pair}`));
    }
    await context.close();
  }
} finally {
  try { await browser?.close(); } catch { /* already gone */ }
  previewProcess?.kill();
}

if (findings.length > 0) {
  console.error(`\n${findings.length} finding(s):`);
  findings.forEach((finding) => console.error(`  - ${finding}`));
  process.exit(1);
}
console.log('\nlayout probe clean');
