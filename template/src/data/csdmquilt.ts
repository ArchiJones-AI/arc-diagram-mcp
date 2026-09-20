import type { DiagramDef } from '../model';

/**
 * csdm dialect exemplar — a three-domain quilt, small enough to read at a
 * glance and wide enough to exercise every part of the dialect: a domain
 * region with a workflow-chip row, a sub-box, a stack card, a cloud card,
 * role figures in the left, right and below gutters, the Manage Portfolio
 * hub, and one solid and one dashed relationship.
 *
 * Replace it with the real CSDM domains when you author a quilt for a client.
 */
export const csdmQuiltDiagram: DiagramDef = {
  id: 'csdmquilt',
  dialect: 'csdm',
  title: 'Domain quilt (csdm dialect exemplar)',
  groups: [
    { id: 'q-design', domain: 'design', icon: 'bulb', title: 'Design & Planning', kind: 'block', color: 'navy', col: 1, row: 0 },
    { id: 'q-portfolio', domain: 'portfolio', icon: 'briefcase', title: 'Manage Portfolio', kind: 'block', color: 'soft', col: 0, row: 0 },
    {
      id: 'q-delivery', domain: 'delivery', icon: 'spanner', title: 'Service Delivery', kind: 'block', color: 'coral', col: 0, row: 1,
      chips: ['Technology Workflows', 'Employee Workflows'],
    },
    { id: 'q-sub', parent: 'q-delivery', title: 'Subsystems', kind: 'frame', color: 'soft', col: 0, row: 1 },
    { id: 'q-foundation', domain: 'foundation', icon: 'building', title: 'Foundation', kind: 'block', color: 'soft', col: 0, row: 2 },
  ],
  nodes: [
    { id: 'q-capability', group: 'q-design', col: 0, row: 0, title: 'Business Capability', detail: 'What the organisation is able to do, named in business terms.' },
    { id: 'q-application', group: 'q-design', col: 1, row: 0, title: 'Business Application', detail: 'A named piece of software the business recognises and funds.' },
    { id: 'q-architect', group: 'q-design', figure: 'role', gutter: 'right', col: 0, row: 0, title: 'Enterprise Architect' },
    { id: 'q-offering', group: 'q-delivery', col: 0, row: 0, title: 'Management Offering', detail: 'What is promised, at what level, to whom.' },
    { id: 'q-instance', group: 'q-delivery', col: 1, row: 0, title: 'Service Instance', stack: true, detail: 'One running realisation of an offering.' },
    { id: 'q-platform', group: 'q-sub', col: 0, row: 0, title: 'Delivery System', shape: 'cloud', detail: 'The platform a service runs on.' },
    { id: 'q-owner', group: 'q-delivery', figure: 'role', gutter: 'left', col: 0, row: 0, title: 'Service Delivery Owner' },
    { id: 'q-stream', group: 'q-foundation', col: 0, row: 0, title: 'Value Stream', shape: 'chevron' },
    { id: 'q-locations', group: 'q-foundation', col: 1, row: 0, title: 'Locations', stack: true },
    { id: 'q-users', group: 'q-foundation', col: 2, row: 0, title: 'Users' },
    { id: 'q-steward', group: 'q-foundation', figure: 'role', gutter: 'below', col: 1, row: 0, title: 'Data Steward' },
  ],
  edges: [
    { id: 'q-e1', from: 'q-capability', to: 'q-application', kind: 'flow', label: 'provided by' },
    { id: 'q-e2', from: 'q-application', to: 'q-instance', kind: 'flow', label: 'depends on' },
    { id: 'q-e3', from: 'q-offering', to: 'q-instance', kind: 'flow', label: 'contains' },
    { id: 'q-e4', from: 'q-instance', to: 'q-platform', kind: 'ref' },
  ],
};
