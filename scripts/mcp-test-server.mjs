// Mini server MCP (stdio) para verificar a integracao — uma tool "ping".
// Registre no config.json:
//   "mcp": { "servers": { "teste": { "command": "node", "args": ["scripts/mcp-test-server.mjs"] } } }
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'teste', version: '1.0.0' });

server.registerTool(
  'ping',
  {
    description: 'Responde pong com a mensagem enviada (teste de conectividade MCP)',
    inputSchema: { message: z.string().describe('Mensagem qualquer') },
  },
  async ({ message }) => ({
    content: [{ type: 'text', text: `pong: ${message} (respondido pelo server MCP de teste)` }],
  }),
);

await server.connect(new StdioServerTransport());
