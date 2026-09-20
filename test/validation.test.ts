import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { validateProjectSpec } from '../src/validation.js';

const fixturePath = path.resolve('examples/minimal-project.json');

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
}

test('the complete example satisfies the structural contract', async () => {
  const result = validateProjectSpec(await fixture());
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.deepEqual(result.errors, []);
});

test('an edge cannot reference a missing node', async () => {
  const spec = await fixture();
  const diagrams = spec.diagrams as Array<Record<string, unknown>>;
  const edges = diagrams[0].edges as Array<Record<string, unknown>>;
  edges[0].to = 'not-a-node';
  const result = validateProjectSpec(spec);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes('references unknown node "not-a-node"')));
});

test('the pyramid dialect rejects data classes it cannot render', async () => {
  const spec = await fixture();
  const diagrams = spec.diagrams as Array<Record<string, unknown>>;
  diagrams[0].dialect = 'pyramid';
  const result = validateProjectSpec(spec);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.includes('does not render groups or edges')));
});

test('one legend can provide the shared control vocabulary', () => {
  const spec = {
    title: 'Controls',
    diagrams: [
      {
        id: 'vocabulary', dialect: 'editorial', title: 'Vocabulary', groups: [],
        nodes: [{ id: 'a', title: 'A', col: 0, row: 0 }], edges: [],
        legend: { title: 'Controls', groups: [{ heading: 'Policy', items: [{ tag: 'SIGNED', meaning: 'Signed requests', administeredBy: ['product'] }] }] },
      },
      {
        id: 'consumer', dialect: 'editorial', title: 'Consumer', groups: [],
        nodes: [{ id: 'b', title: 'B', col: 0, row: 0, controls: ['SIGNED'] }], edges: [],
      },
    ],
  };
  const result = validateProjectSpec(spec);
  assert.equal(result.valid, true, result.errors.join('\n'));
});
