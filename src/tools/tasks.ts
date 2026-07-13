import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { getAgent, getRole, isSuperiorOf } from '../agents/registry.js';
import { getConfig } from '../config/loader.js';
import * as renderer from '../chat/renderer.js';
import { emitBus } from '../web/bus.js';
import { askConfirmation } from '../chat/confirm.js';
import { getProjectContext } from '../projects/context.js';

export interface TaskRow {
  id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  assignee: string | null;
  status: string;
  result: string | null;
  created_by: string | null;
  team: string | null;
  created_at: string;
  updated_at: string;
  project_id: string | null;
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}

// --- Delegacoes ativas (para timeout, cancelamento e painel) ---

interface ActiveDelegation {
  id: string;
  from: string;
  to: string;
  taskId: string;
  startedAt: number;
  controller: AbortController;
  cancelled?: boolean;
  timedOut?: boolean;
  projectId: string;
}

const activeDelegations = new Map<string, ActiveDelegation>();

export function listActiveDelegations(): Array<{ id: string; from: string; to: string; taskId: string; startedAt: number; projectId: string }> {
  return Array.from(activeDelegations.values()).map(({ id, from, to, taskId, startedAt, projectId }) => ({
    id, from, to, taskId, startedAt, projectId,
  }));
}

export function partitionTasksForDeletion(
  rows: TaskRow[],
  activeTaskIds: Iterable<string>,
): { deletableIds: string[]; skippedActive: number } {
  const active = new Set(activeTaskIds);
  const deletableIds = rows.filter(row => !active.has(row.id)).map(row => row.id);
  return { deletableIds, skippedActive: rows.length - deletableIds.length };
}

/** Cancela uma delegacao em andamento (chamado pelo painel web). */
export function cancelDelegation(id: string): boolean {
  const d = activeDelegations.get(id);
  if (!d) return false;
  d.cancelled = true;
  d.controller.abort();
  return true;
}

