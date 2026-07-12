-- Fixture: banco no schema PRÉ-projeto (antes da plataforma web por projetos).
-- Representa dados legados que a migração da Fase 1 deve preservar e atribuir ao
-- projeto "Legacy". Espelha src/db/schema.ts no estado anterior a esta feature.
--
-- Uso (teste): abrir um better-sqlite3 vazio, `db.exec(<este arquivo>)`, então
-- rodar runMigrations() e verificar backfill + ausência de perda de dados.

CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'direct',
  title       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  agent_id        TEXT,
  tool_calls      TEXT,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE schedules (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  cron_expr   TEXT NOT NULL,
  task_prompt TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT,
  title       TEXT NOT NULL,
  description TEXT,
  assignee    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  result      TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  team        TEXT
);

CREATE TABLE usage_events (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT,
  model         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'chat',
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL,
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dados legados representativos (datas fixas para asserção determinística).
INSERT INTO conversations (id, agent_id, type, title, created_at, updated_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'aria', 'direct', 'Conversa antiga', '2026-01-01 10:00:00', '2026-01-01 10:05:00'),
  ('22222222-2222-4222-8222-222222222222', 'aria', 'group',  'Grupo antigo',    '2026-01-02 10:00:00', '2026-01-02 10:30:00');

INSERT INTO messages (id, conversation_id, role, content, agent_id, input_tokens, output_tokens, created_at) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'user',      'ola aria',        NULL,   3, 0, '2026-01-01 10:00:10'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'assistant', 'ola, tudo bem?',  'aria', 0, 5, '2026-01-01 10:00:20');

INSERT INTO schedules (id, agent_id, cron_expr, task_prompt, enabled, created_at) VALUES
  ('sched001', 'aria', '0 9 * * *', 'bom dia', 1, '2026-01-01 09:00:00');

INSERT INTO tasks (id, title, status, created_by, team, created_at, updated_at) VALUES
  ('task0001', 'Tarefa legada', 'pending', 'aria', 'marketing', '2026-01-01 11:00:00', '2026-01-01 11:00:00');

INSERT INTO usage_events (id, agent_id, model, kind, input_tokens, output_tokens, created_at) VALUES
  ('usage001', 'aria', 'deepseek-v4-flash', 'chat', 100, 50, '2026-01-01 10:00:20');
