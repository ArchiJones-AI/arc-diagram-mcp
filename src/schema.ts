const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' } as const;

export const GROUP_SCHEMA = {
  type: 'object',
  required: ['id', 'title', 'kind', 'color', 'col', 'row'],
  properties: {
    id,
    title: { type: 'string', minLength: 1 },
    kind: { type: 'string', enum: ['block', 'frame', 'aws'] },
    color: { type: 'string', enum: ['lime', 'lilac', 'cream', 'mint', 'pink', 'coral', 'navy', 'soft'] },
    col: { type: 'integer', minimum: 0 },
    row: { type: 'integer', minimum: 0 },
    parent: id,
    chip: { type: 'string' },
    lane: { type: 'boolean' },
    status: { type: 'string', enum: ['confirmed', 'to-confirm'] },
    owner: { type: 'object', additionalProperties: true },
    domain: { type: 'string', enum: ['build', 'design', 'ideation', 'portfolio', 'delivery', 'consumption', 'foundation'] },
    chips: { type: 'array', items: { type: 'string' } },
    icon: { type: 'string' },
  },
  additionalProperties: true,
} as const;

export const NODE_SCHEMA = {
  type: 'object',
  required: ['id', 'title', 'col', 'row'],
  properties: {
    id,
    title: { type: 'string', minLength: 1 },
    subtitle: { type: 'string' },
    eyebrow: { type: 'string' },
    group: id,
    col: { type: 'integer', minimum: 0 },
    row: { type: 'integer', minimum: 0 },
    detail: { type: 'string' },
    citations: { type: 'array', items: { type: 'string' } },
    glyph: { type: 'string' },
    steps: { type: 'array', items: { type: 'integer', minimum: 1 } },
    owner: { type: 'string', enum: ['customer', 'supplier'] },
    status: { type: 'string', enum: ['confirmed', 'to-confirm'] },
    controls: { type: 'array', maxItems: 3, items: { type: 'string' } },
    stack: { type: 'boolean' },
    shape: { type: 'string', enum: ['card', 'cloud', 'chevron'] },
    figure: { type: 'string', enum: ['role'] },
    gutter: { type: 'string', enum: ['left', 'right', 'below'] },
    lifecycleRole: { type: 'string', enum: ['stage', 'substrate'] },
    accent: { type: 'string' },
    accentInk: { type: 'string', enum: ['light', 'dark'] },
  },
  additionalProperties: true,
} as const;

export const EDGE_SCHEMA = {
  type: 'object',
  required: ['id', 'from', 'to', 'kind'],
  properties: {
    id,
    from: id,
    to: id,
    label: { type: 'string' },
    kind: { type: 'string', enum: ['flow', 'loop', 'ref'] },
    stepNo: { type: 'integer', minimum: 1 },
    emphasis: { type: 'string', enum: ['bold'] },
    controls: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: true,
} as const;

export const DIAGRAM_SCHEMA = {
  type: 'object',
  required: ['id', 'dialect', 'title', 'groups', 'nodes', 'edges'],
  properties: {
    id,
    dialect: { type: 'string', enum: ['editorial', 'aws', 'pyramid', 'lifecycle', 'csdm'] },
    title: { type: 'string', minLength: 1 },
    section: { type: 'string' },
    subtitle: { type: 'string' },
    axisLabel: { type: 'string' },
    tab: { type: 'string' },
    frameTitle: { type: 'string' },
    rootColGap: { type: 'number' },
    groups: { type: 'array', items: GROUP_SCHEMA },
    nodes: { type: 'array', minItems: 1, items: NODE_SCHEMA },
    edges: { type: 'array', items: EDGE_SCHEMA },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['n', 'text', 'nodes', 'edges'],
        properties: {
          n: { type: 'integer', minimum: 1 },
          text: { type: 'string', minLength: 1 },
          nodes: { type: 'array', items: id },
          edges: { type: 'array', items: id },
        },
        additionalProperties: true,
      },
    },
    legend: { type: 'object', additionalProperties: true },
    parties: { type: 'object', additionalProperties: true },
  },
  additionalProperties: true,
} as const;

export const PROJECT_PROPERTIES = {
  title: { type: 'string', minLength: 1, description: 'Human-readable name for the generated diagram application.' },
  eyebrow: { type: 'string', description: 'Short uppercase label shown above the application title.' },
  diagrams: {
    type: 'array',
    minItems: 1,
    description: 'Complete DiagramDef objects. Preserve source meaning in the chosen dialect and put evidence in citations.',
    items: DIAGRAM_SCHEMA,
  },
} as const;
