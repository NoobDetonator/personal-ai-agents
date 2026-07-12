# ADR 0002 — ProjectExecutionContext e confinamento de execução

- **Status:** aceito
- **Data:** 2026-07-12
- **Fase:** 0 (contratos) / implementado na Fase 1
- **Depende de:** [ADR 0001](0001-project-as-isolation-unit.md)

## Contexto

Hoje o isolamento é frágil (ADR 0001). Precisamos de um mecanismo **em código**
que carregue "qual projeto está executando" através de toda chamada — CLI, web,
scheduler, heartbeat e delegação — e que as ferramentas usem para confinar
filesystem e shell. O desafio: as file-ops (`src/tools/file-ops.ts`) são
singletons de módulo sem contexto de chamador, e o shell
(`src/tools/shell.ts`) deriva o `cwd` de `config.agents[agentId].team`.

## Decisão

### 1. O objeto de contexto

```ts
interface ProjectExecutionContext {
  projectId: string;      // UUID do projeto
  projectRoot: string;    // caminho absoluto de workspace/projects/<id>/files
  conversationId?: string;
  runId?: string;
}
```

`projectRoot` é **sempre** resolvido pelo backend a partir de `projectId` (via
`ProjectService`), nunca recebido do frontend.

### 2. Propagação: AsyncLocalStorage + parâmetro explícito

Usamos `AsyncLocalStorage<ProjectExecutionContext>` (`node:async_hooks`) como
canal ambiente para o contexto ativo durante uma execução de agente. Motivo: as
tools do AI SDK são invocadas pelo runtime do modelo sem que possamos passar
argumentos extras por chamada; um ALS carrega o contexto do `run` até o
`execute` da tool sem reescrever todas as assinaturas.

- `runWithProjectContext(ctx, fn)` — estabelece o contexto para toda a árvore
  assíncrona de `fn` (um turno de chat / uma delegação).
- `getProjectContext()` — lê o contexto ativo; retorna `undefined` fora de um
  run.
- `requireProjectContext()` — lê e **lança** se ausente, para caminhos que nunca
  devem rodar sem projeto.

A camada de serviço (ChatRunService, delegação, scheduler) é a **única** que abre
o contexto. As tools apenas o consomem.

### 3. Confinamento de arquivos

`resolveWithinRoots` passa a considerar o `projectRoot` do contexto ativo como a
raiz permitida, **em vez de** `config.fileOps.allowedPaths` global:

- Fora de um contexto de projeto (ex.: bootstrap, testes puros de path), o
  comportamento legado (`config.fileOps.allowedPaths`) é mantido para não quebrar
  a CLI durante a migração.
- Dentro de um contexto, a raiz permitida é **exclusivamente** `projectRoot` (mais
  a pasta `skills/` apenas para leitura, como hoje). `.aria/` do projeto fica fora
  do alcance das file tools do agente.
- Todas as proteções atuais permanecem: rejeição de symlink/junction via
  `realpathSync.native`, bloqueio de `.env`, `config.json`, `.git`,
  `node_modules`, extensões protegidas, e checagem tanto do caminho lexical
  quanto do físico.
- **Cross-project é negado por construção**: `isInside(projectRoot, physical)` só
  é verdadeiro para o próprio projeto. O `projectRoot` de outro projeto é um
  diretório irmão, e `path.relative` produz `..`.

### 4. Confinamento de shell

`createShellTools` deixa de derivar o `cwd` de `team`. O `cwd` padrão e a raiz de
confinamento passam a ser o `projectRoot` do contexto ativo:

- `requestedWorkdir = path.resolve(projectRoot, cwd ?? '.')`.
- Verificação dupla (lexical + físico via `canonicalizePath`) de que o workdir
  fica dentro de `projectRoot`; caso contrário, erro.
- Sem contexto de projeto (CLI legada antes de selecionar projeto), cai no
  comportamento atual baseado em `workspace/` para preservar a CLI.

### 5. Herança em criação de agentes, tarefas e memórias

- `createAgent` dentro de um contexto registra o agente como membro do projeto
  (`project_agents`) e o agente passa a aparecer só nesse projeto por padrão.
- `delegateTask`/tasks e memórias de projeto recebem o `project_id` do contexto.
- `usage_events` recebem o `project_id` do contexto ativo.

### 6. Acesso global é explícito

Nenhuma tool lê outro projeto implicitamente. Um eventual acesso cross-project
será uma ferramenta separada, com nome próprio e permissão distinta — fora do
escopo do primeiro ciclo. Conteúdo de outro projeto nunca entra no prompt
automaticamente.

## Invariantes testáveis (critério da Fase 1)

Dado projeto **A** e projeto **B**:

1. Uma file tool executando no contexto de **A** não resolve caminho algum dentro
   de `projectRoot(B)` (retorna acesso negado).
2. `..`, symlink e junction a partir de `projectRoot(A)` para B ou para fora do
   `workspace` são negados (lexical e físico).
3. O shell no contexto de **A** não executa com `cwd` fora de `projectRoot(A)`.
4. `.aria/` de A não é acessível pelas file tools de A.
5. Fora de qualquer contexto, o comportamento legado (`workspace/`) permanece —
   a CLI atual não quebra.

## Consequências

- As tools passam a depender de um contexto ambiente. Isso é aceitável e comum
  (padrão request-scoped), mas exige que **todo** ponto de entrada que roda um
  agente abra o contexto — caso contrário cai no modo legado. Testes cobrem os
  dois modos.
- `history-compressor`, `recall` e outras side-queries que rodam dentro do turno
  herdam o contexto automaticamente pelo ALS.
- Nenhuma mudança de assinatura pública das tools é necessária, minimizando o
  diff e o risco na base de segurança já endurecida.
