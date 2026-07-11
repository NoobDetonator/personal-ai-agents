import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { getConfig } from '../config/loader.js';
import { executeScheduledTask } from './executor.js';

interface ScheduleRow {
  id: string;
  agent_id: string;
  cron_expr: string;
  task_prompt: string;
  enabled: number;
  last_run: string | null;
  created_at: string;
}

const activeTasks = new Map<string, cron.ScheduledTask>();
// Tarefas em execucao — um disparo que chega enquanto o anterior ainda roda e
// pulado, para nao repetir efeitos externos (node-cron nao espera callbacks async)
const runningTasks = new Set<string>();

export function startScheduler(): void {
  const config = getConfig();
  if (!config.scheduler.enabled) return;

  const db = getDb();
  const schedules = db.prepare(
    'SELECT * FROM schedules WHERE enabled = 1'
  ).all() as ScheduleRow[];

  for (const schedule of schedules) {
    registerCronJob(schedule);
  }
}

export function registerCronJob(schedule: ScheduleRow): void {
  const config = getConfig();

  if (activeTasks.has(schedule.id)) {
    activeTasks.get(schedule.id)!.stop();
  }

  if (!cron.validate(schedule.cron_expr)) {
    console.error(`[Scheduler] Expressao cron invalida para tarefa ${schedule.id}: ${schedule.cron_expr}`);
    return;
  }

  const task = cron.schedule(schedule.cron_expr, async () => {
    if (runningTasks.has(schedule.id)) {
      console.warn(`[Scheduler] Tarefa ${schedule.id} ainda em execucao; disparo sobreposto ignorado.`);
      return;
    }
    runningTasks.add(schedule.id);
    try {
      await executeScheduledTask(schedule.id, schedule.agent_id, schedule.task_prompt);

      const db = getDb();
      db.prepare("UPDATE schedules SET last_run = datetime('now') WHERE id = ?").run(schedule.id);
    } finally {
      runningTasks.delete(schedule.id);
    }
  }, {
    timezone: config.scheduler.timezone,
  });

  activeTasks.set(schedule.id, task);
}

export function unregisterCronJob(scheduleId: string): void {
  const task = activeTasks.get(scheduleId);
  if (task) {
    task.stop();
    activeTasks.delete(scheduleId);
  }
}

export function refreshScheduler(): void {
  stopScheduler();
  startScheduler();
}

export function stopScheduler(): void {
  for (const [id, task] of activeTasks) {
    task.stop();
  }
  activeTasks.clear();
}

export function getActiveTaskCount(): number {
  return activeTasks.size;
}
