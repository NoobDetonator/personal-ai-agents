import { getConfig } from '../config/loader.js';
import { getAgent } from '../agents/registry.js';
import { getDb } from '../db/connection.js';
import { listTaskRows } from '../tools/tasks.js';
import { appendDailyNote } from '../agents/personality.js';
import * as renderer from '../chat/renderer.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startHeartbeat(): void {
  const cfg = getConfig().heartbeat;
  if (!cfg.enabled || timer) return;

  const intervalMs = Math.max(1, cfg.intervalMin) * 60 * 1000;
  timer = setInterval(() => {
    void beat();
  }, intervalMs);
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function refreshHeartbeat(): void {
  stopHeartbeat();
  startHeartbeat();
}

async function beat(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const config = getConfig();
    const cfg = config.heartbeat;
    const agent = getAgent(cfg.agent) ?? getAgent(config.defaultAgent);
    if (!agent) return;

    // Cheap pre-check: only wake the model when there is something to look at
    const pendingTasks = listTaskRows('pending').length + listTaskRows('in_progress').length;
    let unreadMessages = 0;
    try {
      const db = getDb();
      const row = db.prepare('SELECT COUNT(*) AS c FROM agent_messages WHERE read = 0').get() as { c: number };
      unreadMessages = row.c;
    } catch { /* best-effort */ }

    if (pendingTasks === 0 && unreadMessages === 0) return;

    const status = `Status atual: ${pendingTasks} tarefa(s) aberta(s) no board, ${unreadMessages} mensagem(ns) nao lida(s) entre agentes.`;

    const response = await agent.processMessage(`${cfg.prompt}\n\n${status}`, {
      context:
        'Este e um heartbeat automatico do sistema (nenhum usuario esta perguntando nada). ' +
        'Revise o que esta pendente e aja se necessario usando suas ferramentas. ' +
        'Responda com um resumo curto do que voce verificou/fez.',
    });

    const short = response.replace(/\s+/g, ' ').trim().slice(0, 200);
    renderer.renderSystemMessage(`[Heartbeat] ${agent.name}: ${short}`);
    appendDailyNote(agent.id, `Heartbeat: ${short}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'erro';
    renderer.renderSystemMessage(`[Heartbeat] falhou: ${msg}`);
  } finally {
    running = false;
  }
}
