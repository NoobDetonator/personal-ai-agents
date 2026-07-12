/**
 * Preview do painel web com dados de exemplo — para desenvolvimento da dashboard.
 *
 *   npx tsx scripts/dev-dashboard-preview.ts
 *
 * Cria config.json (se nao existir) com uma hierarquia de agentes de exemplo,
 * semeia data/agents.db com mensagens, usage_events e tarefas distribuidos
 * pelos ultimos 35 dias e sobe apenas o servidor web (sem CLI, sem chamadas
 * de IA). Recusa rodar se ja houver um banco com dados reais.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TurnExecutor } from '../src/chat/run-service.js';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DB_PATH = path.join(ROOT, 'data', 'agents.db');

const SAMPLE_AGENTS = {
  aria: { name: 'Aria', description: 'Assistente principal e orquestradora', provider: null, model: null, enabled: true, role: 'principal', parent: null, team: null },
  bruno: { name: 'Bruno', description: 'Gerente da equipe de desenvolvimento', provider: null, model: null, enabled: true, role: 'manager', parent: 'aria', team: 'dev' },
  coder: { name: 'Coder', description: 'Implementa features e correções', provider: null, model: null, enabled: true, role: 'worker', parent: 'bruno', team: 'dev' },
  tester: { name: 'Tester', description: 'Valida e testa as entregas', provider: null, model: null, enabled: true, role: 'worker', parent: 'bruno', team: 'dev', thinking: false },
  sofia: { name: 'Sofia', description: 'Redatora de conteúdo e documentação', provider: null, model: null, enabled: true, role: 'worker', parent: 'aria', team: 'conteudo' },
};

function ensureConfig(): void {
  if (fs.existsSync(CONFIG_PATH)) {
    console.log('[preview] config.json existente mantido.');
    return;
  }
  // Porta propria para nao conflitar com uma instancia real do app
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ agents: SAMPLE_AGENTS, web: { enabled: true, port: 3199 } }, null, 2), 'utf-8');
  console.log('[preview] config.json de exemplo criado.');
}

function sqliteTs(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
}

const H = 3_600_000;

async function main(): Promise<void> {
  if (fs.existsSync(DB_PATH)) {
    console.error('[preview] data/agents.db ja existe — nao vou sobrescrever dados reais.');
    console.error('[preview] Apague o arquivo manualmente se quiser recomeçar o preview.');
    process.exit(1);
  }

  ensureConfig();

  // Imports tardios: loadConfig/initDatabase leem o cwd na carga do modulo
  const { loadConfig } = await import('../src/config/loader.js');
  const { initDatabase } = await import('../src/db/connection.js');
  const { startWebServer, getWebPanelUrl } = await import('../src/web/server.js');
  const { computeCallCost } = await import('../src/agents/usage.js');
  const { createProject } = await import('../src/projects/service.js');
  const { createProjectConversation } = await import('../src/projects/conversation-service.js');
  const { setChatExecutorOverride } = await import('../src/chat/run-service.js');

  loadConfig({ writeBack: false });
  const db = initDatabase();

  const agents = Object.keys(SAMPLE_AGENTS);
  const model = 'deepseek-v4-flash';

  const insertConv = db.prepare(
    `INSERT INTO conversations (id, agent_id, type, title, created_at, updated_at) VALUES (?, ?, 'direct', ?, ?, ?)`
  );
  const insertMsg = db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, agent_id, input_tokens, output_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertUsage = db.prepare(
    `INSERT INTO usage_events (id, agent_id, model, kind, input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, created_at)
     VALUES (?, ?, ?, 'chat', ?, ?, ?, ?, ?, ?)`
  );
  const insertTask = db.prepare(
    `INSERT INTO tasks (id, parent_id, title, description, assignee, status, result, created_by, team, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Conversas: uma por agente
  const convByAgent: Record<string, string> = {};
  for (const id of agents) {
    const convId = randomUUID();
    convByAgent[id] = convId;
    insertConv.run(convId, id, `Conversa com ${SAMPLE_AGENTS[id as keyof typeof SAMPLE_AGENTS].name}`, sqliteTs(35 * 24 * H), sqliteTs(H));
  }

  // 35 dias de atividade com padrao diario variavel (mais atividade em dias uteis)
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };

  for (let day = 34; day >= 0; day--) {
    const weekday = new Date(Date.now() - day * 24 * H).getDay();
    const activity = weekday === 0 || weekday === 6 ? 2 : 5 + Math.floor(rand() * 6);
    for (let i = 0; i < activity; i++) {
      const agent = agents[Math.floor(rand() * agents.length)];
      const hourOfDay = 9 + Math.floor(rand() * 10);
      const msAgo = day * 24 * H + (24 - hourOfDay) * H + Math.floor(rand() * H);
      const input = 800 + Math.floor(rand() * 6000);
      const output = 200 + Math.floor(rand() * 1800);
      const cached = Math.floor(input * rand() * 0.7);
      const ts = sqliteTs(msAgo);

      insertMsg.run(randomUUID(), convByAgent[agent], 'user', `Pedido de exemplo #${day}-${i}`, null, 0, 0, ts);
      insertMsg.run(randomUUID(), convByAgent[agent], 'assistant', `Resposta de exemplo do agente ${agent} (#${day}-${i})`, agent, input, output, ts);
      insertUsage.run(randomUUID(), agent, model, input, output, cached, computeCallCost(input, output, cached, model), 1500 + Math.floor(rand() * 20000), ts);
    }
  }

  // Board com tarefas em todos os status
  const statuses: Array<[string, string | null, string | null, string, number]> = [
    ['Implementar autenticação do webhook', 'coder', 'dev', 'done', 26],
    ['Revisar fluxo de onboarding', 'tester', 'dev', 'done', 20],
    ['Escrever release notes v3', 'sofia', 'conteudo', 'done', 8],
    ['Corrigir timeout nas delegações', 'coder', 'dev', 'done', 4],
    ['Migrar schema de tarefas', 'coder', 'dev', 'failed', 30],
    ['Gerar relatório semanal', 'sofia', 'conteudo', 'failed', 2],
    ['Auditar dependências', 'tester', 'dev', 'in_progress', 1],
    ['Documentar API de analytics', 'sofia', 'conteudo', 'in_progress', 3],
    ['Planejar sprint da dashboard', 'bruno', 'dev', 'pending', 5],
    ['Refatorar módulo de memória', null, 'dev', 'pending', 48],
    ['Postagem sobre agentes', 'sofia', 'conteudo', 'cancelled', 12],
  ];

  for (const [title, assignee, team, status, hoursAgo] of statuses) {
    insertTask.run(
      randomUUID().slice(0, 8), null, title, `Descrição de exemplo: ${title}`,
      assignee || null, status,
      status === 'done' ? 'Concluída com sucesso (dados de exemplo).' : status === 'failed' ? 'Falhou: erro simulado.' : null,
      'aria', team, sqliteTs((hoursAgo + 2) * H), sqliteTs(hoursAgo * H),
    );
  }

  // Projeto de exemplo com uma conversa, para exercitar o chat pela web.
  const demo = createProject({ name: 'Demo Chat', description: 'Projeto de exemplo para testar o chat.' });
  createProjectConversation(demo.id, 'aria', { title: 'Bate-papo com a Aria', createdBy: 'preview' });

  // Executor de eco: transmite a resposta em partes com uma tool call, sem IA.
  const echoExecutor: TurnExecutor = async ({ messages, handlers, abortSignal }) => {
    const last = messages[messages.length - 1];
    const userText = typeof last?.content === 'string' ? last.content : 'olá';
    const reply = `Recebi sua mensagem: "${userText}". Esta é uma resposta de exemplo, transmitida em partes para demonstrar o streaming pela web.`;
    const words = reply.split(' ');
    let output = 0;
    for (let i = 0; i < words.length; i++) {
      if (abortSignal.aborted) throw new Error('Chamada abortada (cancelamento).');
      if (i === 4) handlers.onToolCall('readFile');
      handlers.onTextDelta(words[i] + (i < words.length - 1 ? ' ' : ''));
      output++;
      await new Promise(r => setTimeout(r, 140));
    }
    return { text: reply, inputTokens: 24, outputTokens: output, cachedInputTokens: 0, toolCallCount: 1, finishReason: 'stop' };
  };
  setChatExecutorOverride(echoExecutor);

  startWebServer();
  console.log('[preview] Painel disponível em:');
  console.log(getWebPanelUrl());
}

void main();
