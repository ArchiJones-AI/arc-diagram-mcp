import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export const ARC_DIAGRAM_TEMPLATE_VERSION = '1.10';

function validateCanvasMeta(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('canvas.json: expected a JSON object');
  }

  const meta = value as Record<string, unknown>;
  const branch = meta.branch;
  const caps = meta.caps;

  if (typeof meta.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(meta.id)) {
    throw new Error('canvas.json: id must match /^[a-z0-9][a-z0-9-]*$/');
  }
  if (typeof meta.file !== 'string' || !meta.file.endsWith('.html')) {
    throw new Error('canvas.json: file must be a string ending in .html');
  }
  if (!branch || typeof branch !== 'object' || Array.isArray(branch)) {
    throw new Error('canvas.json: branch must be an object');
  }
  const branchRecord = branch as Record<string, unknown>;
  if (typeof branchRecord.id !== 'string' || branchRecord.id.length === 0) {
    throw new Error('canvas.json: branch.id must be a non-empty string');
  }
  if (typeof branchRecord.label !== 'string' || branchRecord.label.length === 0) {
    throw new Error('canvas.json: branch.label must be a non-empty string');
  }
  if (meta.family !== 'dg') {
    throw new Error("canvas.json: family must be 'dg'");
  }
  if (!['internal', 'tier2', 'strict'].includes(String(meta.confidential))) {
    throw new Error('canvas.json: confidential must be internal, tier2, or strict');
  }
  if (!caps || typeof caps !== 'object' || Array.isArray(caps)) {
    throw new Error('canvas.json: caps must be an object');
  }
  if (meta.confidential === 'strict' && !meta.file.startsWith('CONFIDENTIAL-')) {
    throw new Error("canvas.json: strict files must start with 'CONFIDENTIAL-'");
  }
}

function canvasMeta(): Plugin {
  let meta: Record<string, unknown> | undefined;

  return {
    name: 'arc-diagram-canvas-meta',
    async configResolved(config) {
      const canvasPath = path.join(config.root, 'canvas.json');
      let source: string;

      try {
        source = await readFile(canvasPath, 'utf8');
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return;
        throw error;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(source);
      } catch (error) {
        throw new Error(`canvas.json: invalid JSON: ${(error as Error).message}`);
      }

      validateCanvasMeta(parsed);
      const { board: _board, ...canvas } = parsed;
      meta = {
        ...canvas,
        built: new Date().toISOString(),
        template: ARC_DIAGRAM_TEMPLATE_VERSION,
      };
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!meta) return html;
        return {
          html,
          tags: [{
            tag: 'meta',
            attrs: { name: 'dg-canvas', content: JSON.stringify(meta) },
            injectTo: 'head-prepend',
          }],
        };
      },
    },
  };
}

/**
 * Offline single-file build: everything (JS, CSS, fonts) inlined into one
 * index.html (~1MB) that renders over file:// with no server. This artefact is
 * BOTH the shareable offline copy and the file you host when a document needs
 * per-section embeds (`<file>.html?embed=<diagramId>` per iframe).
 *
 * The in-app "Offline HTML" download does NOT read this file: it clones the
 * live document, which is already single-file when served from this build.
 * When canvas.json is present, this build prepends a dg-canvas meta tag carrying
 * registry metadata. Always run `npm run build:offline`: its post-hook publishes
 * the bundle; raw `vite build --config vite.config.offline.ts` does not publish.
 */
export default defineConfig({
  plugins: [react(), canvasMeta(), viteSingleFile()],
  build: {
    outDir: 'dist-offline',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
  },
});
