import { tool } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { getProjectContext } from '../projects/context.js';
import { askConfirmation } from '../chat/confirm.js';

export function createSchedulingTools(agentId: string) {
  const createScheduleTool = tool({
    description: 'Agendar uma tarefa recorrente. Use expressao cron (ex: "0 8 * * *" = todo dia as 8h, "*/30 * * * *" = a cada 30 min, "0 9 * * 1" = toda segunda as 9h)',
    inputSchema: z.object({
      cronExpression: z.string().describe('Expressao cron (ex: "0 8 * * *")'),
      taskDescription: z.string().describe('O que fazer quando a tarefa executar'),
    }),
    execute: async ({ cronExpression, taskDescription }) => {
      try {
        const confirmation = await askConfirmation(
          `Criar uma automacao recorrente com cron "${cronExpression}" para: ${taskDescription.slice(0, 180)}?`,
          { allowAlways: false },
        );
        if (confirmation.answer !== 'yes') {
          return { error: confirmation.timedOut
            ? 'Confirmacao expirou. O agendamento nao foi criado.'
            : 'Agendamento negado pelo usuario.' };
        }
        const db = getDb();
        const id = randomUUID();
        const projectId = getProjectContext()?.projectId ?? 'legacy';
        db.prepare(
          'INSERT INTO schedules (id, agent_id, cron_expr, task_prompt, enabled, project_id) VALUES (?, ?, ?, ?, 1, ?)'
        ).run(id, agentId, cronExpression, taskDescription, projectId);

        // The scheduler engine will pick this up via config change or manual refresh
        return {
          success: true,
          id,
          message: `Tarefa agendada com sucesso! ID: ${id}`,
          cron: cronExpression,
          task: taskDescription,
        };
      } catch (error) {
        return { error: `Erro ao agendar tarefa: ${error instanceof Error ? error.message : 'desconhecido'}` };
      }
    },
  });

  const listSchedulesTool = tool({
    description: 'Listar todas as tarefas agendadas',
    inputSchema: z.object({}),
    execute: async () => {
      const db = getDb();
      const projectId = getProjectContext()?.projectId ?? 'legacy';
      const schedules = db.prepare(
        "SELECT id, agent_id, cron_expr, task_prompt, enabled, last_run, created_at FROM schedules WHERE COALESCE(project_id, 'legacy') = ? ORDER BY created_at DESC"
      ).all(projectId);
      return { schedules };
    },
  });

  const deleteScheduleTool = tool({
    description: 'Remover uma tarefa agendada pelo ID',
    inputSchema: z.object({
      scheduleId: z.string().describe('ID da tarefa a remover'),
    }),
    execute: async ({ scheduleId }) => {
      const db = getDb();
      const projectId = getProjectContext()?.projectId ?? 'legacy';
      const existing = db.prepare(
        "SELECT task_prompt FROM schedules WHERE id = ? AND COALESCE(project_id, 'legacy') = ?",
      ).get(scheduleId, projectId) as { task_prompt: string } | undefined;
      if (!existing) return { error: `Tarefa "${scheduleId}" nao encontrada.` };
      const confirmation = await askConfirmation(
        `Remover permanentemente o agendamento "${scheduleId}" (${existing.task_prompt.slice(0, 160)})?`,
        { allowAlways: false },
      );
      if (confirmation.answer !== 'yes') {
        return { error: confirmation.timedOut
          ? 'Confirmacao expirou. O agendamento nao foi removido.'
          : 'Remocao negada pelo usuario.' };
      }
      const result = db.prepare("DELETE FROM schedules WHERE id = ? AND COALESCE(project_id, 'legacy') = ?").run(scheduleId, projectId);
      if (result.changes === 0) {
        return { error: `Tarefa "${scheduleId}" nao encontrada.` };
      }
      return { success: true, message: `Tarefa ${scheduleId} removida.` };
    },
  });

  return { createSchedule: createScheduleTool, listSchedules: listSchedulesTool, deleteSchedule: deleteScheduleTool };
}
