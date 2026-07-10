import { getAgent } from '../agents/registry.js';
import { appendDailyNote } from '../agents/personality.js';
import * as renderer from '../chat/renderer.js';

export async function executeScheduledTask(
  scheduleId: string,
  agentId: string,
  taskPrompt: string
): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent) {
    console.error(`[Scheduler] Agente "${agentId}" nao encontrado para tarefa ${scheduleId}`);
    return;
  }

  try {
    renderer.renderSystemMessage(`[Cron] Executando para ${agent.name}: "${taskPrompt}"`);
    const response = await agent.processMessage(taskPrompt, {
      context: 'Esta e uma tarefa agendada (cron). Execute o que foi pedido e reporte o resultado.',
    });

    renderer.renderAgentMessage(agent.id, `${agent.name} (cron)`, response);
    appendDailyNote(agent.id, `Tarefa agendada executada ("${taskPrompt}"): ${response.replace(/\s+/g, ' ').slice(0, 300)}`);
  } catch (error) {
    console.error(`[Scheduler] Erro ao executar tarefa ${scheduleId}:`, error);
    appendDailyNote(agent.id, `Tarefa agendada FALHOU ("${taskPrompt}"): ${error instanceof Error ? error.message : 'erro'}`);
  }
}
