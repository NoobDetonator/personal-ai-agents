# ADR 0003 — Contratos de API e schema (Fases 1–2)

- **Status:** aceito
- **Data:** 2026-07-12
- **Fase:** 0 (contratos)
- **Depende de:** [ADR 0001](0001-project-as-isolation-unit.md),
  [ADR 0002](0002-project-execution-context.md)

Define o schema SQLite e as rotas HTTP que as Fases 1 e 2 implementam. As Fases
3+ (UI) consomem estes contratos sem alterá-los.

## Convenções de migração

- Migrações em `src/db/schema.ts`, idempotentes: `CREATE TABLE IF NOT EXISTS` e
  `ALTER TABLE … ADD COLUMN` guardado por `pragma_table_info` (padrão já usado
  para `tasks.team`).
- `AppConfig.version` sobe para `2` quando o schema estrutural muda; o loader
  continua tolerante e aditivo.
- Nenhum `DROP`/`DELETE` de dados na migração. Registros antigos vão para o
  projeto **Legacy**.

## Schema — novas tabelas

### projects

```sql
CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,          -- UUID
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,      -- só exibição; nunca vira caminho
  description    TEXT,
  root_path      TEXT NOT NULL UNIQUE,      -- relativo à raiz do projeto
  status         TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at TEXT
);
```

### project_settings

```sql
CREATE TABLE IF NOT EXISTS project_settings (
  project_id             TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  default_model          TEXT,
  default_provider       TEXT,
  shell_mode             TEXT,     -- confirm | auto | off | null (herda global)
  delegation_timeout_sec INTEGER,
  max_concurrency        INTEGER,
  memory_enabled         INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### project_agents

```sql
CREATE TABLE IF NOT EXISTS project_agents (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id   TEXT NOT NULL,
  role       TEXT,
  team       TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, agent_id)
);
```

### runs

```sql
CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  conversation_id TEXT,
  agent_id        TEXT NOT NULL,
  parent_run_id   TEXT,
  kind            TEXT NOT NULL DEFAULT 'chat',  -- chat|delegation|schedule|heartbeat
  status          TEXT NOT NULL DEFAULT 'queued',
  -- queued|running|waiting_confirmation|done|failed|cancelled|timed_out
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
```

### run_events

```sql
CREATE TABLE IF NOT EXISTS run_events (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  sequence    INTEGER NOT NULL,
  type        TEXT NOT NULL,
  -- text_delta|tool_start|tool_result|agent_created|delegation_start|
  -- delegation_end|confirmation|status|error
  payload_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, sequence);
```

## Schema — colunas adicionadas (aditivas, guardadas por pragma)

- **conversations**: `project_id TEXT`, `archived INTEGER DEFAULT 0`,
  `pinned INTEGER DEFAULT 0`, `created_by TEXT`, `last_run_status TEXT`.
  Índices: `(project_id, updated_at)`.
- **messages**: `run_id TEXT`, `metadata_json TEXT`, `status TEXT`,
  `sequence INTEGER`.
- **tasks**: `project_id TEXT` (já tem `team`).
- **usage_events**: `project_id TEXT`.
- **schedules**: `project_id TEXT`.

`project_id` é NOT NULL apenas para **registros novos** criados dentro de um
contexto; a coluna em si é nullable para permitir o backfill do Legacy sem
reescrever linhas antigas de forma destrutiva. A camada de serviço sempre grava
`project_id` em inserts novos.

## Projeto Legacy (backfill)

Na migração:

1. Se não existir projeto algum, criar `Legacy` com `root_path` = `workspace`
   (o diretório atual), status `active`.
2. `UPDATE … SET project_id = <legacy> WHERE project_id IS NULL` em
   conversations, tasks, usage_events, schedules.
3. `project_settings(Legacy)` herda os globais (todos nulos → herda `config`).

Idempotente: rodar de novo não duplica o Legacy nem re-backfilla.

## Rotas HTTP (Fases 1–2)

Todas exigem sessão válida (padrão atual). Mutações (`POST`/`PATCH`/`PUT`/
`DELETE`) exigem `isTrustedMutationRequest` (CSRF via `sec-fetch-site`/origin),
como já implementado. IDs validados por regex antes de tocar o banco.

### Projetos (Fase 1)

| Método | Rota                              | Notas |
| ------ | --------------------------------- | ----- |
| GET    | `/api/projects`                   | lista (filtro `?status=`) |
| POST   | `/api/projects`                   | cria; body `{name, description?, defaultModel?, createInitialConversation?}` → cria diretórios + `project.json` + (opcional) conversa inicial; rollback em falha |
| GET    | `/api/projects/:projectId`        | detalhe + settings + contadores |
| PATCH  | `/api/projects/:projectId`        | `{name?, description?, settings?}` |
| POST   | `/api/projects/:projectId/archive`| status → archived |
| DELETE | `/api/projects/:projectId`        | exige `{confirmName}` == `project.name`; padrão sugere arquivar |

### Conversas e runs (Fase 2)

| Método | Rota | Notas |
| ------ | ---- | ----- |
| GET  | `/api/projects/:projectId/conversations` | lista (inclui `archived`, `pinned`) |
| POST | `/api/projects/:projectId/conversations` | cria conversa vazia; `{agentId?, title?}` |
| PATCH| `/api/conversations/:conversationId` | `{title?, pinned?, archived?}` |
| DELETE | `/api/conversations/:conversationId` | cascade das mensagens |
| POST | `/api/conversations/:conversationId/fork` | clona |
| POST | `/api/conversations/:conversationId/messages` | **cria um Run**, retorna `202 {runId}` na hora; execução assíncrona |
| POST | `/api/runs/:runId/cancel` | cancela enquanto `running`/`queued` |
| GET  | `/api/runs/:runId/events?after=<seq>` | replay de `run_events` (retomada) |

### Streaming (Fase 2)

- Canal SSE existente (`/api/events`) estendido: cada evento carrega
  `projectId`, `conversationId`, `runId`, `sequence`.
- Eventos de run também persistem em `run_events` (fonte de verdade para replay).
- Reconexão: cliente reconecta e chama `GET /api/runs/:runId/events?after=<seq>`
  para preencher a lacuna; `Last-Event-ID` é honrado quando presente.
- `cancel` e `timeout` viram eventos `status` explícitos e atualizam `runs.status`.

## Semântica de Run (máquina de estados)

```
queued → running → done
                 → failed        (error_code/error_message preenchidos)
                 → cancelled      (via /cancel)
                 → timed_out      (timeout do turno)
       → waiting_confirmation → running | cancelled
```

Regra dura: **`failed`/`timed_out`/`cancelled` nunca transicionam para `done`.**
Um turno abortado é registrado com o status real; a anti-fabricação existente
(`looksFabricated`) continua valendo e, se disparar, o texto final reflete a
falha.

## Fora de escopo deste ciclo

Arquivos (Fase 5), analytics por projeto na UI (Fase 6), auth remota (Fase 8),
migração de agentes de `config.json` para SQLite. As colunas/rotas acima são o
suficiente para Fases 1–2 sem prender decisões futuras.
