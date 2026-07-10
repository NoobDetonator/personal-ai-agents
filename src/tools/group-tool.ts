import { tool } from 'ai';
import { z } from 'zod';
import { getAgent } from '../agents/registry.js';
import { runGroupDiscussion, isGroupRunning } from '../chat/group-chat.js';
import type { Agent } from '../agents/agent.js';

export function createGroupTools(callerId: string) {
  const startGroupDiscussion = tool({
    description:
      'Iniciar uma discussao em grupo entre agentes sobre um topico e receber a sintese final. Use para brainstorm, revisao ou decisoes que se beneficiam de multiplas perspectivas. Custa uma chamada por agente por rodada — use rodadas baixas.',
    inputSchema: z.object({
      agentIds: z.array(z.string()).min(2).max(6).describe('IDs dos agentes participantes (2 a 6)'),
      topic: z.string().describe('Topico/pergunta da discussao, com contexto suficiente'),
      rounds: z.number().int().min(1).max(3).optional().describe('Rodadas de debate (padrao 1; maximo 3)'),
    }),
    execute: async ({ agentIds, topic, rounds }) => {
      if (isGroupRunning()) {
        return { error: 'Ja existe uma discussao em grupo em andamento. Aguarde ela terminar.' };
      }

      const participants: Agent[] = [];
      for (const id of agentIds) {
        if (id === callerId) continue; // caller receives the synthesis; does not debate
        const agent = getAgent(id);
        if (!agent) {
          return { error: `Agente "${id}" nao encontrado.` };
        }
        participants.push(agent);
      }

      if (participants.length < 2) {
        return { error: 'Sao necessarios pelo menos 2 participantes (alem de voce).' };
      }

      const synthesis = await runGroupDiscussion(participants, topic, rounds ?? 1);
      return { synthesis };
    },
  });

  return { startGroupDiscussion };
}
