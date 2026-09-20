import type { DiagramDialect } from './types.js';

export interface DialectDescription {
  id: DiagramDialect;
  useWhen: string;
  semantics: string;
  constraints: string[];
}

export const DIALECT_DESCRIPTIONS: DialectDescription[] = [
  {
    id: 'editorial',
    useWhen: 'Showing a system in its world or the component structure inside it.',
    semantics: 'Pastel islands and monochrome frames encode logical boundaries; labelled arrows encode relationships.',
    constraints: ['Use groups for meaningful boundaries.', 'Keep visible text audience-facing; put evidence in citations.'],
  },
  {
    id: 'aws',
    useWhen: 'Explaining an ordered runtime or deployment flow.',
    semantics: 'Square containment, glyph tiles, numbered edge callouts and a narrative step rail.',
    constraints: ['Provide steps for numbered flows.', 'Every step reference must resolve to a node or edge in the view.'],
  },
  {
    id: 'pyramid',
    useWhen: 'The source argues through hierarchy, widening tiers or increasing breadth.',
    semantics: 'Each node is one tier; row is the level from the top and width grows downward.',
    constraints: ['Do not provide groups or edges.', 'Use title and subtitle for the tier claim and supporting facts.'],
  },
  {
    id: 'lifecycle',
    useWhen: 'The source is a left-to-right lifecycle with optional feedback loops and substrate bands.',
    semantics: 'Stage nodes form the pipeline; lifecycleRole=substrate creates foundation bands.',
    constraints: ['Stage columns establish sequence.', 'Use loop edges only for explicit feedback paths.'],
  },
  {
    id: 'csdm',
    useWhen: 'The source is a domain quilt or reference model where position encodes domain rather than sequence.',
    semantics: 'Domain regions, entity cards, role figures and solid/dashed relationships reproduce the reference-model grammar.',
    constraints: ['Set domain on root regions.', 'Use figures for roles; figures do not take edges.'],
  },
];
