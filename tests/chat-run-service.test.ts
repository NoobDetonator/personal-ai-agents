import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ChatRunService com executor FAKE (sem LLM). Valida runs/run_events,
// sequência, retomada, cancelamento, timeout e propagação de status.

let connection: typeof import('../src/db/connection.js');
let svc: typeof import('../src/projects/service.js');
let convSvc: typeof import('../src/projects/conversation-service.js');
let runHelpers: typeof import('../src/db/run-helpers.js');
let runService: typeof import('../src/chat/run-service.js');
let confirm: typeof import('../src/chat/confirm.js');
let projectContext: typeof import('../src/projects/context.js');

let projectId: string;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paa-run-'));
  process.chdir(root);
  connection = await import('../src/db/connection.js');
  svc = await import('../src/projects/service.js');
  convSvc = await import('../src/projects/conversation-service.js');
  runHelpers = await import('../src/db/run-helpers.js');
  runService = await import('../src/chat/run-service.js');
  confirm = await import('../src/chat/confirm.js');
  projectContext = await import('../src/projects/context.js');
  connection.initDatabase();
  projectId = svc.createProject({ name: 'Chat' }).id;
});

after(() => connection.closeDatabase());

function newConversation(): string {
  return convSvc.createProjectConversation(projectId, 'aria', { title: 'teste' });
}

test('run bem-sucedido persiste mensagens, eventos ordenados e status done', async () => {
  const conversationId = newConversation();
  const { runId, done } = runService.startChatRun({
    conversationId,
    text: 'ola',
    executor: async ({ handlers }) => {
      handlers.onTextDelta('oi ');
      handlers.onToolCall('readFile');
      handlers.onToolResult?.('readFile', { ok: true });
      handlers.onSkillActivated?.('system-prompter');
      handlers.onTextDelta('pronto');
      return { text: 'oi pronto', inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, toolCallCount: 1, finishReason: 'stop' };
    },
  });

  const status = await done;
  assert.equal(status, 'done');

  const run = runHelpers.getRun(runId)!;
  assert.equal(run.status, 'done');
  assert.equal(run.input_tokens, 10);
  assert.equal(run.output_tokens, 5);

  const events = runHelpers.listRunEvents(runId);
  // sequência monotônica a partir de 1
  assert.deepEqual(events.map(e => e.sequence), events.map((_, i) => i + 1));
  const types = events.map(e => e.type);
  assert.equal(types[0], 'status'); // running
  assert.ok(types.includes('text_delta'));
  assert.ok(types.includes('tool_start'));
  assert.ok(types.includes('tool_result'));
  assert.ok(types.includes('skill_activated'));
  const toolResult = events.find(event => event.type === 'tool_result');
  assert.ok(toolResult?.payload_json);
  const toolPayload = JSON.parse(toolResult.payload_json);
  assert.equal(toolPayload.effect, 'read');
  assert.equal(toolPayload.success, true);
  assert.equal(types[types.length - 1], 'status'); // done

  // mensagens do usuário e do assistente, ambas vinculadas ao run
  const msgs = connection.getDb().prepare(
    'SELECT role, content, run_id FROM messages WHERE conversation_id = ? ORDER BY sequence ASC',
  ).all(conversationId) as Array<{ role: string; content: string; run_id: string }>;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].content, 'oi pronto');
  assert.equal(msgs[1].run_id, runId);
});

test('run aplica modelo do projeto e permite sobrescrita por conversa', async () => {
  svc.updateProjectSettings(projectId, {
    default_model: 'deepseek-v4-pro',
    default_provider: 'deepseek',
  });
  const conversationId = newConversation();
  const observed: Array<{ model?: string; provider?: string }> = [];

  const inherited = runService.startChatRun({
    conversationId,
    text: 'modelo do projeto',
    executor: async () => {
      const context = projectContext.requireProjectContext();
      observed.push({ model: context.model, provider: context.provider });
      return { text: 'ok', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, toolCallCount: 0, finishReason: 'stop' };
    },
  });
  assert.equal(await inherited.done, 'done');

  convSvc.patchConversation(conversationId, {
    modelOverride: 'glm-5.2',
    providerOverride: 'zai',
  });
  const overridden = runService.startChatRun({
    conversationId,
    text: 'modelo da conversa',
    executor: async () => {
      const context = projectContext.requireProjectContext();
      observed.push({ model: context.model, provider: context.provider });
      return { text: 'ok', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, toolCallCount: 0, finishReason: 'stop' };
    },
  });
  assert.equal(await overridden.done, 'done');
  assert.deepEqual(observed, [
    { model: 'deepseek-v4-pro', provider: 'deepseek' },
    { model: 'glm-5.2', provider: 'zai' },
  ]);
});

