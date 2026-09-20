import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { DIALECT_DESCRIPTIONS } from './dialects.js';
import { DIAGRAM_SCHEMA, PROJECT_PROPERTIES } from './schema.js';
import { createProject } from './scaffold.js';
import { validateProjectSpec } from './validation.js';

type Arguments = Record<string, unknown> | undefined;

export class ArcDiagramServer {
  readonly server: Server;

  constructor() {
    this.server = new Server(
      { name: 'arc-diagram-mcp', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    this.setupHandlers();
    this.server.onerror = (error) => console.error('[arc-diagram-mcp]', error);
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_arc_diagram_dialects',
          description: 'List the supported arc-diagram visual dialects, their semantics and authoring constraints.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'get_arc_diagram_contract',
          description: 'Return the complete DiagramDef JSON contract plus the core authoring rules used by the renderer.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'validate_arc_diagram_set',
          description: 'Validate diagram identities, references, dialect constraints, steps and control legends without writing files.',
          inputSchema: {
            type: 'object',
            properties: PROJECT_PROPERTIES,
            required: ['title', 'diagrams'],
            additionalProperties: false,
          },
        },
        {
          name: 'create_arc_diagram_project',
          description: 'Create a complete interactive React Flow arc-diagram project from validated DiagramDef objects. The project includes edit mode, embed mode, light/dark themes, geometric probes, PNG export and a self-contained offline HTML build.',
          inputSchema: {
            type: 'object',
            properties: {
              ...PROJECT_PROPERTIES,
              outputDirectory: { type: 'string', description: 'Absolute destination path. Must be empty unless overwrite is true.' },
              overwrite: { type: 'boolean', default: false, description: 'Replace files managed by this scaffold while preserving unrelated files.' },
            },
            required: ['title', 'diagrams', 'outputDirectory'],
            additionalProperties: false,
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments as Arguments;
      try {
        switch (request.params.name) {
          case 'list_arc_diagram_dialects':
            return this.text({ dialects: DIALECT_DESCRIPTIONS });
          case 'get_arc_diagram_contract':
            return this.text({
              schema: DIAGRAM_SCHEMA,
              rules: [
                'Choose dialect from the source structure or visual metaphor, never from the view name alone.',
                'Visible text is an audience-facing abstraction; repository paths and evidence belong in citations.',
                'Use status=to-confirm consistently on every view where an unresolved component appears.',
                'Node, group and edge ids are kebab-case and unique within their collection.',
                'Run validation before creation, then run both light and dark layout probes on the generated app.',
              ],
            });
          case 'validate_arc_diagram_set':
            return this.text(validateProjectSpec(args));
          case 'create_arc_diagram_project': {
            if (!args || typeof args.outputDirectory !== 'string') throw new Error('outputDirectory is required');
            const { outputDirectory, overwrite, ...spec } = args;
            const result = await createProject(spec, { outputDirectory, overwrite: overwrite === true });
            return this.text(result);
          }
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    });
  }

  private text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
  }

  async run(): Promise<void> {
    await this.server.connect(new StdioServerTransport());
    console.error('arc-diagram-mcp running on stdio');
  }
}
