import type readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { emitBus } from '../web/bus.js';
import { getProjectContext } from '../projects/context.js';
import { appendRunEvent, setRunStatus } from '../db/run-helpers.js';

export type ConfirmAnswer = 'yes' | 'no' | 'always';

export interface PendingConfirmation {
  id: string;
  message: string;
  command?: string;
  allowAlways: boolean;
  createdAt: number;
  projectId?: string;
  conversationId?: string;
  runId?: string;
}

interface PendingInternal extends PendingConfirmation {
  settle: (answer: ConfirmAnswer) => void;
  abortTerminalQuestion?: AbortController;
}

let rl: readline.Interface | null = null;
let atMainPrompt = false;

const pending = new Map<string, PendingInternal>();
const changeListeners: Array<() => void> = [];

// How long a background confirmation waits for an answer (e.g. from the web
// panel) before being denied automatically
const BACKGROUND_WAIT_MS = 120_000;

/** Called by the CLI so tools can ask the user for confirmation mid-turn. */
export function registerReadline(instance: readline.Interface | null): void {
  rl = instance;
}

/**
 * The CLI sets this while waiting at the main prompt. Terminal confirmations
 * are only possible while an agent turn is being processed; pending items can
 * still be answered from other frontends (web panel).
 */
export function setAtMainPrompt(active: boolean): void {
  atMainPrompt = active;
}

/** Frontends (web) can watch the pending queue. */
export function onPendingChange(listener: () => void): void {
  changeListeners.push(listener);
}

function notifyChange(): void {
  for (const l of changeListeners) {
    try { l(); } catch { /* listener errors never break the flow */ }
  }
}

export function getPendingConfirmations(): PendingConfirmation[] {
  return Array.from(pending.values()).map(({ id, message, command, allowAlways, createdAt, projectId, conversationId, runId }) => ({
    id, message, command, allowAlways, createdAt, projectId, conversationId, runId,
  }));
}

/** Resolve a pending confirmation from any frontend. Returns false if unknown/settled. */
export function resolveConfirmation(id: string, answer: ConfirmAnswer): boolean {
  const item = pending.get(id);
  if (!item) return false;
  pending.delete(id);
  item.abortTerminalQuestion?.abort();
  const resolved = answer === 'always' && !item.allowAlways ? 'yes' : answer;
  if (item.runId) {
    setRunStatus(item.runId, 'running');
    appendRunEvent(item.runId, 'confirmation', { id, status: 'resolved', answer: resolved });
  }
  item.settle(resolved);
  notifyChange();
  return true;
}

function parseAnswer(raw: string, allowAlways: boolean): ConfirmAnswer {
  const t = raw.trim().toLowerCase();
  if (allowAlways && (t === 'a' || t.startsWith('sempre'))) return 'always';
  if (t === 's' || t === 'y' || t.startsWith('sim') || t.startsWith('yes')) return 'yes';
  return 'no';
}

export interface ConfirmResult {
  answer: ConfirmAnswer;
  timedOut?: boolean;
}

/**
 * Asks the user to approve an action. Answerable from the terminal (s/n/a)
 * or from any registered frontend (resolveConfirmation). First answer wins.
 */
export async function askConfirmation(
  message: string,
  opts?: { command?: string; allowAlways?: boolean },
): Promise<ConfirmResult> {
  const id = randomUUID().slice(0, 8);
  const projectContext = getProjectContext();

  let settle!: (answer: ConfirmAnswer) => void;
  const answered = new Promise<ConfirmAnswer>(resolve => { settle = resolve; });

  const item: PendingInternal = {
    id,
    message,
    command: opts?.command,
    allowAlways: opts?.allowAlways ?? true,
    createdAt: Date.now(),
    projectId: projectContext?.projectId,
    conversationId: projectContext?.conversationId,
    runId: projectContext?.runId,
    settle,
  };
  pending.set(id, item);
  if (item.runId) {
    setRunStatus(item.runId, 'waiting_confirmation');
    appendRunEvent(item.runId, 'confirmation', { id, status: 'waiting', message, command: item.command });
  }
  emitBus('confirmation_requested', {
    id,
    message,
    command: item.command,
    allowAlways: item.allowAlways,
    projectId: item.projectId,
    conversationId: item.conversationId,
    runId: item.runId,
  });
  notifyChange();

  const canUseTerminal = rl !== null && !atMainPrompt;

  if (canUseTerminal) {
    const controller = new AbortController();
    item.abortTerminalQuestion = controller;
    const choices = item.allowAlways
      ? ' (s = sim / n = nao / a = sim e sempre permitir) '
      : ' (s = sim / n = nao) ';
    const query = chalk.yellow(`\n  ${message}`) + chalk.bold(choices);
    rl!.question(query, { signal: controller.signal }, raw => {
      // Ignore if someone else (web) already settled it
      if (pending.has(id)) {
        resolveConfirmation(id, parseAnswer(raw, item.allowAlways));
      }
    });
    return { answer: await answered };
  }

  // Background context (scheduler/heartbeat): wait for an external answer
  let timedOut = false;
  const timer = setTimeout(() => {
    if (pending.has(id)) {
      pending.delete(id);
      timedOut = true;
      if (item.runId) {
        setRunStatus(item.runId, 'running');
        appendRunEvent(item.runId, 'confirmation', { id, status: 'timed_out', answer: 'no' });
      }
      item.settle('no');
      notifyChange();
      emitBus('system', { text: `⏱ Aprovacao expirou sem resposta (${BACKGROUND_WAIT_MS / 1000}s): ${message}` });
    }
  }, BACKGROUND_WAIT_MS);

  const answer = await answered;
  clearTimeout(timer);
  return { answer, timedOut };
}