test('retomada: listRunEvents(after) devolve só a cauda após um sequence', async () => {
  const conversationId = newConversation();
  const { runId, done } = runService.startChatRun({
    conversationId,
    text: 'oi',
    executor: async ({ handlers }) => {
      handlers.onTextDelta('a');
      handlers.onTextDelta('b');
      handlers.onTextDelta('c');
      return { text: 'abc', inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, toolCallCount: 0, finishReason: 'stop' };
    },
  });
  await done;

  const all = runHelpers.listRunEvents(runId);
  const mid = all[Math.floor(all.length / 2)].sequence;
  const tail = runHelpers.listRunEvents(runId, mid);
  assert.ok(tail.length > 0);
  assert.ok(tail.every(e => e.sequence > mid));
  assert.equal(tail.length, all.length - all.filter(e => e.sequence <= mid).length);
});

test('cancelamento persiste marcador terminal para nao retomar a tarefa depois', async () => {
  const conversationId = newConversation();
  const { runId, done } = runService.startChatRun({
    conversationId,
    text: 'trabalho longo',
    executor: ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal.addEventListener('abort', () => reject(new Error('Chamada abortada (timeout ou cancelamento).')));
      }),
  });

  assert.equal(runService.cancelRun(runId), true);
  const status = await done;
  assert.equal(status, 'cancelled');
  assert.equal(runHelpers.getRun(runId)!.status, 'cancelled');

  const assistantMsg = connection.getDb().prepare(
    "SELECT content, status FROM messages WHERE conversation_id = ? AND role = 'assistant'",
  ).get(conversationId) as { content: string; status: string };
  assert.equal(assistantMsg.status, 'cancelled');
  assert.match(assistantMsg.content, /Nao continue esta tarefa/);
});

test('timeout vira status timed_out visível', async () => {
  const conversationId = newConversation();
  const { runId, done } = runService.startChatRun({
    conversationId,
    text: 'demora',
    timeoutMs: 10,
    executor: ({ abortSignal }) =>
      new Promise((_, reject) => {
        abortSignal.addEventListener('abort', () => reject(new Error('abortado')));
      }),
  });
  const status = await done;
  assert.equal(status, 'timed_out');
  assert.equal(runHelpers.getRun(runId)!.status, 'timed_out');
});

test('turno novo depois de timeout nao recebe a tarefa terminal no historico', async () => {
  const conversationId = newConversation();
  const timedOut = runService.startChatRun({
    conversationId,
    text: 'pesquisa longa que nao deve voltar',
    timeoutMs: 10,
    executor: ({ abortSignal }) => new Promise((_, reject) => {
      abortSignal.addEventListener('abort', () => reject(new Error('abortado')));
    }),
  });
  assert.equal(await timedOut.done, 'timed_out');

  let observed: Array<{ content: unknown }> = [];
  const next = runService.startChatRun({
    conversationId,
    text: 'apenas salve esta memoria',
    executor: async ({ messages }) => {
      observed = messages as Array<{ content: unknown }>;
      return { text: 'salva', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, toolCallCount: 0, finishReason: 'stop' };
    },
  });
  assert.equal(await next.done, 'done');
  assert.deepEqual(observed.map(message => message.content), ['apenas salve esta memoria']);
});

