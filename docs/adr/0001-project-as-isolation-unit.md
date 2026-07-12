# ADR 0001 — Project é a unidade de isolamento (team não substitui project_id)

- **Status:** aceito
- **Data:** 2026-07-12
- **Fase:** 0 (contratos)
- **Contexto do código:** `src/config/defaults.ts` (`AgentConfig.team`),
  `src/tools/shell.ts` (`workspace/<team>`), `src/tools/file-ops.ts`
  (`config.fileOps.allowedPaths` global), `src/tools/index.ts`
  (`buildToolSet(agentId, …)`).

## Contexto

O sistema atual isola trabalho por **`team`**: um campo em `AgentConfig` que o
shell usa para derivar o diretório de trabalho (`workspace/<team>`) e que agrupa
agentes e tarefas. As ferramentas de arquivo resolvem contra uma allowlist global
(`config.fileOps.allowedPaths = ["./workspace"]`), sem qualquer noção de "quem
está chamando". As ferramentas são construídas por agente em
`buildToolSet(agentId, …)`, mas as file-ops são singletons de módulo sem contexto.

Consequência: **não há fronteira de isolamento real**. Dois "teams" compartilham
a mesma allowlist de arquivos; qualquer agente pode ler/escrever em
`workspace/` inteiro; memórias, tarefas e usage não têm dono forte; e o system
prompt é a única coisa "separando" contextos — o que é insuficiente e não
auditável.

O plano da plataforma web exige criar projetos isolados, com chats, agentes,
arquivos, memórias, tarefas e custos confinados. `team` não comporta isso.

## Decisão

1. **Introduzir a entidade `Project` como única unidade de isolamento.** Todo
   recurso operacional (conversas, runs, tasks, memórias de projeto, usage,
   arquivos) passa a ter um `project_id` como dono.

2. **`team` permanece como estrutura organizacional _dentro_ de um projeto.** Um
   time é um agrupamento de agentes sob um mesmo `project_id`. `team` nunca é
   usado como fronteira de filesystem, memória ou dados — essa responsabilidade é
   exclusiva de `Project`.

3. **O diretório de trabalho passa a ser resolvido pelo backend a partir do
   projeto**, não do `team`. Layout:

   ```text
   workspace/projects/<project-id>/
     project.json          # metadados espelhados (fonte de verdade = SQLite)
     files/                # arquivos do projeto (raiz do file/shell confinado)
     .aria/                # contexto, memórias e previews do projeto
   ```

   `workspace/projects/<project-id>/files/` é o `projectRoot` para file-ops e o
   `cwd` inicial do shell. `.aria/` guarda estado interno e **não** é exposto às
   file tools do agente.

4. **Identidade vs. caminho.** `project.id` é um UUID. `project.slug` é um slug
   sanitizado apenas para exibição. **O caminho físico nunca é derivado do nome
   nem aceito de requests** — é sempre resolvido pelo backend a partir do `id`.

5. **Isolamento validado por código, não por prompt.** Um
   `ProjectExecutionContext` (ADR 0002) acompanha cada chamada e as ferramentas
   confinam por `resolved path` dentro do `projectRoot`. Leitura cruzada entre
   projetos é negada por padrão; acesso global é uma ferramenta separada e
   explícita.

## Mapeamento team → project

| Antes (`team`)                              | Depois (`project` + `team`)                                       |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `AgentConfig.team` define `workspace/<team>`| `projectRoot = workspace/projects/<project-id>/files`             |
| Tarefas agrupadas por `tasks.team`          | `tasks.project_id` (dono) + `tasks.team` (organização opcional)   |
| Agente "pertence" a um team                 | Agente é membro de um projeto (`project_agents`), com `team` opc. |
| Sem isolamento de arquivos                  | file/shell confinados ao `projectRoot` por código                 |

`team` **não** é removido: continua em `AgentConfig`, em `tasks`, e nos filtros de
analytics (histórico preservado). O que muda é que ele deixa de ter qualquer
significado de segurança/isolamento.

## Compatibilidade e migração

- Migrações **incrementais e aditivas** (mesmo padrão do `ALTER TABLE tasks ADD
  COLUMN team` já existente): nenhuma tabela é destruída.
- Um **projeto `Legacy`** é criado na primeira migração. Todos os registros
  antigos sem `project_id` (conversas, tarefas, usage, schedules, memórias) são
  atribuídos a ele. `Legacy.root_path` aponta para o `workspace/` atual, para não
  quebrar arquivos já criados.
- A **CLI continua funcional**: quando nenhum projeto é selecionado, o contexto
  padrão é o projeto `Legacy` (ou o `defaultProject` configurado). O
  comportamento observável da CLI não muda nesta fase.
- `config.json` continua sendo a fonte de verdade da configuração de agentes por
  ora (a migração de agentes para SQLite é uma etapa posterior, fora do primeiro
  ciclo).

## Consequências

**Positivas**

- Fronteira de isolamento real, auditável e testável (traversal, cross-project).
- Base para analytics, arquivos, memórias e chat por projeto sem dívida
  estrutural.
- `team` deixa de carregar responsabilidade que nunca soube cumprir.

**Negativas / custos**

- Toda origem de chamada (CLI, web, scheduler, heartbeat, delegação) precisa
  propagar um `ProjectExecutionContext`. As file-ops deixam de ser singletons
  puros e passam a resolver contra o `projectRoot` do contexto ativo (ADR 0002).
- Migração de dados legados exige cuidado para não perder histórico — coberta por
  fixtures e testes de migração (Fase 0/1).

## Alternativas consideradas

- **Renomear `team` para `project`.** Rejeitada: `team` tem semântica
  organizacional legítima (hierarquia, colegas) que deve coexistir com o
  isolamento. Sobrecarregar um único conceito reproduz o problema atual.
- **Isolar só por prompt / instrução ao agente.** Rejeitada explicitamente pelo
  plano: isolamento precisa ser garantido por código e por resolved paths, não
  por texto que o modelo pode ignorar ou ser induzido a violar.
- **Um banco SQLite por projeto.** Adiado: aumenta complexidade de analytics
  globais e de migração; `project_id` + índices resolve o primeiro ciclo. Pode
  ser reconsiderado se o volume exigir.
