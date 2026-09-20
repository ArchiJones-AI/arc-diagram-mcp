#!/usr/bin/env node
/**
 * Canvas-text gate — what the READER sees, checked before any export.
 *
 * Three classes of finding, all of them field-caught on a customer-facing set:
 *   1. banned canvas text — internal identifiers and register ids that mean
 *      nothing to the reader (document numbers, question ids, roadmap words),
 *      plus section marks (§) anywhere outside a `citations` array
 *   2. unresolvable control tag — a `controls` tag with no matching legend
 *      item, checked against this view's own legend or, for views without
 *      one, the single view that declares the full vocabulary
 *   3. to-confirm drift — a value still open in a source YAML file whose
 *      tiles have quietly gone solid. The key-to-tile map is EXPLICIT and
 *      stays explicit: inferring it from "every open value" is how open tiles
 *      get lost when the YAML grows.
 *
 * Standalone by design: it imports nothing from the project it lints, so it
 * survives being copied into any diagram fork.
 *
 * Config: canvas-text.rules.json beside package.json (copy the .example).
 *   {
 *     "banned":     ["/\\bdoc [0-9]/gi", ...],   source files, full set
 *     "bundleSafe": ["/\\bdoc [0-9]/gi", ...],   subset applied to the bundle
 *     "values":     { "file": "../values.yaml",
 *                     "toConfirmMap": { "a.b.c": ["node-id"] } },
 *     "vocabularyFile": "src/data/seat.ts"       optional; auto-detected
 *   }
 * A rule is either "/pattern/flags" or a bare pattern (defaults to gi).
 *
 * Usage: node scripts/lint-canvas-text.mjs [--config canvas-text.rules.json]
 * Exits non-zero on any finding, so it can gate a build.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.join(appRoot, 'src/data');
const configArgIndex = process.argv.indexOf('--config');
const configPath = path.join(appRoot, configArgIndex > -1
  ? process.argv[configArgIndex + 1]
  : 'canvas-text.rules.json');

let config = { banned: [], bundleSafe: [] };
let configured = false;
try {
  config = JSON.parse(await readFile(configPath, 'utf8'));
  configured = true;
} catch (error) {
  if (error instanceof SyntaxError) {
    console.error(`${path.relative(appRoot, configPath)}: CONFIG: not valid JSON — ${error.message}`);
    console.log('FAIL — 1 config problem(s)');
    process.exit(1);
  }
  if (error.code !== 'ENOENT') throw error;
  console.log(`${path.relative(appRoot, configPath)} not found — copy canvas-text.rules.example.json to configure it. Running the legend-coverage check only: the banned-text check needs "banned", and the to-confirm check needs a "values" block, so NEITHER is running.`);
}

/**
 * A config that is PRESENT but the wrong shape must fail. A malformed file
 * that silently disables the banned-text check is worse than no file: the
 * gate still says PASS and nobody learns the check stopped running.
 */
const shapeErrors = [];
if (configured) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    shapeErrors.push('the file must contain a JSON object');
  } else {
    for (const key of ['banned', 'bundleSafe']) {
      if (config[key] !== undefined && !Array.isArray(config[key])) shapeErrors.push(`"${key}" must be an array of regex strings`);
    }
    // Omitting `banned` disables the check as silently as an empty one does.
    // A file that exists has to say what it bans; to run without the check,
    // delete the file — that path announces itself on stdout.
    if (config.banned === undefined) shapeErrors.push('"banned" is missing — list the rules, or delete the config file to run without the banned-text check');
    else if (Array.isArray(config.banned) && config.banned.length === 0) shapeErrors.push('"banned" is empty — list the rules, or delete the config file to run without the banned-text check');
    if (config.values !== undefined) {
      if (typeof config.values !== 'object' || config.values === null) shapeErrors.push('"values" must be an object');
      else {
        if (typeof config.values.file !== 'string') shapeErrors.push('"values.file" must be a path string');
        if (typeof config.values.toConfirmMap !== 'object' || config.values.toConfirmMap === null || Array.isArray(config.values.toConfirmMap)) shapeErrors.push('"values.toConfirmMap" must be an object of yaml-key to node-id array');
        else {
        if (Object.keys(config.values.toConfirmMap).length === 0) shapeErrors.push('"values.toConfirmMap" is empty — list the open keys, or remove the "values" block; an empty map checks nothing');
          for (const [key, ids] of Object.entries(config.values.toConfirmMap)) {
            if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) shapeErrors.push(`"values.toConfirmMap.${key}" must be an array of node id strings`);
          }
        }
      }
    }
    if (config.vocabularyFile !== undefined && typeof config.vocabularyFile !== 'string') shapeErrors.push('"vocabularyFile" must be a path string');
  }
}
if (shapeErrors.length) {
  for (const problem of shapeErrors) console.error(`${path.relative(appRoot, configPath)}: CONFIG: ${problem}`);
  console.log(`FAIL — ${shapeErrors.length} config problem(s)`);
  process.exit(1);
}

