import { getAgent } from '../agents/registry.js';
import { appendScopedDailyNote } from '../projects/agent-memory.js';
import { buildProjectContext } from '../projects/service.js';
import { runWithProjectContext } from '../projects/context.js';
import { appendRunEvent, createRun, finishRun } from '../db/run-helpers.js';
import * as renderer from '../chat/renderer.js';

export async function executeScheduledTask(
  scheduleId: string,
  agentId: string,
  taskPrompt: string,
  projectId = 'legacy',
): Promise<void> {
  const runId = createRun({ projectId, agentId, kind: 'schedule' });
  appendRunEvent(runId, 'status', { status: 'running', scheduleId });
  const agent = getAgent(agentId);
  if (!agent) {
    const message = `Agente "${agentId}" nao encontrado para tarefa ${scheduleId}`;
    finishRun(runId, { status: 'failed', errorCode: 'agent_not_found', errorMessage: message });
    console.error('[Scheduler] ' + message);
    return;
  }

  const projectContext = buildProjectContext(projectId, { runId });
  try {
    await runWithProjectContext(projectContext, async () => {
      renderer.renderSystemMessage(`[Cron] Executando para ${agent.name}: "${taskPrompt}"`);
      const response = await agent.processMessage(taskPrompt, {
        context: 'Esta e uma tarefa agendada (cron). Execute o que foi pedido e reporte o resultado.',
      });

      renderer.renderAgentMessage(agent.id, `${agent.name} (cron)`, response);
      appendScopedDailyNote(agent.id, `Tarefa agendada executada ("${taskPrompt}"): ${response.replace(/\s+/g, ' ').slice(0, 300)}`);
    });
    finishRun(runId, { status: 'done' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro';
    finishRun(runId, { status: 'failed', errorCode: 'schedule_failed', errorMessage: message });
    console.error(`[Scheduler] Erro ao executar tarefa ${scheduleId}:`, error);
    await runWithProjectContext(projectContext, async () => {
      appendScopedDailyNote(agent.id, `Tarefa agendada FALHOU ("${taskPrompt}"): ${message}`);
    });
  }
}
