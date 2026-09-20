#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ArcDiagramServer } from './server.js';
import { createProject } from './scaffold.js';
import { validateProjectSpec } from './validation.js';

export * from './dialects.js';
export * from './scaffold.js';
export * from './schema.js';
export * from './types.js';
export * from './validation.js';

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(path.resolve(file), 'utf8'));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'serve') {
    await new ArcDiagramServer().run();
    return;
  }
  if (command === 'validate') {
    if (!args[0]) throw new Error('Usage: arc-diagram-mcp validate <spec.json>');
    const result = validateProjectSpec(await readJson(args[0]));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.valid ? 0 : 1;
    return;
  }
  if (command === 'create') {
    if (!args[0] || !args[1]) throw new Error('Usage: arc-diagram-mcp create <spec.json> <absolute-output-directory> [--overwrite]');
    const result = await createProject(await readJson(args[0]), {
      outputDirectory: path.resolve(args[1]),
      overwrite: args.includes('--overwrite'),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`Unknown command "${command}". Use serve, validate or create.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
