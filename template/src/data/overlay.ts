import type { DiagramDef } from '../model';

/**
 * Diagram 4 — CONTROLS AND OWNERSHIP, AWS reference-architecture style.
 *
 * The overlay exemplar: a delivered agent running inside a customer-managed
 * workstation estate, drawn at the altitude of the platform team who would
 * build it. It exists to answer the question a security architect actually
 * asks — who administers this on our estate, which parts are ours, which are
 * the supplier's, and what is still open — so it exercises every field the
 * overlay adds: group owners, a to-confirm group and tile, owner corner tags,
 * a three-tag control row (which wraps to two lines), controls on an edge,
 * one emphasised arrow, and an in-canvas legend that resolves every tag.
 *
 * It is also deliberately DENSE around the agent group: three numbered
 * circles share one corridor bounded above by a notes-bearing card and below
 * by a group header band. That is the geometry the placer used to lose on, so
 * the exemplar keeps it under the probe permanently.
 *
 * The other three views set NONE of these fields and must render unchanged —
 * `npm run cmp:baseline` is what proves it.
 */
export const overlayDiagram: DiagramDef = {
  id: 'overlay',
  dialect: 'aws',
  title: 'Controls & ownership',
  // Party names live in the DATA, never in a component. Change these two
  // entries per engagement; `product` is required because a control can be
  // enforced by the delivered product rather than by either party's team.
  parties: {
    customer: { short: 'CUST', long: 'the customer platform team' },
    supplier: { short: 'SUPP', long: 'the supplier delivery team' },
    product: { short: 'PROD', long: 'the delivered product' },
  },
  groups: [
    {
      id: 'ov-estate',
      title: 'MANAGED WORKSTATION ESTATE',
      kind: 'aws',
      color: 'soft',
      col: 1,
      row: 0,
      owner: {
        party: 'customer',
        label: 'CUSTOMER OWNS',
        team: 'Desktop engineering administers the image, the policy store and the egress proxy.',
      },
    },
    {
      id: 'ov-agent',
      title: 'DELIVERED AGENT',
      kind: 'aws',
      color: 'lime',
      parent: 'ov-estate',
      col: 0,
      row: 1,
      owner: {
        party: 'supplier',
        label: 'SUPPLIER DELIVERS',
        team: 'Delivery engineering ships the runtime and the guard hooks; it administers neither the image nor the proxy.',
      },
    },
    {
      id: 'ov-platform',
      title: 'MODEL PLATFORM',
      kind: 'aws',
      color: 'soft',
      col: 2,
      row: 0,
      // The whole group is open because which account hosts the endpoint has
      // not been settled — a class that is confirmed but whose instance is
      // not is still to-confirm.
      status: 'to-confirm',
    },
  ],
  nodes: [
    {
      id: 'o-operator',
      title: 'Platform engineer',
      glyph: 'E',
      col: 0,
      row: 0,
      emphasis: 'primary',
      steps: [1, 6],
      detail: 'Builds the image, applies the policy, and owns every question this view leaves open.',
    },
    {
      id: 'o-image',
      title: 'Managed image',
      glyph: 'I',
      group: 'ov-estate',
      owner: 'customer',
      controls: ['MANAGED POLICY'],
      col: 0,
      row: 0,
      steps: [1, 2],
      detail: 'The corporate build. The agent is installed into it; nothing else about the image changes.',
    },
    {
      id: 'o-policy',
      title: 'Policy store',
      glyph: 'P',
      group: 'ov-estate',
      owner: 'customer',
      // Three tags: the row wraps to two lines, and the card grows to fit —
      // one height constant, shared by the renderer and the layout.
      // Placeholder paths: the citations exist here to prove the detail panel
      // renders CONTROLS and a collapsed "+ sources" toggle together. Replace
      // them with your own source references, or delete them.
      citations: ['<your-source-document>.md:14', '<your-source-document>.md:31'],
      controls: ['NO BYPASS', 'ALLOWLIST ONLY', 'AUDITED'],
      col: 1,
      row: 0,
      steps: [2],
      detail: 'Machine-scope settings the signed-in user cannot override. Read at every agent start.',
    },
    {
      id: 'o-proxy',
      title: 'Egress proxy',
      glyph: 'X',
      group: 'ov-estate',
      owner: 'customer',
      // Row 1, beside the agent group: at row 0 the guard-to-proxy edge ran up
      // through the policy store's title. An aws edge crossing a card is the
      // one defect class the probe does not measure — it checks floating
      // edges only — so the composition has to keep the corridor clear.
      col: 1,
      row: 1,
      steps: [4, 5],
      detail: 'The only route off the workstation. Everything the agent reaches is named in the allowlist.',
    },
    {
      id: 'o-runtime',
      title: 'Agent runtime',
      glyph: 'A',
      group: 'ov-agent',
      owner: 'supplier',
      col: 0,
      row: 0,
      steps: [2, 3],
      detail: 'Reads the policy at start-up and refuses to run when a required setting is absent.',
    },
    {
      id: 'o-guard',
      title: 'Guard hooks',
      glyph: 'G',
      group: 'ov-agent',
      owner: 'supplier',
      controls: ['GUARDED TOOLS'],
      col: 1,
      row: 0,
      steps: [3, 4],
      detail: 'Every tool call passes a hook chain that fails closed: a hook that cannot run denies the call.',
    },
    {
      id: 'o-endpoint',
      title: 'Model endpoint',
      glyph: 'M',
      group: 'ov-platform',
      owner: 'customer',
      citations: ['<your-source-document>.md:9'],
      status: 'to-confirm',
      col: 0,
      row: 0,
      steps: [5],
      detail: 'Which account hosts the endpoint, and in which region, is open.',
    },
    {
      id: 'o-secrets',
      title: 'Secret store',
      glyph: 'S',
      group: 'ov-platform',
      owner: 'customer',
      controls: ['AUDITED'],
      col: 0,
      row: 1,
      steps: [6],
      detail: 'Holds the endpoint credential. The agent reads it; no credential is written into the image.',
    },
  ],
  edges: [
    { id: 'e-build', from: 'o-operator', to: 'o-image', kind: 'flow', label: 'BUILDS', stepNo: 1 },
    { id: 'e-policy', from: 'o-image', to: 'o-runtime', kind: 'flow', label: 'APPLIES POLICY', stepNo: 2 },
    { id: 'e-hooks', from: 'o-runtime', to: 'o-guard', kind: 'flow', label: 'EVERY TOOL CALL', stepNo: 3 },
    {
      id: 'e-egress',
      from: 'o-guard',
      to: 'o-proxy',
      kind: 'flow',
      label: 'ONLY ROUTE OUT',
      stepNo: 4,
      // The one emphasised arrow: the containment claim the whole view makes.
      emphasis: 'bold',
      controls: ['EGRESS PINNED'],
    },
    { id: 'e-model', from: 'o-proxy', to: 'o-endpoint', kind: 'flow', label: 'ALLOWLISTED HOST', stepNo: 5 },
    { id: 'e-secret', from: 'o-operator', to: 'o-secrets', kind: 'ref', label: 'ROTATES', stepNo: 6 },
  ],
  steps: [
    {
      n: 1,
      text: 'The **platform engineer** builds the agent into the **managed image**; nothing else about the corporate build changes.',
      nodes: ['o-operator', 'o-image'],
      edges: ['e-build'],
    },
    {
      n: 2,
      text: 'The image applies machine-scope settings from the **policy store**, and the **agent runtime** reads them at every start.',
      nodes: ['o-image', 'o-policy', 'o-runtime'],
      edges: ['e-policy'],
    },
    {
      n: 3,
      text: 'Every tool call the runtime makes passes the **guard hooks**, which fail closed.',
      nodes: ['o-runtime', 'o-guard'],
      edges: ['e-hooks'],
    },
    {
      n: 4,
      text: 'The only route off the workstation is the **egress proxy**, and the allowlist names every host the agent may reach.',
      nodes: ['o-guard', 'o-proxy'],
      edges: ['e-egress'],
    },
    {
      n: 5,
      text: 'The proxy reaches the **model endpoint** — whose account and region are still to confirm.',
      nodes: ['o-proxy', 'o-endpoint'],
      edges: ['e-model'],
    },
    {
      n: 6,
      text: 'The engineer rotates the endpoint credential in the **secret store**; no credential is written into the image.',
      nodes: ['o-operator', 'o-secrets'],
      edges: ['e-secret'],
    },
  ],
  // The legend's groups mirror the layers of the document this view is drawn
  // from, and a jointly administered control sits under the layer whose
  // section defines it. Views without a legend of their own resolve their
  // tags against this one.
  legend: {
    title: 'What each control means, and who administers it',
    groups: [
      {
        heading: 'ADMINISTERED ON THE CUSTOMER PLATFORM',
        items: [
          {
            tag: 'NO BYPASS',
            meaning: 'The setting is applied at machine scope, so the signed-in user cannot turn it off.',
            analogy: 'The same idea as a locked Group Policy setting: present, enforced, and not editable by the person at the keyboard.',
            administeredBy: ['customer'],
          },
          {
            tag: 'ALLOWLIST ONLY',
            meaning: 'Only the hosts named in the proxy configuration can be reached; everything else is refused.',
            administeredBy: ['customer'],
          },
          {
            tag: 'AUDITED',
            meaning: 'Every read and every change is recorded, with the record held by the customer.',
            administeredBy: ['customer'],
          },
          {
            tag: 'EGRESS PINNED',
            meaning: 'The route off the workstation cannot be changed from inside the agent.',
            administeredBy: ['customer'],
          },
        ],
      },
      {
        heading: 'ADMINISTERED BY THE DELIVERED PRODUCT',
        items: [
          {
            tag: 'MANAGED POLICY',
            meaning: 'The product reads its settings from the customer-managed store, and refuses to start when a required setting is absent.',
            administeredBy: ['customer', 'product'],
          },
          {
            tag: 'GUARDED TOOLS',
            meaning: 'Each tool call passes a hook chain that denies the call when a hook cannot run.',
            administeredBy: ['product'],
          },
        ],
      },
    ],
  },
};