test('erro do turno vira failed e NUNCA é sobrescrito para done', async () => {
  const conversationId = newConversation();
  const { runId, done } = runService.startChatRun({
    conversationId,
    text: 'quebra',
    executor: async () => { throw new Error('boom'); },
  });
  const status = await done;
  assert.equal(status, 'failed');

  const run = runHelpers.getRun(runId)!;
  assert.equal(run.status, 'failed');
  assert.equal(run.error_message, 'boom');

  // Tentar finalizar como done depois deve ser recusado (estado terminal).
  const attempt = runHelpers.finishRun(runId, { status: 'done' });
  assert.equal(attempt, 'failed');
  assert.equal(runHelpers.getRun(runId)!.status, 'failed');

  // setRunStatus também recusa sair de um estado terminal.
  assert.equal(runHelpers.setRunStatus(runId, 'running'), false);
});

test('cancelRun em run inexistente/terminado retorna false', () => {
  assert.equal(runService.cancelRun('nao-existe'), false);
});


test('recusa dois runs simultaneos na mesma conversa', async () => {
  const conversationId = newConversation();
  const first = runService.startChatRun({
    conversationId,
    text: 'primeiro',
    executor: ({ abortSignal }) => new Promise((_, reject) => {
      abortSignal.addEventListener('abort', () => reject(new Error('abortado')));
    }),
  });

  assert.throws(
    () => runService.startChatRun({
      conversationId,
      text: 'segundo',
      executor: async () => ({ text: '', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, toolCallCount: 0, finishReason: 'stop' }),
    }),
    /execucao ativa/,
  );

  assert.equal(runService.cancelRun(first.runId), true);
  assert.equal(await first.done, 'cancelled');
});

test('recuperacao apos reinicio encerra runs orfaos como failed', () => {
  const conversationId = newConversation();
  const runId = runHelpers.createRun({ projectId, conversationId, agentId: 'aria' });
  assert.equal(runHelpers.recoverInterruptedRuns(), 1);
  const run = runHelpers.getRun(runId)!;
  assert.equal(run.status, 'failed');
  assert.equal(run.error_code, 'process_restarted');
  assert.ok(runHelpers.listRunEvents(runId).some(event => event.type === 'error'));
});


test('confirmacao fica vinculada ao projeto, conversa e run', async () => {
  const conversationId = newConversation();
  let observedStatus = '';
  const started = runService.startChatRun({
    conversationId,
    text: 'acao sensivel',
    executor: async () => {
      const answer = confirm.askConfirmation('autorizar teste', { allowAlways: false });
      const pending = confirm.getPendingConfirmations().find(item => item.message === 'autorizar teste');
      assert.ok(pending);
      assert.equal(pending.projectId, projectId);
      assert.equal(pending.conversationId, conversationId);
      assert.ok(pending.runId);
      observedStatus = runHelpers.getRun(pending.runId!)?.status ?? '';
      confirm.resolveConfirmation(pending.id, 'yes');
      assert.equal((await answer).answer, 'yes');
      return { text: 'autorizado', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, toolCallCount: 1, finishReason: 'stop' };
    },
  });
  assert.equal(await started.done, 'done');
  assert.equal(observedStatus, 'waiting_confirmation');
  assert.ok(runHelpers.listRunEvents(started.runId).some(event => event.type === 'confirmation'));
});


test('cancelamento rejeita confirmacoes pendentes do mesmo run', async () => {
  const conversationId = newConversation();
  const started = runService.startChatRun({
    conversationId,
    text: 'acao destrutiva',
    executor: async ({ abortSignal }) => {
      const decision = await confirm.askConfirmation('confirmacao do run cancelado', { allowAlways: false });
      if (abortSignal.aborted) throw new Error('abortado');
      return {
        text: decision.answer,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        toolCallCount: 1,
        finishReason: 'stop',
      };
    },
  });

  const pending = confirm.getPendingConfirmations().filter(item => item.runId === started.runId);
  assert.equal(pending.length, 1);
  assert.equal(runService.cancelRun(started.runId), true);
  assert.equal(await started.done, 'cancelled');
  assert.equal(confirm.getPendingConfirmations().some(item => item.runId === started.runId), false);
});
