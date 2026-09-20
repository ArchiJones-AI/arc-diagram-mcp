import { DIALECTS, type ArcProjectSpec, type DiagramDefinition, type JsonObject, type ValidationResult } from './types.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const GROUP_KINDS = new Set(['block', 'frame', 'aws']);
const GROUP_COLORS = new Set(['lime', 'lilac', 'cream', 'mint', 'pink', 'coral', 'navy', 'soft']);
const EDGE_KINDS = new Set(['flow', 'loop', 'ref']);

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function integer(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function duplicateIds(items: unknown[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates];
}

function validateId(value: unknown, path: string, errors: string[]): value is string {
  if (!nonEmptyString(value)) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  if (!ID_PATTERN.test(value)) {
    errors.push(`${path} must match ${ID_PATTERN}`);
    return false;
  }
  return true;
}

function legendTags(diagram: JsonObject): Set<string> {
  const tags = new Set<string>();
  const legend = diagram.legend;
  if (!isRecord(legend) || !Array.isArray(legend.groups)) return tags;
  for (const group of legend.groups) {
    if (!isRecord(group) || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (isRecord(item) && nonEmptyString(item.tag)) tags.add(item.tag);
    }
  }
  return tags;
}

function validateDiagram(diagram: unknown, index: number, errors: string[], warnings: string[], fallbackVocabulary: Set<string> | undefined, ambiguousFallback: boolean): void {
  const base = `diagrams[${index}]`;
  if (!isRecord(diagram)) {
    errors.push(`${base} must be an object`);
    return;
  }

  validateId(diagram.id, `${base}.id`, errors);
  if (!nonEmptyString(diagram.title)) errors.push(`${base}.title must be a non-empty string`);
  if (!DIALECTS.includes(diagram.dialect as (typeof DIALECTS)[number])) {
    errors.push(`${base}.dialect must be one of ${DIALECTS.join(', ')}`);
  }

  for (const field of ['groups', 'nodes', 'edges'] as const) {
    if (!Array.isArray(diagram[field])) errors.push(`${base}.${field} must be an array`);
  }
  if (!Array.isArray(diagram.groups) || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return;

  for (const duplicate of duplicateIds(diagram.groups)) errors.push(`${base}.groups contains duplicate id "${duplicate}"`);
  for (const duplicate of duplicateIds(diagram.nodes)) errors.push(`${base}.nodes contains duplicate id "${duplicate}"`);
  for (const duplicate of duplicateIds(diagram.edges)) errors.push(`${base}.edges contains duplicate id "${duplicate}"`);

  const groupIds = new Set<string>();
  diagram.groups.forEach((group, groupIndex) => {
    const path = `${base}.groups[${groupIndex}]`;
    if (!isRecord(group)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (validateId(group.id, `${path}.id`, errors)) groupIds.add(group.id);
    if (!nonEmptyString(group.title)) errors.push(`${path}.title must be a non-empty string`);
    if (!GROUP_KINDS.has(String(group.kind))) errors.push(`${path}.kind must be block, frame or aws`);
    if (!GROUP_COLORS.has(String(group.color))) errors.push(`${path}.color is not a supported template colour`);
    if (!integer(group.col)) errors.push(`${path}.col must be a non-negative integer`);
    if (!integer(group.row)) errors.push(`${path}.row must be a non-negative integer`);
  });

  diagram.groups.forEach((group, groupIndex) => {
    if (!isRecord(group) || group.parent === undefined) return;
    if (!groupIds.has(String(group.parent))) errors.push(`${base}.groups[${groupIndex}].parent references unknown group "${group.parent}"`);
    if (group.parent === group.id) errors.push(`${base}.groups[${groupIndex}] cannot parent itself`);
  });

  for (const group of diagram.groups) {
    if (!isRecord(group) || typeof group.id !== 'string') continue;
    const visited = new Set<string>([group.id]);
    let current: JsonObject | undefined = group;
    while (current && typeof current.parent === 'string') {
      if (visited.has(current.parent)) {
        errors.push(`${base}.groups contains a parent cycle through "${current.parent}"`);
        break;
      }
      visited.add(current.parent);
      current = diagram.groups.find((candidate) => isRecord(candidate) && candidate.id === current?.parent) as JsonObject | undefined;
    }
  }

  const nodeIds = new Set<string>();
  diagram.nodes.forEach((node, nodeIndex) => {
    const path = `${base}.nodes[${nodeIndex}]`;
    if (!isRecord(node)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (validateId(node.id, `${path}.id`, errors)) nodeIds.add(node.id);
    if (!nonEmptyString(node.title)) errors.push(`${path}.title must be a non-empty string`);
    if (!integer(node.col)) errors.push(`${path}.col must be a non-negative integer`);
    if (!integer(node.row)) errors.push(`${path}.row must be a non-negative integer`);
    if (node.group !== undefined && !groupIds.has(String(node.group))) errors.push(`${path}.group references unknown group "${node.group}"`);
    if (Array.isArray(node.controls) && node.controls.length > 3) warnings.push(`${path}.controls has more than three tags; only three fit comfortably on canvas`);
  });

  const edgeIds = new Set<string>();
  diagram.edges.forEach((edge, edgeIndex) => {
    const path = `${base}.edges[${edgeIndex}]`;
    if (!isRecord(edge)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (validateId(edge.id, `${path}.id`, errors)) edgeIds.add(edge.id);
    if (!nodeIds.has(String(edge.from))) errors.push(`${path}.from references unknown node "${edge.from}"`);
    if (!nodeIds.has(String(edge.to))) errors.push(`${path}.to references unknown node "${edge.to}"`);
    if (!EDGE_KINDS.has(String(edge.kind))) errors.push(`${path}.kind must be flow, loop or ref`);
  });

  if (diagram.dialect === 'pyramid' && (diagram.groups.length > 0 || diagram.edges.length > 0)) {
    errors.push(`${base} uses the pyramid dialect, which does not render groups or edges`);
  }

  if (diagram.steps !== undefined && !Array.isArray(diagram.steps)) {
    errors.push(`${base}.steps must be an array when provided`);
  } else if (Array.isArray(diagram.steps)) {
    const stepNumbers = new Set<number>();
    diagram.steps.forEach((step, stepIndex) => {
      const path = `${base}.steps[${stepIndex}]`;
      if (!isRecord(step)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (!Number.isInteger(step.n) || Number(step.n) < 1) errors.push(`${path}.n must be a positive integer`);
      else if (stepNumbers.has(Number(step.n))) errors.push(`${base}.steps contains duplicate number ${step.n}`);
      else stepNumbers.add(Number(step.n));
      if (!nonEmptyString(step.text)) errors.push(`${path}.text must be a non-empty string`);
      if (!Array.isArray(step.nodes)) errors.push(`${path}.nodes must be an array`);
      else for (const id of step.nodes) if (!nodeIds.has(String(id))) errors.push(`${path}.nodes references unknown node "${id}"`);
      if (!Array.isArray(step.edges)) errors.push(`${path}.edges must be an array`);
      else for (const id of step.edges) if (!edgeIds.has(String(id))) errors.push(`${path}.edges references unknown edge "${id}"`);
    });
  }

  const ownVocabulary = legendTags(diagram);
  const vocabulary = ownVocabulary.size > 0 ? ownVocabulary : fallbackVocabulary ?? new Set<string>();
  const usedControls: string[] = [];
  for (const item of [...diagram.nodes, ...diagram.edges]) {
    if (!isRecord(item) || !Array.isArray(item.controls)) continue;
    usedControls.push(...item.controls.filter((tag): tag is string => typeof tag === 'string'));
  }
  if (usedControls.length > 0 && ownVocabulary.size === 0 && ambiguousFallback) {
    errors.push(`${base} uses control tags without its own legend, but the set has multiple possible legend vocabularies`);
  } else if (usedControls.length > 0 && vocabulary.size === 0) {
    errors.push(`${base} uses control tags but declares no legend vocabulary`);
  } else {
    for (const tag of usedControls) if (!vocabulary.has(tag)) errors.push(`${base} uses unresolved control tag "${tag}"`);
  }

  if (diagram.nodes.length === 0) warnings.push(`${base} contains no nodes`);
  if (diagram.dialect === 'aws' && !Array.isArray(diagram.steps)) warnings.push(`${base} is an aws view without a narrative steps array`);
}

export function validateProjectSpec(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ['project spec must be an object'], warnings };
  if (!nonEmptyString(input.title)) errors.push('title must be a non-empty string');
  if (!Array.isArray(input.diagrams) || input.diagrams.length === 0) {
    errors.push('diagrams must be a non-empty array');
  } else {
    const vocabularies = input.diagrams
      .filter(isRecord)
      .map(legendTags)
      .filter((tags) => tags.size > 0);
    const fallbackVocabulary = vocabularies.length === 1 ? vocabularies[0] : undefined;
    input.diagrams.forEach((diagram, index) => validateDiagram(diagram, index, errors, warnings, fallbackVocabulary, vocabularies.length > 1));
    for (const duplicate of duplicateIds(input.diagrams)) errors.push(`diagrams contains duplicate id "${duplicate}"`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function assertProjectSpec(input: unknown): asserts input is ArcProjectSpec {
  const result = validateProjectSpec(input);
  if (!result.valid) throw new Error(`Invalid arc-diagram project:\n- ${result.errors.join('\n- ')}`);
}
