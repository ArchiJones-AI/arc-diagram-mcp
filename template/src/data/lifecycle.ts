import type { DiagramDef } from '../model';

/**
 * Minimal `lifecycle` exemplar: a left-to-right chevron pipeline inside a
 * titled frame, over a substrate band, with feedback arrows sharing one rail.
 * Keep it until a real set replaces it — it is what render-proves the dialect.
 */
export const lifecycleDiagram: DiagramDef = {
  id: 'lifecycle',
  dialect: 'lifecycle',
  title: 'Delivery life cycle',
  section: 'Life cycle',
  tab: 'MANAGE PORTFOLIO',
  frameTitle: 'DELIVERY LIFE CYCLE',
  groups: [],
  nodes: [
    { id: 'lc-1', title: 'IDEA', col: 0, row: 0, accent: '#eddc5a', accentInk: 'dark', detail: 'Where a concept is captured and assessed.' },
    { id: 'lc-2', title: 'DESIGN', col: 1, row: 0, accent: '#68a1af', accentInk: 'light', detail: 'Where the detail is worked up for development.' },
    { id: 'lc-3', title: 'BUILD', col: 2, row: 0, accent: '#fb545e', accentInk: 'light', detail: 'Where the design becomes a deployable solution.' },
    { id: 'lc-4', title: 'DELIVER', col: 3, row: 0, accent: '#f19714', accentInk: 'light', detail: 'Where the solution is released for others to use.' },
    { id: 'lc-5', title: 'CONSUME', col: 4, row: 0, accent: '#54c45e', accentInk: 'light', detail: 'Where the service is used and its value measured.' },
    { id: 'lc-base', title: 'Foundation', lifecycleRole: 'substrate', col: 0, row: 1, detail: 'The layer every stage above depends on.' },
  ],
  edges: [
    { id: 'lc-fb-1', from: 'lc-3', to: 'lc-1', kind: 'loop' },
    { id: 'lc-fb-2', from: 'lc-4', to: 'lc-2', kind: 'loop' },
    { id: 'lc-fb-3', from: 'lc-5', to: 'lc-3', kind: 'loop' },
  ],
};
