import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/schema.js';
import { getAnalytics, type AnalyticsAgentInfo } from '../src/web/analytics.js';
import { computeCallCost } from '../src/agents/usage.js';

const AGENTS: AnalyticsAgentInfo[] = [
  { id: 'aria', name: 'Aria', team: null },
  { id: 'coder', name: 'Coder', team: 'dev' },
  { id: 'tester', name: 'Tester', team: 'dev' },
];

/** Timestamp UTC no formato do SQLite, deslocado N horas para tras. */
function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
}

function seedDb(): Database.Database {
  const db = new Database(':memory:');
  runMigrations(db);

  const insertMsg = db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, agent_id, input_tokens, output_tokens, created_at)
     VALUES (?, 'conv1', 'assistant', 'x', ?, ?, ?, ?)`
  );
  db.prepare(`INSERT INTO conversations (id, agent_id) VALUES ('conv1', 'aria')`).run();

  // Janela atual (últimas 24h)
  insertMsg.run('m1', 'aria', 100, 50, hoursAgo(1));
  insertMsg.run('m2', 'coder', 200, 100, hoursAgo(2));
  // Janela anterior (24h–48h atrás)
  insertMsg.run('m3', 'aria', 40, 10, hoursAgo(30));
  // Fora das duas janelas de 24h (mas dentro de 7d)
  insertMsg.run('m4', 'tester', 1000, 500, hoursAgo(60));

  const insertUsage = db.prepare(
    `INSERT INTO usage_events (id, agent_id, model, kind, input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, created_at)
     VALUES (?, ?, 'deepseek-v4-flash', 'chat', ?, ?, ?, ?, ?, ?)`
  );
  insertUsage.run('u1', 'aria', 100, 50, 80, 0.001, 1200, hoursAgo(1));
  insertUsage.run('u2', 'coder', 200, 100, 0, 0.002, 3000, hoursAgo(2));
  insertUsage.run('u3', 'aria', 40, 10, 0, 0.0005, 900, hoursAgo(30));

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, title, assignee, status, team, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertTask.run('t1', 'ok recente', 'coder', 'done', 'dev', hoursAgo(3), hoursAgo(2));
  insertTask.run('t2', 'falhou recente', 'coder', 'failed', 'dev', hoursAgo(3), hoursAgo(1));
  insertTask.run('t3', 'rodando', 'tester', 'in_progress', 'dev', hoursAgo(1), hoursAgo(1));
  insertTask.run('t4', 'pendente antiga', 'aria', 'pending', null, hoursAgo(400), hoursAgo(400));
  insertTask.run('t5', 'ok janela anterior', 'aria', 'done', null, hoursAgo(40), hoursAgo(30));

  return db;
}

describe('getAnalytics', () => {
  it('agrega tokens, custo e comparacao com o periodo anterior (24h)', () => {
    const db = seedDb();
    const r = getAnalytics(db, AGENTS, { range: '24h' });

    assert.equal(r.kpis.tokens.current, 450); // m1 + m2
    assert.equal(r.kpis.tokens.previous, 50); // m3
    assert.equal(r.kpis.inputTokens, 300);
    assert.equal(r.kpis.outputTokens, 150);

    assert.ok(Math.abs(r.kpis.cost.current - 0.003) < 1e-9); // u1 + u2
    assert.ok(Math.abs(r.kpis.cost.previous - 0.0005) < 1e-9); // u3
    assert.equal(r.kpis.cost.known, true);

    // cache: 80 de 300 tokens de input na janela atual
    assert.ok(Math.abs(r.kpis.cacheRate.current - 80 / 300) < 1e-9);

    assert.equal(r.kpis.activeAgents.current, 2); // aria + coder
    assert.equal(r.kpis.activeAgents.previous, 1); // aria
    db.close();
  });

  it('calcula tarefas, taxa de sucesso e donut com abertas antigas', () => {
    const db = seedDb();
    const r = getAnalytics(db, AGENTS, { range: '24h' });

    assert.equal(r.kpis.tasksDone.current, 1); // t1
    assert.equal(r.kpis.tasksFailed.current, 1); // t2
    assert.equal(r.kpis.tasksDone.previous, 1); // t5 (updated ha 30h)
    assert.equal(r.kpis.successRate.current, 0.5);
    assert.equal(r.kpis.tasksInProgress, 1);
    assert.equal(r.kpis.tasksPending, 1);

    // donut inclui a pendente antiga (t4) mesmo fora da janela
    assert.equal(r.taskStatus.pending, 1);
    assert.equal(r.taskStatus.in_progress, 1);
    assert.equal(r.taskStatus.done, 1);
    assert.equal(r.taskStatus.failed, 1);
    db.close();
  });

  it('gera serie temporal continua com buckets zerados', () => {
    const db = seedDb();
    const r24 = getAnalytics(db, AGENTS, { range: '24h' });
    assert.equal(r24.bucketUnit, 'hour');
    assert.equal(r24.series.length, 24);
    const total24 = r24.series.reduce((s, p) => s + p.input + p.output, 0);
    assert.equal(total24, 450);

    const r7 = getAnalytics(db, AGENTS, { range: '7d' });
    assert.equal(r7.bucketUnit, 'day');
    assert.equal(r7.series.length, 7);
    const total7 = r7.series.reduce((s, p) => s + p.input + p.output, 0);
    assert.equal(total7, 2000); // m1..m4
    const totalCost = r7.series.reduce((s, p) => s + p.cost, 0);
    assert.ok(Math.abs(totalCost - 0.0035) < 1e-9);
    db.close();
  });

  it('filtra por agente e por equipe', () => {
    const db = seedDb();

    const byAgent = getAnalytics(db, AGENTS, { range: '24h', agent: 'coder' });
    assert.equal(byAgent.kpis.tokens.current, 300); // m2
    assert.equal(byAgent.kpis.tasksDone.current, 1);
    assert.equal(byAgent.kpis.tasksFailed.current, 1);

    const byTeam = getAnalytics(db, AGENTS, { range: '7d', team: 'dev' });
    assert.equal(byTeam.kpis.tokens.current, 1800); // m2 + m4
    assert.equal(byTeam.taskStatus.pending, undefined); // t4 nao tem team

    const emptyTeam = getAnalytics(db, AGENTS, { range: '7d', team: 'inexistente' });
    assert.equal(emptyTeam.kpis.tokens.current, 0);
    assert.equal(emptyTeam.agentLoad.length, 0);
    db.close();
  });

  it('monta carga por agente combinando mensagens e tarefas', () => {
    const db = seedDb();
    const r = getAnalytics(db, AGENTS, { range: '7d' });

    const tester = r.agentLoad.find(a => a.agentId === 'tester');
    assert.ok(tester);
    assert.equal(tester.inputTokens + tester.outputTokens, 1500);
    assert.equal(tester.tasksActive, 1);
    assert.equal(tester.name, 'Tester');

    // ordenado por tokens: tester (1500) vem antes de coder (300)
    assert.equal(r.agentLoad[0].agentId, 'tester');

    const coder = r.agentLoad.find(a => a.agentId === 'coder');
    assert.ok(coder);
    assert.equal(coder.tasksDone, 1);
    assert.equal(coder.tasksFailed, 1);
    db.close();
  });

  it('marca custo como desconhecido quando ha evento sem preco', () => {
    const db = seedDb();
    db.prepare(
      `INSERT INTO usage_events (id, agent_id, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES ('u9', 'aria', 'modelo-sem-preco', 10, 10, NULL, ?)`
    ).run(hoursAgo(1));
    const r = getAnalytics(db, AGENTS, { range: '24h' });
    assert.equal(r.kpis.cost.known, false);
    db.close();
  });
});

describe('computeCallCost', () => {
  it('aplica preco de cache hit/miss por modelo', () => {
    // 1000 input (400 cached), 500 output no deepseek-v4-flash
    const cost = computeCallCost(1000, 500, 400, 'deepseek-v4-flash');
    const expected = (600 * 0.14 + 400 * 0.0028 + 500 * 0.28) / 1_000_000;
    assert.ok(cost != null && Math.abs(cost - expected) < 1e-12);
  });

  it('retorna null para modelo sem preco tabelado', () => {
    assert.equal(computeCallCost(100, 100, 0, 'modelo-desconhecido'), null);
  });
});
