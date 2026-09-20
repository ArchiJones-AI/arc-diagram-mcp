# Arc-diagram authoring contract

The MCP server writes a complete diagram application from one project object:

```json
{
  "title": "Human-readable application title",
  "eyebrow": "OPTIONAL SHORT LABEL",
  "diagrams": []
}
```

Every diagram has an `id`, `title`, `dialect`, and the three collections `groups`, `nodes`, and `edges`. IDs use lowercase kebab-case. Layout is semantic: `row` and `col` express relative placement; the renderer owns final pixel geometry.

## Dialect selection

- `editorial`: context and application/component boards.
- `aws`: ordered runtime and deployment flows with numbered steps.
- `pyramid`: widening hierarchy tiers; groups and edges are deliberately unsupported.
- `lifecycle`: left-to-right stages, feedback loops, and substrate bands.
- `csdm`: reference-model quilts where position encodes domain.

Select a dialect from the source structure or visual metaphor. A view called “pyramid” that actually contains a relationship network remains editorial; a source whose argument is genuinely tiered should be pyramid even if its title says nothing about pyramids.

## Evidence and uncertainty

Canvas copy is for readers. Put repository paths, document references, and other evidence in `citations`. Use `status: "to-confirm"` wherever a component depends on an unresolved identity, mechanism, host, count, or instance, and keep that status consistent across views.

Controls are tags on nodes or edges. Every tag must resolve to a legend item in that diagram or in the set's single shared legend.

## Verification

Creation validates structural integrity. The generated project then supplies the visual gates:

```bash
npm install
npm run build
npm run build:offline
npm run lint:text
npm run probe -- --theme light
npm run probe -- --theme dark
npm run export
npm run baseline
npm run gate
```

The first baseline is deliberate: take it only after the diagrams pass the probes and the exported PNGs have had a human read.
