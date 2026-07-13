import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { getProjectContext } from '../projects/context.js';

export type AgentRuntimeEventType = 'tool_start' | 'tool_result' | 'skill_activated';

/**
 * Telemetria comum a CLI, chat web, grupos e delegacoes. Ela e fail-open:
 * observabilidade nunca pode derrubar a execucao principal.
 */
export function recordAgentRuntimeEvent(
  agentId: string,
  type: AgentRuntimeEventType,
  payload: unknown,
): void {
  try {
    const context = getProjectContext();
    getDb().prepare(
      `INSERT INTO agent_runtime_events
       (id, project_id, conversation_id, run_id, agent_id, surface, type, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      context?.projectId ?? null,
      context?.conversationId ?? null,
      context?.runId ?? null,
      agentId,
      context?.runId ? 'run' : context?.projectId ? 'project' : 'legacy',
      type,
      JSON.stringify(payload),
    );
  } catch {
    // Banco ainda nao inicializado, encerrando ou indisponivel.
  }
}
