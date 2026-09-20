export const DIALECTS = ['editorial', 'aws', 'pyramid', 'lifecycle', 'csdm'] as const;
export type DiagramDialect = (typeof DIALECTS)[number];

export type JsonObject = Record<string, unknown>;

export interface DiagramGroup extends JsonObject {
  id: string;
  title: string;
  kind: 'block' | 'frame' | 'aws';
  color: 'lime' | 'lilac' | 'cream' | 'mint' | 'pink' | 'coral' | 'navy' | 'soft';
  col: number;
  row: number;
  parent?: string;
  status?: 'confirmed' | 'to-confirm';
}

export interface DiagramNode extends JsonObject {
  id: string;
  title: string;
  col: number;
  row: number;
  group?: string;
  status?: 'confirmed' | 'to-confirm';
  controls?: string[];
}

export interface DiagramEdge extends JsonObject {
  id: string;
  from: string;
  to: string;
  kind: 'flow' | 'loop' | 'ref';
  controls?: string[];
}

export interface FlowStep extends JsonObject {
  n: number;
  text: string;
  nodes: string[];
  edges: string[];
}

export interface DiagramDefinition extends JsonObject {
  id: string;
  dialect: DiagramDialect;
  title: string;
  section?: string;
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  steps?: FlowStep[];
  legend?: JsonObject;
}

export interface ArcProjectSpec {
  title: string;
  eyebrow?: string;
  diagrams: DiagramDefinition[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CreateProjectOptions {
  outputDirectory: string;
  overwrite?: boolean;
}

export interface CreatedProject {
  outputDirectory: string;
  diagramIds: string[];
  filesWritten: string[];
  nextSteps: string[];
}
