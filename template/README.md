# Architecture diagrams

Standalone Vite/React template for interactive architecture diagrams.

```bash
npm install
npm run dev            # authoring
npm run build          # tsc --noEmit && vite build
npm run build:offline  # dist-offline/index.html — the single-file/embed artefact
npm run gate           # the whole sequence, one command (see Gates below)
```

## Publish to the Engagement Board

`canvas.json` opts an app into publishing: copy `canvas.json.example` to `canvas.json` and edit it; `board` must be allow-listed, `caps.views` is measured during publishing while every other capability is authored in the file, and an app without `canvas.json` publishes nowhere.

Always use `npm run build:offline`: it injects `<meta name="dg-canvas">` and runs the publish step automatically, while raw `vite build --config vite.config.offline.ts` only builds and skips publishing.

The publisher resolves Playwright from `PLAYWRIGHT_PKG` first, then the app's local `playwright` package, then the global npm root returned by `npm root -g`; if none is available, set `PLAYWRIGHT_PKG=<path-to-playwright-package>` or run `npm i -g playwright`.

1. The publisher reads `canvas.json`; `no canvas.json — nothing published` means the app deliberately opted out.
2. It expands `~`, enforces the board allow-list, and requires the existing `visuals` directory; `refused: board ... is not on the allow-list` means the target is forbidden, while a visuals-directory error means the configured board checkout is missing or invalid.
3. It requires the offline bundle and its metadata, then opens it in Chromium and checks the `window.__dg` bridge; `bundle has no dg-canvas meta` means raw Vite was used, while `bundle exposes no usable window.__dg bridge` means `src/App.tsx` needs the template bridge retrofit.
4. It measures the diagram count into `caps.views` and atomically renames the rewritten bundle into the board; a write or rename error means the board visual was not replaced successfully.
5. It regenerates the visual registry and runs its tests; on failure the captured assertion identifies the metadata rule to fix, such as the `CONFIDENTIAL-` filename prefix controlled by `file` and `confidential`.
6. It loads the live `/canvas?v=<id>` page and compares rendered diagram rows with the bundle; `board not reachable at 127.0.0.1:4478` means the launchd agent is unavailable, while a non-200, zero-row, or row-count mismatch means the registry, iframe, or bridge is not serving the published visual correctly.

A visual is not done until `/canvas?v=<id>` returns 200 and lists its diagrams — `dist-offline/index.html` is an intermediate, not the deliverable.

Embed one diagram (per-section document embeds, chrome-free exports): `<baseUrl>?embed=<diagramId>` — no diagram rail, topbar, side rail, or diagram switching.

Standard mode uses the numbered, collapsible left `.dg-diagram-rail`; optional `DiagramDef.section` values add headings for consecutive groups. Press `L` to toggle it. The choice persists in `localStorage['dg-diagram-rail']`.

Same-origin embedding hosts can read `window.__dg`:

```ts
{
  diagrams: Array<{ id: string; title: string; section?: string }>;
  activeId: string;
  switchTo(id: string): void;
}
```

After each post-mount switch, the document dispatches `dg:diagram-change` with `{ id, title, index }` detail. In embed mode the contract remains populated, but `switchTo` is a no-op.

## Gates

`npm run gate` runs the whole sequence and stops at the first failure: build → `build:offline` → `lint:text` → probe light → probe dark → export → deliver → `cmp:baseline`. Run it rather than the steps by hand; a documented hand sequence gets skipped.

The individual steps, if you need one on its own (the probe and the exporter serve their own build with `--serve`, or take a base URL from an already-served one such as `npx vite preview --port 4519`):

```bash
npm run lint:text                                             # canvas text, legend coverage, to-confirm coverage
node scripts/probe-layout.mjs --serve --theme light           # six geometric defect classes
node scripts/probe-layout.mjs --serve --theme dark            # run both themes — one is not evidence for the other
node scripts/export-statics.mjs --serve ./out                 # 2x PNGs, cropped to the diagram
DELIVER_TO=../deliverable.html npm run deliver                # copy the single file; unset = skip, exit 0
npm run cmp:baseline                                          # baseline exports unchanged
```

`lint:text` reads `canvas-text.rules.json` (copy `canvas-text.rules.example.json`). It checks banned canvas text over `src/data/*.ts` and, with the `bundleSafe` subset only, over `dist-offline/index.html`; section marks outside a `citations` array; every `controls` tag resolving to a legend item, using the one view that declares a `legend` as the fallback vocabulary for views without one; and, when `values` is configured, that each open value in a source YAML file still has its tiles marked `status: 'to-confirm'`. Without the config file only the legend-coverage check runs: the banned-text check needs `banned` and the to-confirm check needs a `values` block. The PASS line names exactly which checks ran and lists any that did not, so a green run never implies coverage it does not have.

`cmp:baseline` compares the exports named in `scripts/baseline.json` against `./exports` by sha256 and pixel dimensions. A dimension change means the layout moved. The shipped file describes the TEMPLATE's own exemplar exports, so after you swap in your data run `node scripts/cmp-baseline.mjs --write` once, when the rest of the gate is green, to make it your set's regression guard. `--dims-only` relaxes the hash check on a machine whose font rendering differs.

Generated diagram definitions live in `src/data/diagram-set.ts`; the MCP server writes `arc-diagram.project.json`, which is the shared diagram-id manifest used by probes and exporters. In `npm run dev`, any annotation that renders outside every placer obstacle logs a console warning — chrome the placer cannot see is chrome it will site a label on top of. Brand and theme tokens live in `src/diagrams.css` and `src/theme.ts`. See the [arc-diagram authoring contract](https://github.com/ArchiJones-AI/arc-diagram-mcp/blob/main/docs/contract.md) for the data rules. For scaffolded copies in Dropbox, run `xattr -w com.dropbox.ignored 1 node_modules` after install.