/** "/pattern/flags" or a bare pattern (case-insensitive, global). */
function compile(rule) {
  if (typeof rule !== 'string') throw new TypeError(`rule must be a string, got ${typeof rule}`);
  const match = /^\/(.*)\/([gimsuy]*)$/s.exec(rule);
  const [source, flags] = match ? [match[1], match[2]] : [rule, 'gi'];
  return new RegExp(source, flags.includes('g') ? flags : `${flags}g`);
}
// A broken pattern names itself rather than throwing a stack trace at load.
const bannedRules = [];
for (const rule of config.banned ?? []) {
  try {
    bannedRules.push({ rule, regex: compile(rule) });
  } catch (error) {
    console.error(`${path.relative(appRoot, configPath)}: CONFIG: rule ${JSON.stringify(rule)} is not a usable regex — ${error.message}`);
    console.log('FAIL — 1 config problem(s)');
    process.exit(1);
  }
}
const bundleSafe = new Set(config.bundleSafe ?? []);

const findings = [];
const fail = (file, line, rule, message) => findings.push({ file, line, rule, message });
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

// Blank out `citations: [...]` arrays while preserving offsets and newlines,
// so a § inside a citation is legal and every reported line number is real.
const quotedString = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60)`;
const citationArray = new RegExp(String.raw`(?:\bcitations|"citations"|'citations')\s*:\s*\[\s*(?:${quotedString}\s*(?:,\s*${quotedString}\s*)*,?\s*)?\]`, 'g');
function withoutCitations(text) {
  return text.replace(citationArray, (array) => array.replace(/[^\n\r]/g, ' '));
}

/** Minimal mapping-only YAML walker; nested leaves keep their dotted scope. */
function yamlLeaves(text) {
  const leaves = new Map();
  const stack = [];
  text.split('\n').forEach((line, index) => {
    const match = line.match(/^( *)([A-Za-z_][\w-]*):(?:\s+(.*))?\s*$/);
    if (!match) return;
    const [, indent, key, raw = ''] = match;
    while (stack.length && stack.at(-1).indent >= indent.length) stack.pop();
    const field = [...stack.map((entry) => entry.key), key].join('.');
    if (!raw || raw.startsWith('#')) stack.push({ indent: indent.length, key });
    else leaves.set(field, { value: raw.replace(/^["']/, ''), line: index + 1 });
  });
  return leaves;
}

function property(object, name) {
  return object.properties.find((entry) => ts.isPropertyAssignment(entry)
    && (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) && entry.name.text === name);
}
function stringValue(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

// ── 1. banned canvas text ───────────────────────────────────────────────
let dataFiles = [];
try {
  dataFiles = await readdir(dataDir);
} catch (error) {
  console.error(`src/data: could not be read (${error.code ?? 'unreadable'}) — run this from the app root, or restore the directory`);
  console.log('FAIL — 1 finding(s)');
  process.exit(1);
}
const sourceFiles = dataFiles.filter((name) => name.endsWith('.ts')).sort()
  .map((name) => `src/data/${name}`);
if (sourceFiles.length === 0) {
  console.error('src/data: contains no .ts diagram files — there is nothing to lint, which is a failure rather than a pass');
  console.log('FAIL — 1 finding(s)');
  process.exit(1);
}
const files = new Map();
for (const relPath of [...sourceFiles, 'dist-offline/index.html']) {
  let text;
  try { text = await readFile(path.join(appRoot, relPath), 'utf8'); }
  catch (error) {
    if (relPath === 'dist-offline/index.html' && error.code === 'ENOENT') continue;
    throw error;
  }
  files.set(relPath, text);
  const isBundle = relPath === 'dist-offline/index.html';
  // The bundle is a RESIDUE GUARD only: its canvas text is the same text
  // already linted at source, while minified identifiers, base64 font bytes
  // and library strings collide with word-level rules (21 false positives
  // when the full set was applied). So the bundle gets only the identifier
  // and phrase greps that cannot collide, over text with data: URIs stripped.
  const scanText = isBundle ? text.replace(/data:[^"'\s)]+/g, '') : text;
  const citationFree = withoutCitations(scanText);
  for (const { rule, regex } of bannedRules) {
    if (isBundle && !bundleSafe.has(rule)) continue;
    regex.lastIndex = 0;
    for (const match of scanText.matchAll(regex)) {
      fail(relPath, lineAt(scanText, match.index), 'TEXT', `banned canvas text "${match[0]}" matches rule "${rule}"`);
    }
  }
  for (const match of citationFree.matchAll(/§[0-9]/g)) {
    fail(relPath, lineAt(scanText, match.index), 'TEXT', `section reference outside citations "${match[0]}"`);
  }
}

// ── 2. control tags resolve to a legend item ────────────────────────────
const perFile = new Map();
const parsed = new Map();
for (const relPath of sourceFiles) {
  const text = files.get(relPath);
  const source = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  parsed.set(relPath, source);
  const legendTags = new Set();
  const controlTags = [];
  let hasLegend = false;
  walk(source, (node) => {
    if (!ts.isPropertyAssignment(node)) return;
    const name = node.name.getText(source).replace(/^['"]|['"]$/g, '');
    if (name === 'legend') {
      hasLegend = true;
      walk(node.initializer, (item) => {
        if (!ts.isObjectLiteralExpression(item)) return;
        const tag = stringValue(property(item, 'tag')?.initializer);
        if (tag !== undefined) legendTags.add(tag);
      });
    }
    if (name === 'controls' && ts.isArrayLiteralExpression(node.initializer)) {
      node.initializer.elements.forEach((item) => {
        const tag = stringValue(item);
        if (tag !== undefined) controlTags.push({ tag, line: lineAt(text, item.getStart(source)) });
      });
    }
  });
  perFile.set(relPath, { hasLegend, legendTags, controlTags });
}

// Views without their own legend (kept legend-free so their export crop stays
// tight) validate against the ONE view that declares the vocabulary — the same
// fallback the detail panel uses. Hard-coding that file name is what silently
// yields an empty vocabulary in a fork, so it is detected and asserted.
const declaring = [...perFile.entries()].filter(([, entry]) => entry.hasLegend).map(([relPath]) => relPath);
// A set that uses NO control tags anywhere has no vocabulary to resolve, and
// demanding a legend of it fails a gate over an absence that is provable from
// the data rather than assumed. The emptiness is only safe because it is
// MEASURED here and reported in the PASS line, never inferred from a missing
// legend — which is the case the check above exists to catch.
const usesControls = [...perFile.values()].some((entry) => entry.controlTags.length > 0);
let vocabularyFile = config.vocabularyFile;
if (!vocabularyFile) {
  if (declaring.length === 1) [vocabularyFile] = declaring;
  else if (perFile.size && usesControls) {
    fail('canvas-text.rules.json', 1, 'LEGEND', declaring.length === 0
      ? 'no src/data view declares a `legend` — set vocabularyFile, or give one view a legend'
      : `${declaring.length} views declare a legend (${declaring.join(', ')}) — set vocabularyFile to name the vocabulary`);
  }
}
if (config.vocabularyFile && !perFile.has(config.vocabularyFile)) {
  fail('canvas-text.rules.json', 1, 'LEGEND', `vocabularyFile "${config.vocabularyFile}" is not one of the src/data views (${[...perFile.keys()].join(', ') || 'none found'})`);
}
const vocabulary = (vocabularyFile && perFile.get(vocabularyFile)?.legendTags) ?? new Set();
// An empty legend silently validates nothing, so EVERY declaring view is
// checked — not just the one chosen as the fallback vocabulary. A second view
// with `legend: { groups: [] }` renders an empty legend node to the reader and
// resolves none of its own tags.
for (const relPath of declaring) {
  if ((perFile.get(relPath)?.legendTags.size ?? 0) === 0) {
    fail(relPath, 1, 'LEGEND', relPath === vocabularyFile
      ? 'declares a legend with no items — the fallback vocabulary is empty, so no control tag on any legend-less view is being checked'
      : 'declares a legend with no items — it renders an empty legend and resolves none of its own control tags');
  }
}
if (vocabularyFile && !perFile.has(vocabularyFile) && vocabulary.size === 0) {
  fail(vocabularyFile, 1, 'LEGEND', 'names no readable view, so the fallback vocabulary is empty and no control tag on any legend-less view is being checked');
}
for (const [relPath, { hasLegend, legendTags, controlTags }] of perFile) {
  const against = hasLegend ? legendTags : vocabulary;
  const where = hasLegend ? "this file's legend" : `${vocabularyFile ?? 'the fallback view'} (the shared vocabulary)`;
  if (!hasLegend && controlTags.length) console.log(`${relPath}: no legend — controls checked against ${where}`);
  controlTags.forEach(({ tag, line }) => {
    if (!against.has(tag)) fail(relPath, line, 'LEGEND', `control "${tag}" has no tag in ${where}`);
  });
}

// ── 3. to-confirm coverage ──────────────────────────────────────────────
if (config.values?.toConfirmMap) {
  const valuesPath = path.resolve(appRoot, config.values.file ?? '');
  let valuesText;
  try {
    valuesText = await readFile(valuesPath, 'utf8');
  } catch (error) {
    // A configured-but-unreadable source of truth is a finding, never a crash
    // and never a silent skip: the to-confirm coverage it guards is exactly
    // what goes stale unwatched.
    fail('canvas-text.rules.json', 1, 'TO-CONFIRM',
      `values.file "${config.values.file ?? '(unset)'}" could not be read (${error.code ?? 'unreadable'}) — fix the path, or remove the "values" block if this app has no YAML source of truth`);
  }
  const leaves = valuesText ? yamlLeaves(valuesText) : new Map();
  const valuesLabel = config.values.file;
  const nodeStatus = new Map();
  for (const relPath of sourceFiles) {
    const source = parsed.get(relPath);
    walk(source, (node) => {
      if (!ts.isObjectLiteralExpression(node)) return;
      const nodes = property(node, 'nodes')?.initializer;
      if (!nodes || !ts.isArrayLiteralExpression(nodes)) return;
      nodes.elements.filter(ts.isObjectLiteralExpression).forEach((entry) => {
        const id = stringValue(property(entry, 'id')?.initializer);
        // EVERY occurrence, not just the first: the status rule is that the
        // same component carries the same status on every view it appears in,
        // so a node solid on the second view has to be caught there too.
        if (id) {
          const seen = nodeStatus.get(id) ?? [];
          seen.push({
            file: relPath,
            status: stringValue(property(entry, 'status')?.initializer),
            line: lineAt(files.get(relPath), entry.getStart(source)),
          });
          nodeStatus.set(id, seen);
        }
      });
    });
  }
  for (const [field, nodeIds] of (valuesText ? Object.entries(config.values.toConfirmMap) : [])) {
    const leaf = leaves.get(field);
    if (!leaf?.value.startsWith('TO CONFIRM')) {
      fail(valuesLabel, leaf?.line ?? 1, 'TO-CONFIRM', `${field} must start with TO CONFIRM`);
    }
    for (const id of nodeIds) {
      const occurrences = nodeStatus.get(id);
      if (!occurrences?.length) {
        fail(valuesLabel, leaf?.line ?? 1, 'TO-CONFIRM', `${id} is missing from every view`);
        continue;
      }
      for (const node of occurrences) {
        if (node.status !== 'to-confirm') {
          fail(node.file, node.line, 'TO-CONFIRM', `${id} must carry status: 'to-confirm'`);
        }
      }
    }
  }
}

for (const finding of findings) console.error(`${finding.file}:${finding.line}: ${finding.rule}: ${finding.message}`);
// The PASS line names the checks that ACTUALLY RAN. A summary that lists a
// check which was skipped is the same defect as a gate that passes because it
// had nothing to check: the reader takes coverage they do not have.
const ran = usesControls ? ['legend coverage'] : [];
if (bannedRules.length) ran.unshift('canvas text');
if (config.values?.toConfirmMap) ran.push('to-confirm coverage');
const skipped = [
  ...(usesControls ? [] : ['legend coverage (no view uses a control tag)']),
  ...(bannedRules.length ? [] : ['canvas text (no "banned" rules configured)']),
  ...(config.values?.toConfirmMap ? [] : ['to-confirm coverage (no "values" block configured)']),
];
console.log(findings.length
  ? `FAIL — ${findings.length} finding(s)`
  : `PASS — ${ran.join(', ')}${skipped.length ? ` · NOT CHECKED: ${skipped.join(', ')}` : ''}`);
process.exitCode = findings.length ? 1 : 0;
