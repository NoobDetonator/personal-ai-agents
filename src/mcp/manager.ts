import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { dynamicTool, jsonSchema, type ToolSet } from 'ai';
import { getConfig } from '../config/loader.js';

interface McpServerStatus {
  server: string;
  connected: boolean;
  tools: string[];
  error?: string;
}

const clients = new Map<string, Client>();
let mcpTools: ToolSet = {};
let statuses: McpServerStatus[] = [];

function contentToText(result: { content?: Array<{ type: string; text?: string }> ; isError?: boolean }): string {
  const parts = (result.content ?? []).map(c =>
    c.type === 'text' && typeof c.text === 'string' ? c.text : JSON.stringify(c)
  );
  const text = parts.join('\n') || '(sem conteudo)';
  return result.isError ? `[ERRO do server MCP] ${text}` : text;
}

/**
 * Conecta aos servers MCP do config e monta o toolset com tools prefixadas
 * mcp_<server>_<tool>. Falha de um server vira warning, nunca derruba o app.
 */
export async function startMcpClients(): Promise<void> {
  const servers = getConfig().mcp.servers;
  mcpTools = {};
  statuses = [];

  for (const [name, spec] of Object.entries(servers)) {
    try {
      const client = new Client({ name: 'personal-ai-agents', version: '3.0.0' });

      if ('url' in spec) {
        await client.connect(new StreamableHTTPClientTransport(new URL(spec.url)));
      } else {
        await client.connect(new StdioClientTransport({
          command: spec.command,
          args: spec.args ?? [],
          env: { ...process.env as Record<string, string>, ...(spec.env ?? {}) },
        }));
      }

      const { tools } = await client.listTools();
      const toolNames: string[] = [];

      for (const t of tools) {
        const fullName = `mcp_${name}_${t.name}`;
        toolNames.push(fullName);
        mcpTools[fullName] = dynamicTool({
          description: `[MCP:${name}] ${t.description ?? t.name}`,
          inputSchema: jsonSchema((t.inputSchema ?? { type: 'object', properties: {} }) as Parameters<typeof jsonSchema>[0]),
          execute: async (args) => {
            const result = await client.callTool({
              name: t.name,
              arguments: (args ?? {}) as Record<string, unknown>,
            });
            return contentToText(result as { content?: Array<{ type: string; text?: string }>; isError?: boolean });
          },
        });
      }

      clients.set(name, client);
      statuses.push({ server: name, connected: true, tools: toolNames });
      console.log(`  MCP: "${name}" conectado (${toolNames.length} tool(s)).`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'erro desconhecido';
      statuses.push({ server: name, connected: false, tools: [], error: msg });
      console.warn(`  MCP: falha ao conectar "${name}": ${msg}`);
    }
  }
}

export function getMcpTools(): ToolSet {
  return mcpTools;
}

export function getMcpStatus(): McpServerStatus[] {
  return statuses;
}

export async function stopMcpClients(): Promise<void> {
  for (const [, client] of clients) {
    try {
      await client.close();
    } catch { /* best-effort */ }
  }
  clients.clear();
  mcpTools = {};
}
