import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'direct',
      title       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
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

    CREATE TABLE IF NOT EXISTS schedules (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      cron_expr   TEXT NOT NULL,
      task_prompt TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      last_run    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_messages (
      id          TEXT PRIMARY KEY,
      from_agent  TEXT NOT NULL,
      to_agent    TEXT NOT NULL,
      content     TEXT NOT NULL,
      read        INTEGER NOT NULL DEFAULT 0,
      response    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_participants (
      conversation_id TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      joined_at       TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (conversation_id, agent_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS command_log (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      command     TEXT NOT NULL,
      cwd         TEXT,
      exit_code   INTEGER,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_command_log_agent ON command_log(agent_id, created_at);

    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      parent_id   TEXT,
      title       TEXT NOT NULL,
      description TEXT,
      assignee    TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      result      TEXT,
      created_by  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_events (
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

    CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_agent ON usage_events(agent_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_schedules_agent ON schedules(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent, read);
  `);

  // Full-text search over all messages (cross-session recall)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  // Backfill the index for messages created before FTS existed
  const counts = db.prepare(
    'SELECT (SELECT COUNT(*) FROM messages) AS m, (SELECT COUNT(*) FROM messages_fts) AS f'
  ).get() as { m: number; f: number };
  if (counts.f < counts.m) {
    db.exec(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`);
  }

  // Migration: team column on tasks (workspaces/teams feature)
  const hasTeam = db.prepare(
    "SELECT COUNT(*) AS c FROM pragma_table_info('tasks') WHERE name = 'team'"
  ).get() as { c: number };
  if (hasTeam.c === 0) {
    db.exec('ALTER TABLE tasks ADD COLUMN team TEXT');
  }

  runProjectMigrations(db);
}

/** Id sentinela do projeto de compatibilidade que recebe todos os dados legados. */
export const LEGACY_PROJECT_ID = 'legacy';
/** Raiz (relativa ao cwd) de confinamento do projeto Legacy — o workspace atual. */
export const LEGACY_PROJECT_ROOT = 'workspace';

/** Adiciona uma coluna apenas se ainda não existir (idempotente). */
function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  ddl: string,
): void {
  const has = db.prepare(
    `SELECT COUNT(*) AS c FROM pragma_table_info('${table}') WHERE name = ?`,
  ).get(column) as { c: number };
  if (has.c === 0) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * Migrações da plataforma web por projetos (ADR 0001–0003). Aditivas e
 * idempotentes: novas tabelas via CREATE IF NOT EXISTS, colunas via ALTER
 * guardado por pragma, e backfill dos dados legados no projeto Legacy.
 */
function runProjectMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      slug           TEXT NOT NULL UNIQUE,
      description    TEXT,
      root_path      TEXT NOT NULL UNIQUE,
      status         TEXT NOT NULL DEFAULT 'active',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      last_opened_at TEXT
    );

    CREATE TABLE IF NOT EXISTS project_settings (
      project_id             TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      default_model          TEXT,
      default_provider       TEXT,
      shell_mode             TEXT,
      delegation_timeout_sec INTEGER,
      max_concurrency        INTEGER,
      memory_enabled         INTEGER NOT NULL DEFAULT 1,
      created_at             TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_agents (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id   TEXT NOT NULL,
      role       TEXT,
      team       TEXT,
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL,
      conversation_id TEXT,
      agent_id        TEXT NOT NULL,
      parent_run_id   TEXT,
      kind            TEXT NOT NULL DEFAULT 'chat',
      status          TEXT NOT NULL DEFAULT 'queued',
      started_at      TEXT,
      finished_at     TEXT,
      error_code      TEXT,
      error_message   TEXT,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      cached_tokens   INTEGER NOT NULL DEFAULT 0,
      cost_usd        REAL,
      duration_ms     INTEGER,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

    CREATE TABLE IF NOT EXISTS run_events (
      id           TEXT PRIMARY KEY,
      run_id       TEXT NOT NULL,
      sequence     INTEGER NOT NULL,
      type         TEXT NOT NULL,
      payload_json TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, sequence);

    CREATE TABLE IF NOT EXISTS audit_events (
      id            TEXT PRIMARY KEY,
      project_id    TEXT,
      actor          TEXT NOT NULL,
      action         TEXT NOT NULL,
      target_type    TEXT NOT NULL,
      target_id      TEXT,
      metadata_json TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action, created_at);

    CREATE TABLE IF NOT EXISTS agent_runtime_events (
      id              TEXT PRIMARY KEY,
      project_id      TEXT,
      conversation_id TEXT,
      run_id          TEXT,
      agent_id        TEXT NOT NULL,
      surface         TEXT NOT NULL,
      type            TEXT NOT NULL,
      payload_json    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runtime_project ON agent_runtime_events(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runtime_agent ON agent_runtime_events(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runtime_type ON agent_runtime_events(type, created_at);
    CREATE TABLE IF NOT EXISTS vault_documents (
      id             TEXT PRIMARY KEY,
      project_id     TEXT NOT NULL,
      agent_id       TEXT NOT NULL,
      kind           TEXT NOT NULL,
      name           TEXT NOT NULL,
      title          TEXT NOT NULL,
      description    TEXT,
      note_type      TEXT NOT NULL DEFAULT 'memory',
      status         TEXT NOT NULL DEFAULT 'active',
      confidence     REAL NOT NULL DEFAULT 1,
      source_type    TEXT NOT NULL DEFAULT 'agent_memory',
      source_ref     TEXT NOT NULL,
      tags_json      TEXT NOT NULL DEFAULT '[]',
      aliases_json   TEXT NOT NULL DEFAULT '[]',
      links_json     TEXT NOT NULL DEFAULT '[]',
      content        TEXT NOT NULL,
      content_hash   TEXT NOT NULL,
      file_mtime_ms  INTEGER NOT NULL,
      reviewed_at    TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, source_ref)
    );

    CREATE INDEX IF NOT EXISTS idx_vault_documents_project ON vault_documents(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_vault_documents_status ON vault_documents(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_vault_documents_agent ON vault_documents(project_id, agent_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS vault_documents_fts USING fts5(
      title, description, content, tags_json,
      content='vault_documents', content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS vault_documents_fts_ai AFTER INSERT ON vault_documents BEGIN
      INSERT INTO vault_documents_fts(rowid, title, description, content, tags_json)
      VALUES (new.rowid, new.title, new.description, new.content, new.tags_json);
    END;

    CREATE TRIGGER IF NOT EXISTS vault_documents_fts_ad AFTER DELETE ON vault_documents BEGIN
      INSERT INTO vault_documents_fts(vault_documents_fts, rowid, title, description, content, tags_json)
      VALUES ('delete', old.rowid, old.title, old.description, old.content, old.tags_json);
    END;

    CREATE TRIGGER IF NOT EXISTS vault_documents_fts_au AFTER UPDATE ON vault_documents BEGIN
      INSERT INTO vault_documents_fts(vault_documents_fts, rowid, title, description, content, tags_json)
      VALUES ('delete', old.rowid, old.title, old.description, old.content, old.tags_json);
      INSERT INTO vault_documents_fts(rowid, title, description, content, tags_json)
      VALUES (new.rowid, new.title, new.description, new.content, new.tags_json);
    END;

    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      layer         TEXT NOT NULL,
      kind          TEXT NOT NULL,
      label         TEXT NOT NULL,
      source_ref    TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      confidence    REAL NOT NULL DEFAULT 1,
      content_hash  TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_project ON knowledge_nodes(project_id, layer);

    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      layer         TEXT NOT NULL,
      source_id     TEXT NOT NULL,
      target_id     TEXT NOT NULL,
      relation      TEXT NOT NULL,
      origin        TEXT NOT NULL DEFAULT 'extracted',
      confidence    REAL NOT NULL DEFAULT 1,
      evidence      TEXT,
      source_hash   TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, layer, source_id, target_id, relation)
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_edges_project ON knowledge_edges(project_id, layer);

    CREATE TABLE IF NOT EXISTS memory_feedback (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      memory_id  TEXT,
      agent_id   TEXT,
      question   TEXT NOT NULL,
      answer     TEXT,
      outcome    TEXT NOT NULL,
      notes      TEXT,
      source_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memory_feedback_project ON memory_feedback(project_id, created_at);
  `);
  const vaultFtsColumns = db.prepare("PRAGMA table_info('vault_documents_fts')")
    .all() as Array<{ name: string }>;
  if (!vaultFtsColumns.some(column => column.name === 'tags_json')) {
    db.exec(`
      DROP TRIGGER IF EXISTS vault_documents_fts_ai;
      DROP TRIGGER IF EXISTS vault_documents_fts_ad;
      DROP TRIGGER IF EXISTS vault_documents_fts_au;
      DROP TABLE IF EXISTS vault_documents_fts;
      CREATE VIRTUAL TABLE vault_documents_fts USING fts5(
        title, description, content, tags_json,
        content='vault_documents', content_rowid='rowid'
      );
      CREATE TRIGGER vault_documents_fts_ai AFTER INSERT ON vault_documents BEGIN
        INSERT INTO vault_documents_fts(rowid, title, description, content, tags_json)
        VALUES (new.rowid, new.title, new.description, new.content, new.tags_json);
      END;
      CREATE TRIGGER vault_documents_fts_ad AFTER DELETE ON vault_documents BEGIN
        INSERT INTO vault_documents_fts(vault_documents_fts, rowid, title, description, content, tags_json)
        VALUES ('delete', old.rowid, old.title, old.description, old.content, old.tags_json);
      END;
      CREATE TRIGGER vault_documents_fts_au AFTER UPDATE ON vault_documents BEGIN
        INSERT INTO vault_documents_fts(vault_documents_fts, rowid, title, description, content, tags_json)
        VALUES ('delete', old.rowid, old.title, old.description, old.content, old.tags_json);
        INSERT INTO vault_documents_fts(rowid, title, description, content, tags_json)
        VALUES (new.rowid, new.title, new.description, new.content, new.tags_json);
      END;
    `);
  }

  // Triggers sao derivados e baratos; recria-los evita conservar uma versao
  // intermediaria com o nome antigo da coluna de tags.
  db.exec(`
    DROP TRIGGER IF EXISTS vault_documents_fts_ai;
    DROP TRIGGER IF EXISTS vault_documents_fts_ad;
    DROP TRIGGER IF EXISTS vault_documents_fts_au;
    CREATE TRIGGER vault_documents_fts_ai AFTER INSERT ON vault_documents BEGIN
      INSERT INTO vault_documents_fts(rowid, title, description, content, tags_json)
      VALUES (new.rowid, new.title, new.description, new.content, new.tags_json);
    END;
    CREATE TRIGGER vault_documents_fts_ad AFTER DELETE ON vault_documents BEGIN
      INSERT INTO vault_documents_fts(vault_documents_fts, rowid, title, description, content, tags_json)
      VALUES ('delete', old.rowid, old.title, old.description, old.content, old.tags_json);
    END;
    CREATE TRIGGER vault_documents_fts_au AFTER UPDATE ON vault_documents BEGIN
      INSERT INTO vault_documents_fts(vault_documents_fts, rowid, title, description, content, tags_json)
      VALUES ('delete', old.rowid, old.title, old.description, old.content, old.tags_json);
      INSERT INTO vault_documents_fts(rowid, title, description, content, tags_json)
      VALUES (new.rowid, new.title, new.description, new.content, new.tags_json);
    END;
  `);

  // FTS pode ter sido criada depois de documentos existentes em uma versao intermediaria.
  const vaultCounts = db.prepare(
    'SELECT (SELECT COUNT(*) FROM vault_documents) AS d, (SELECT COUNT(*) FROM vault_documents_fts) AS f',
  ).get() as { d: number; f: number };
  if (vaultCounts.f < vaultCounts.d) {
    db.exec(`INSERT INTO vault_documents_fts(vault_documents_fts) VALUES ('rebuild')`);
  }
  addColumnIfMissing(db, 'memory_feedback', 'source_hash', 'source_hash TEXT');

  // Colunas aditivas nas tabelas existentes (guardadas por pragma).
  addColumnIfMissing(db, 'conversations', 'project_id', 'project_id TEXT');
  addColumnIfMissing(db, 'conversations', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'conversations', 'pinned', 'pinned INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'conversations', 'created_by', 'created_by TEXT');
  addColumnIfMissing(db, 'conversations', 'last_run_status', 'last_run_status TEXT');
  addColumnIfMissing(db, 'conversations', 'model_override', 'model_override TEXT');
  addColumnIfMissing(db, 'conversations', 'provider_override', 'provider_override TEXT');

  addColumnIfMissing(db, 'messages', 'run_id', 'run_id TEXT');
  addColumnIfMissing(db, 'messages', 'metadata_json', 'metadata_json TEXT');
  addColumnIfMissing(db, 'messages', 'status', 'status TEXT');
  addColumnIfMissing(db, 'messages', 'sequence', 'sequence INTEGER');

  addColumnIfMissing(db, 'tasks', 'project_id', 'project_id TEXT');
  addColumnIfMissing(db, 'usage_events', 'project_id', 'project_id TEXT');
  addColumnIfMissing(db, 'schedules', 'project_id', 'project_id TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_usage_events_project ON usage_events(project_id, created_at);
  `);

  backfillLegacyProject(db);
}

/**
 * Cria o projeto Legacy (se ausente) e atribui a ele todos os registros antigos
 * sem project_id. Idempotente: não duplica o Legacy nem re-backfilla linhas que
 * já receberam projeto.
 */
function backfillLegacyProject(db: Database.Database): void {
  const hasLegacy = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(LEGACY_PROJECT_ID);
  if (!hasLegacy) {
    // root_path UNIQUE — só insere se o caminho ainda não estiver em uso.
    const rootTaken = db.prepare('SELECT 1 FROM projects WHERE root_path = ?').get(LEGACY_PROJECT_ROOT);
    if (!rootTaken) {
      db.prepare(
        `INSERT INTO projects (id, name, slug, description, root_path, status)
         VALUES (?, 'Legacy', 'legacy', 'Projeto de compatibilidade com dados anteriores à plataforma por projetos.', ?, 'active')`,
      ).run(LEGACY_PROJECT_ID, LEGACY_PROJECT_ROOT);
      db.prepare('INSERT INTO project_settings (project_id) VALUES (?)').run(LEGACY_PROJECT_ID);
    }
  }

  const legacyExists = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(LEGACY_PROJECT_ID);
  if (!legacyExists) return;

  for (const table of ['conversations', 'tasks', 'usage_events', 'schedules']) {
    db.prepare(
      `UPDATE ${table} SET project_id = ? WHERE project_id IS NULL`,
    ).run(LEGACY_PROJECT_ID);
  }
}
