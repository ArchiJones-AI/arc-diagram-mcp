import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProject } from '../src/scaffold.js';

const fixturePath = path.resolve('examples/minimal-project.json');

async function fixture(): Promise<unknown> {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

test('scaffold creates a self-contained project with one generated data module', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'arc-diagram-mcp-'));
  const output = path.join(root, 'checkout');
  const result = await createProject(await fixture(), { outputDirectory: output });

  assert.deepEqual(result.diagramIds, ['system', 'application', 'runtime']);
  assert.deepEqual(await readdir(path.join(output, 'src/data')), ['diagram-set.ts']);

  const manifest = JSON.parse(await readFile(path.join(output, 'arc-diagram.project.json'), 'utf8'));
  assert.deepEqual(manifest.diagramIds, result.diagramIds);

  const app = await readFile(path.join(output, 'src/App.tsx'), 'utf8');
  assert.match(app, /from '\.\/data\/diagram-set'/);
  assert.match(app, /project\.eyebrow/);

  const packageJson = JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'checkout-platform-arc-diagrams');
  assert.equal(packageJson.scripts.baseline, 'node scripts/cmp-baseline.mjs --write');
});

test('scaffold refuses a non-empty destination by default', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'arc-diagram-mcp-'));
  const output = path.join(root, 'occupied');
  await mkdir(output);
  await writeFile(path.join(output, 'keep.txt'), 'mine', 'utf8');

  await assert.rejects(
    createProject(await fixture(), { outputDirectory: output }),
    /Refusing to write into non-empty directory/,
  );
  assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'mine');
});

test('overwrite mode preserves unrelated files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'arc-diagram-mcp-'));
  const output = path.join(root, 'occupied');
  await mkdir(output);
  await writeFile(path.join(output, 'keep.txt'), 'mine', 'utf8');

  await createProject(await fixture(), { outputDirectory: output, overwrite: true });
  assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'mine');
  assert.equal(typeof JSON.parse(await readFile(path.join(output, 'arc-diagram.project.json'), 'utf8')).title, 'string');
});
