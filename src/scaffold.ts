import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProjectSpec } from './validation.js';
import type { ArcProjectSpec, CreatedProject, CreateProjectOptions } from './types.js';

const moduleDirectory = fileURLToPath(new URL('.', import.meta.url));

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'arc-diagrams';
}

function diagramModule(value: unknown): string {
  return `import type { DiagramDef } from '../model';\n\nexport const diagrams: DiagramDef[] = ${JSON.stringify(value, null, 2)};\n`;
}

async function directoryHasEntries(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function templateDirectory(): Promise<string> {
  const configured = process.env.ARC_DIAGRAM_TEMPLATE_DIR;
  const candidates = configured
    ? [path.resolve(configured)]
    : [path.resolve(moduleDirectory, '../template'), path.resolve(moduleDirectory, '../../template')];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, 'src/model.ts'));
      return candidate;
    } catch { /* try the source-tree or compiled-tree location */ }
  }
  throw new Error(`Bundled arc-diagram template not found (checked ${candidates.join(', ')})`);
}

export async function createProject(input: unknown, options: CreateProjectOptions): Promise<CreatedProject> {
  assertProjectSpec(input);
  const spec: ArcProjectSpec = input;
  if (!options.outputDirectory || !path.isAbsolute(options.outputDirectory)) {
    throw new Error('outputDirectory must be an absolute path');
  }

  const outputDirectory = path.resolve(options.outputDirectory);
  if (await directoryHasEntries(outputDirectory) && !options.overwrite) {
    throw new Error(`Refusing to write into non-empty directory ${outputDirectory}; pass overwrite=true to replace managed files`);
  }

  await mkdir(outputDirectory, { recursive: true });
  if (options.overwrite) {
    await rm(path.join(outputDirectory, 'src/data'), { recursive: true, force: true });
  }
  const sourceTemplate = await templateDirectory();
  const sourceDataDirectory = path.join(sourceTemplate, 'src/data');
  await cp(sourceTemplate, outputDirectory, {
    recursive: true,
    force: Boolean(options.overwrite),
    filter: (source) => {
      if (source === sourceDataDirectory || source.startsWith(`${sourceDataDirectory}${path.sep}`)) return false;
      return !['node_modules', 'dist', 'dist-offline', 'exports', 'baseline-exports', 'baseline-exports2'].includes(path.basename(source));
    },
  });

  const eyebrow = spec.eyebrow?.trim() || 'ARCHITECTURE DIAGRAMS';
  const project = { title: spec.title.trim(), eyebrow };
  const ids = spec.diagrams.map((diagram) => diagram.id);
  const manifest = { schemaVersion: 1, title: project.title, eyebrow, diagramIds: ids };

  const files = {
    'src/project.ts': `export const project: { title: string; eyebrow: string } = ${JSON.stringify(project, null, 2)};\n`,
    'src/data/diagram-set.ts': diagramModule(spec.diagrams),
    'arc-diagram.project.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'scripts/baseline.json': `${JSON.stringify({
      note: 'Take the first baseline only after the generated diagram set passes the build, text lint, layout probes and human export review.',
      files: {},
    }, null, 2)}\n`,
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(outputDirectory, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, 'utf8');
  }

  const packagePath = path.join(outputDirectory, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
  packageJson.name = `${slugify(spec.title)}-arc-diagrams`;
  packageJson.version = '0.1.0';
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  const indexPath = path.join(outputDirectory, 'index.html');
  const index = await readFile(indexPath, 'utf8');
  await writeFile(indexPath, index.replace(/<title>.*?<\/title>/s, `<title>${project.title.replace(/[<&]/g, '')}</title>`), 'utf8');

  return {
    outputDirectory,
    diagramIds: ids,
    filesWritten: Object.keys(files).concat(['package.json', 'index.html']),
    nextSteps: [
      `cd ${JSON.stringify(outputDirectory)}`,
      'npm install',
      'npm run build',
      'npm run build:offline',
      'npm run lint:text',
      'npm run probe -- --theme light',
      'npm run probe -- --theme dark',
      'npm run export',
      'npm run baseline',
      'npm run gate',
    ],
  };
}