export function listTaskRows(status?: string, team?: string, projectId?: string): TaskRow[] {
  const db = getDb();
  const where: string[] = [];
  const params: string[] = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (team) {
    where.push('team = ?');
    params.push(team);
  }
  if (projectId) {
    where.push("COALESCE(project_id, 'legacy') = ?");
    params.push(projectId);
  }
  const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at ASC`;
  return db.prepare(sql).all(...params) as TaskRow[];
}

function setTaskStatus(taskId: string, status: string, result?: string, projectId?: string): boolean {
  const db = getDb();
  const scope = projectId ? " AND COALESCE(project_id, 'legacy') = ?" : '';
  const info = db.prepare(
    "UPDATE tasks SET status = ?, result = COALESCE(?, result), updated_at = datetime('now') WHERE id = ?" + scope
  ).run(status, result ?? null, taskId, ...(projectId ? [projectId] : []));
  return info.changes > 0;
}

/**
 * Managers only delegate downward in their chain or within their own team;
 * the principal can delegate to anyone.
 */
function canDelegate(fromId: string, toId: string): boolean {
  if (getRole(fromId) === 'principal') return true;
  if (isSuperiorOf(fromId, toId)) return true;
  const config = getConfig();
  const fromTeam = config.agents[fromId]?.team;
  return !!fromTeam && config.agents[toId]?.team === fromTeam;
}

async function delegateToAgent(
  agentId: string,
  prompt: string,
  taskId: string | undefined,
  createdBy: string,
): Promise<{ agentId: string; taskId?: string; response?: string; error?: string }> {
  const target = getAgent(agentId);
  if (!target) {
    return { agentId, taskId, error: `Agente "${agentId}" nao encontrado.` };
  }
  if (!canDelegate(createdBy, agentId)) {
    return { agentId, taskId, error: `Voce so pode delegar para subordinados ou colegas da sua equipe.` };
  }

  const config = getConfig();
  const projectId = getProjectContext()?.projectId ?? 'legacy';

  // Toda delegacao vira uma task no board (rastreio automatico, sem depender
  // do modelo lembrar de chamar createTask)
  let boardTaskId = taskId;
  if (!boardTaskId) {
    boardTaskId = shortId();
    const title = prompt.split('\n')[0].trim().slice(0, 60);
    const team = config.agents[agentId]?.team ?? config.agents[createdBy]?.team ?? null;
    getDb().prepare(
      'INSERT INTO tasks (id, parent_id, title, description, assignee, status, created_by, team, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(boardTaskId, null, title, prompt.slice(0, 300), agentId, 'in_progress', createdBy, team, projectId);
  } else {
    setTaskStatus(boardTaskId, 'in_progress', undefined, projectId);
  }

  const delegation: ActiveDelegation = {
    id: shortId(),
    from: createdBy,
    to: agentId,
    taskId: boardTaskId,
    startedAt: Date.now(),
    controller: new AbortController(),
    projectId,
  };
  activeDelegations.set(delegation.id, delegation);
  emitBus('delegation', { id: delegation.id, from: createdBy, to: agentId, taskId: boardTaskId, agentName: target.name, status: 'start' });

  renderer.renderSystemMessage(`→ delegando para ${target.name} [${boardTaskId}]...`);

  const timeoutSec = config.delegation.timeoutSec;
  const timer = setTimeout(() => {
    delegation.timedOut = true;
    delegation.controller.abort();
  }, timeoutSec * 1000);

  try {
    const response = await target.processMessage(prompt, {
      abortSignal: delegation.controller.signal,
      onToolCall: (toolName) => {
        renderer.updateActivityLabel(`↳ ${target.name} ⚙ ${toolName}...`);
        emitBus('delegation', { id: delegation.id, to: agentId, agentName: target.name, toolName, status: 'progress' });
      },
      context:
        `Voce recebeu uma tarefa delegada pelo seu superior "${createdBy}". ` +
        'Execute a tarefa da melhor forma possivel usando suas ferramentas e responda com o resultado objetivo, no formato pedido. ' +
        'Seu manual operacional de perfil ja esta ativo no system prompt: aplique o fluxo, os principios, os anti-padroes e o gate final sem esperar nova instrucao. ' +
        'Nao entregue apenas o minimo mecanico: dentro do escopo, cuide de completude, consistencia, estados relevantes, qualidade tecnica e acabamento. ' +
        'Melhorias adicionais devem ser diretamente relacionadas, seguras e verificaveis; nao invente funcionalidades nem mude o objetivo do produto. ' +
        'Nao faca perguntas de volta — se algo for ambiguo, tome a decisao mais razoavel e registre a suposicao. ' +
        'OBRIGATORIO antes de responder: VERIFIQUE seu trabalho com as ferramentas (releia cada arquivo que criou do inicio ao fim, liste os diretorios) e conserte o que estiver incompleto. ' +
        'Arquivos grandes: escreva em partes (writeFile + appendFile). ' +
        'So reporte como concluido o que voce verificou; se algo ficou faltando, diga exatamente o que falta.',
    });

    setTaskStatus(boardTaskId, 'done', response, projectId);
    renderer.renderSystemMessage(`✓ ${target.name} concluiu [${boardTaskId}].`);
    emitBus('delegation', { id: delegation.id, to: agentId, agentName: target.name, taskId: boardTaskId, status: 'done' });
    return { agentId, taskId: boardTaskId, response };
  } catch (error) {
    if (delegation.controller.signal.aborted && delegation.cancelled) {
      setTaskStatus(boardTaskId, 'cancelled', 'Cancelada pelo usuario via painel', projectId);
      renderer.renderSystemMessage(`⊘ Delegacao para ${target.name} cancelada pelo usuario [${boardTaskId}].`);
      emitBus('delegation', { id: delegation.id, to: agentId, agentName: target.name, taskId: boardTaskId, status: 'cancelled' });
      return { agentId, taskId: boardTaskId, error: 'Delegacao CANCELADA pelo usuario. Nao repita sem confirmar com ele.' };
    }

    if (delegation.controller.signal.aborted && delegation.timedOut) {
      setTaskStatus(boardTaskId, 'failed', `Timeout apos ${timeoutSec}s`, projectId);
      renderer.renderSystemMessage(`✗ ${target.name} excedeu ${timeoutSec}s e foi interrompido [${boardTaskId}].`);
      emitBus('delegation', { id: delegation.id, to: agentId, agentName: target.name, taskId: boardTaskId, status: 'failed' });
      return {
        agentId,
        taskId: boardTaskId,
        error: `Timeout: o agente nao terminou em ${timeoutSec}s. Divida a tarefa em partes menores ou aumente delegation.timeoutSec no config.`,
      };
    }

    const msg = error instanceof Error ? error.message : 'erro desconhecido';
    setTaskStatus(boardTaskId, 'failed', msg, projectId);
    renderer.renderSystemMessage(`✗ ${target.name} falhou [${boardTaskId}]: ${msg}`);
    emitBus('delegation', { id: delegation.id, to: agentId, agentName: target.name, taskId: boardTaskId, status: 'failed' });
    return { agentId, taskId: boardTaskId, error: msg };
  } finally {
    clearTimeout(timer);
    activeDelegations.delete(delegation.id);
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export function createTaskTools(agentId: string): ToolSet {
  const createTask = tool({
    description: 'Criar uma tarefa no board da empresa (use ao decompor um objetivo em partes)',
    inputSchema: z.object({
      title: z.string().describe('Titulo curto da tarefa'),
      description: z.string().optional().describe('Detalhes do que precisa ser feito'),
      assignee: z.string().optional().describe('ID do agente responsavel (opcional)'),
      parentId: z.string().optional().describe('ID da tarefa-mae, se for subtarefa'),
      team: z.string().optional().describe('Equipe dona da tarefa (padrao: sua equipe, ou a do responsavel)'),
    }),
    execute: async ({ title, description, assignee, parentId, team }) => {
      const db = getDb();
      const id = shortId();
      const config = getConfig();
      const resolvedTeam =
        team ??
        config.agents[agentId]?.team ??
        (assignee ? config.agents[assignee]?.team ?? null : null);
      const projectId = getProjectContext()?.projectId ?? 'legacy';
      db.prepare(
        'INSERT INTO tasks (id, parent_id, title, description, assignee, status, created_by, team, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, parentId ?? null, title, description ?? null, assignee ?? null, 'pending', agentId, resolvedTeam, projectId);
      return { success: true, taskId: id, team: resolvedTeam, projectId };
    },
  });

  const listTasks = tool({
    description: 'Listar tarefas do board da empresa',
    inputSchema: z.object({
      status: z.enum(['pending', 'in_progress', 'done', 'failed', 'cancelled']).optional().describe('Filtrar por status'),
      team: z.string().optional().describe('Filtrar por equipe'),
    }),
    execute: async ({ status, team }) => {
      const tasks = listTaskRows(status, team, getProjectContext()?.projectId ?? 'legacy').map(t => ({
        id: t.id,
        title: t.title,
        assignee: t.assignee,
        team: t.team,
        status: t.status,
        result: t.result ? (t.result.length > 300 ? t.result.slice(0, 300) + '...' : t.result) : null,
      }));
      return { tasks };
    },
  });

  const completeTask = tool({
    description: 'Atualizar o status de uma tarefa (concluir, falhar, cancelar, reabrir). Use "cancelled" para cancelamento intencional — "failed" e so para falha real de execucao.',
    inputSchema: z.object({
      taskId: z.string().describe('ID da tarefa'),
      status: z.enum(['pending', 'in_progress', 'done', 'failed', 'cancelled']).describe('Novo status'),
      result: z.string().optional().describe('Resultado ou motivo (opcional)'),
    }),
    execute: async ({ taskId, status, result }) => {
      const projectId = getProjectContext()?.projectId ?? 'legacy';
      const ok = setTaskStatus(taskId, status, result, projectId);
      if (!ok) return { error: `Tarefa "${taskId}" nao encontrada neste projeto.` };
      return { success: true, taskId, status };
    },
  });

  const delegateTask = tool({
    description:
      'Delegar um trabalho para outro agente e receber a resposta dele. O prompt deve ser completo e auto-suficiente (contexto + o que fazer + formato esperado).',
    inputSchema: z.object({
      agentId: z.string().describe('ID do agente que vai executar'),
      prompt: z.string().describe('Instrucao completa da tarefa'),
      taskId: z.string().optional().describe('ID da tarefa do board associada (recomendado)'),
    }),
    execute: async ({ agentId: targetId, prompt, taskId }) => {
      return await delegateToAgent(targetId, prompt, taskId, agentId);
    },
  });

  const deleteTask = tool({
    description: 'Deletar uma tarefa do board permanentemente (use quando o usuario pedir para limpar/apagar tarefas especificas)',
    inputSchema: z.object({
      taskId: z.string().describe('ID da tarefa a deletar'),
    }),
    execute: async ({ taskId }) => {
      if (listActiveDelegations().some(item => item.taskId === taskId)) {
        return { error: `Tarefa "${taskId}" esta em execucao e nao pode ser deletada. Cancele a delegacao primeiro.` };
      }
      const projectId = getProjectContext()?.projectId ?? 'legacy';
      const existing = getDb().prepare(
        "SELECT title FROM tasks WHERE id = ? AND COALESCE(project_id, 'legacy') = ?",
      ).get(taskId, projectId) as { title: string } | undefined;
      if (!existing) return { error: `Tarefa "${taskId}" nao encontrada.` };
      const confirmation = await askConfirmation(
        `Deletar permanentemente a tarefa "${existing.title}" (${taskId})?`,
        { allowAlways: false },
      );
      if (confirmation.answer !== 'yes') {
        return { error: confirmation.timedOut
          ? 'Confirmacao expirou. A tarefa nao foi deletada.'
          : 'Exclusao negada pelo usuario. A tarefa nao foi deletada.' };
      }
      const info = getDb().prepare("DELETE FROM tasks WHERE id = ? AND COALESCE(project_id, 'legacy') = ?").run(taskId, projectId);
      if (info.changes === 0) return { error: `Tarefa "${taskId}" nao encontrada.` };
      emitBus('board_changed', { taskId, action: 'deleted' });
      return { success: true, taskId };
    },
  });

  const clearBoard = tool({
    description: 'Apagar VARIAS tarefas do board por filtro. Exige confirmacao humana e preserva tarefas com delegacao em execucao.',
    inputSchema: z.object({
      status: z.enum(['pending', 'in_progress', 'done', 'failed', 'cancelled']).optional().describe('So apagar tarefas com esse status'),
      team: z.string().optional().describe('So apagar tarefas dessa equipe'),
    }),
    execute: async ({ status, team }) => {
      const projectId = getProjectContext()?.projectId ?? 'legacy';
      const initialRows = listTaskRows(status, team, projectId);
      const initial = partitionTasksForDeletion(
        initialRows,
        listActiveDelegations().map(item => item.taskId),
      );

      if (initial.deletableIds.length === 0) {
        return { success: true, deleted: 0, skippedActive: initial.skippedActive };
      }

      const filters = [
        status ? `status=${status}` : null,
        team ? `equipe=${team}` : null,
      ].filter(Boolean).join(', ');
      const scope = filters || 'todo o board';
      const confirmation = await askConfirmation(
        `Apagar permanentemente ${initial.deletableIds.length} tarefa(s) de ${scope}?` +
          (initial.skippedActive ? ` ${initial.skippedActive} tarefa(s) ativa(s) serao preservadas.` : ''),
        { allowAlways: false },
      );
      if (confirmation.answer === 'no') {
        return {
          error: confirmation.timedOut
            ? 'Confirmacao expirou. Nenhuma tarefa foi apagada.'
            : 'Limpeza do board negada pelo usuario. Nenhuma tarefa foi apagada.',
        };
      }

      // Recalcula depois da confirmacao: uma tarefa pode ter iniciado enquanto
      // a decisao humana estava pendente.
      const rows = listTaskRows(status, team, projectId);
      const { deletableIds, skippedActive } = partitionTasksForDeletion(
        rows,
        listActiveDelegations().map(item => item.taskId),
      );

      let deleted = 0;
      if (deletableIds.length > 0) {
        const placeholders = deletableIds.map(() => '?').join(', ');
        const info = getDb().prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...deletableIds);
        deleted = info.changes;
      }
      emitBus('board_changed', { action: 'cleared', count: deleted });
      return { success: true, deleted, skippedActive };
    },
  });
  const delegateTasks = tool({
    description:
      'Delegar VARIOS trabalhos em paralelo (para tarefas independentes). Cada item vai para um agente com seu proprio prompt completo.',
    inputSchema: z.object({
      delegations: z
        .array(
          z.object({
            agentId: z.string().describe('ID do agente executor'),
            prompt: z.string().describe('Instrucao completa da tarefa'),
            taskId: z.string().optional().describe('ID da tarefa do board associada'),
          })
        )
        .min(1)
        .max(10)
        .describe('Lista de delegacoes a executar em paralelo'),
    }),
    execute: async ({ delegations }) => {
      const results = await runWithConcurrency(
        delegations,
        getConfig().delegation.concurrency,
        d => delegateToAgent(d.agentId, d.prompt, d.taskId, agentId),
      );
      return { results };
    },
  });

  return { createTask, listTasks, completeTask, deleteTask, clearBoard, delegateTask, delegateTasks };
}
