# Plano da Plataforma Web por Projetos

## 1. Visão do produto

Transformar o painel atual em uma plataforma operacional completa para trabalhar com Aria e seus agentes sem depender do terminal da VPS.

O usuário deve conseguir:

1. criar projetos isolados pela interface;
2. abrir múltiplas conversas com Aria dentro de cada projeto;
3. pedir que Aria crie e coordene agentes vinculados ao projeto;
4. acompanhar tarefas, delegações, custos, tokens e atividade por projeto;
5. navegar, visualizar, editar e comparar arquivos do projeto;
6. administrar conversas, memórias, agentes e configurações;
7. alternar entre uma visão global e uma visão filtrada por um ou mais projetos;
8. acessar remotamente com autenticação e segurança adequadas.

A interface deve preservar o neumorfismo atual, usar a nova paleta escura, Lucide para ícones funcionais e SVGs próprios para identidades de agentes. Não usar emojis como ícones de interface.

## 2. Decisão de domínio

### Projeto não é equipe

Hoje o campo team está sendo usado para agrupar agentes, tarefas e diretórios. Isso é insuficiente para isolamento.

Criar a entidade Project como unidade de isolamento. Team continua sendo uma estrutura organizacional dentro de um projeto.

Estrutura conceitual:

- Project: contexto, diretório, chats, agentes, tarefas, uso e configurações.
- Team: grupo de agentes dentro de um Project.
- Conversation: thread de chat vinculada a um Project.
- Agent membership: participação de um agente no Project.
- Run: uma execução de mensagem, delegação, cron ou tarefa.
- Artifact/File: arquivo confinado ao diretório do Project.

Diretórios:

```text
workspace/
  projects/
    <project-id>/
      project.json
      files/
      .aria/
        context.md
        memories/
        previews/
```

Não usar o nome informado pelo usuário diretamente como caminho. Gerar UUID para identidade e slug sanitizado apenas para exibição. O caminho real deve ser resolvido pelo backend e nunca aceito diretamente de requests.

## 3. Modelo de dados

Adicionar migrações incrementais, sem destruir dados existentes.

### projects

- id TEXT PRIMARY KEY
- name TEXT NOT NULL
- slug TEXT NOT NULL UNIQUE
- description TEXT
- root_path TEXT NOT NULL UNIQUE
- status TEXT: active, archived
- created_at
- updated_at
- last_opened_at

### project_settings

- project_id
- default_model
- default_provider
- shell_mode
- delegation_timeout_sec
- max_concurrency
- memory_enabled
- created_at
- updated_at

### project_agents

- project_id
- agent_id
- role
- team
- enabled
- created_at
- PRIMARY KEY project_id, agent_id

Evitar duplicar toda a configuração do agente se ela continuar em config.json. Em uma segunda etapa, migrar configuração de agentes para SQLite.

### conversations

Adicionar:

- project_id TEXT
- archived INTEGER DEFAULT 0
- pinned INTEGER DEFAULT 0
- created_by TEXT
- last_run_status TEXT

Criar índices por project_id e updated_at.

### messages

Adicionar:

- run_id TEXT
- metadata_json TEXT
- status TEXT
- sequence INTEGER

Não salvar somente texto final. Persistir eventos relevantes de tool calling em tabela própria.

### runs

- id
- project_id
- conversation_id
- agent_id
- parent_run_id
- kind: chat, delegation, schedule, heartbeat
- status: queued, running, waiting_confirmation, done, failed, cancelled, timed_out
- started_at
- finished_at
- error_code
- error_message
- input_tokens
- output_tokens
- cached_tokens
- cost_usd
- duration_ms

### run_events

- id
- run_id
- sequence
- type: text_delta, tool_start, tool_result, agent_created, delegation_start, delegation_end, confirmation, status, error
- payload_json
- created_at

Essa tabela permite recarregar um chat, auditar tool calls e reconstruir a timeline após refresh.

### tasks, usage_events, schedules e memories

Adicionar project_id obrigatório para registros novos. Dados antigos ficam em um projeto migrado chamado Legacy.

## 4. Isolamento de execução

Criar um ProjectExecutionContext:

```ts
interface ProjectExecutionContext {
  projectId: string;
  projectRoot: string;
  conversationId?: string;
  runId?: string;
}
```

Esse contexto deve acompanhar toda chamada iniciada pelo site ou CLI.

Regras:

- file tools ficam confinadas em projectRoot;
- shell inicia em projectRoot e não aceita escapar;
- createAgent herda project_id;
- agentes criados dentro do projeto só aparecem nele por padrão;
- delegateTask e tasks herdam project_id;
- memórias de projeto recebem project_id;
- analytics recebem project_id;
- leitura cruzada entre projetos é negada por padrão;
- acesso global deve ser ferramenta separada e explícita;
- conteúdo de outro projeto nunca entra automaticamente no prompt.

Não confiar apenas em instruções do system prompt. O isolamento deve ser validado por código e por resolved paths.

## 5. Backend web

Separar a lógica de chat da CLI. O web server não deve chamar funções que dependam de readline ou renderer de terminal.

Criar serviços:

- ProjectService
- ConversationService
- ChatRunService
- AgentService
- TaskService
- FileService
- MemoryService
- AnalyticsService
- SettingsService
- AuthService

CLI e web devem consumir os mesmos serviços de aplicação.

### API de projetos

- GET /api/projects
- POST /api/projects
- GET /api/projects/:projectId
- PATCH /api/projects/:projectId
- POST /api/projects/:projectId/archive
- DELETE /api/projects/:projectId

Deleção deve exigir confirmação digitando o nome do projeto. Por padrão oferecer arquivar.

### API de conversas

- GET /api/projects/:projectId/conversations
- POST /api/projects/:projectId/conversations
- PATCH /api/conversations/:conversationId
- DELETE /api/conversations/:conversationId
- POST /api/conversations/:conversationId/fork
- POST /api/conversations/:conversationId/messages
- POST /api/runs/:runId/cancel

O POST de mensagem cria um Run e retorna imediatamente runId. O streaming continua pelo canal de eventos.

### Streaming

Aproveitar SSE existente na primeira versão:

- eventos possuem projectId, conversationId, runId e sequence;
- cliente pode reconectar usando Last-Event-ID;
- eventos são também persistidos em run_events;
- tool calls aparecem progressivamente;
- confirmação aparece inline;
- cancelamento fica disponível enquanto running;
- timeout vira status real e visível.

WebSocket só deve ser introduzido se SSE + POST ficar insuficiente.

### API de arquivos

- GET /api/projects/:projectId/files?path=
- GET /api/projects/:projectId/file?path=
- PUT /api/projects/:projectId/file
- POST /api/projects/:projectId/files
- DELETE /api/projects/:projectId/file
- GET /api/projects/:projectId/search?q=
- GET /api/projects/:projectId/diff?path=

Requisitos:

- path relativo e normalizado;
- proteção contra traversal, junctions e symlinks;
- limites de tamanho;
- allowlist de visualizadores;
- confirmação para overwrite e delete;
- ETag ou versão para evitar sobrescrever edição concorrente;
- binários nunca enviados como texto;
- downloads com Content-Disposition seguro.

### API de dados pessoais

- listar memórias por escopo;
- visualizar memória;
- apagar memória individual;
- limpar memória do projeto;
- listar e apagar conversas;
- exportar dados antes de apagar;
- cada ação destrutiva exige confirmação sem opção permanente.

## 6. Arquitetura da interface

### App shell

Barra lateral principal compacta:

- Projetos
- Chat
- Visão geral
- Agentes
- Board
- Arquivos
- Memórias
- Configurações

No topo:

- seletor de projeto;
- estado de conexão;
- modelo ativo;
- custo da sessão;
- busca global;
- central de confirmações.

No rodapé:

- perfil do usuário;
- tema;
- saúde do backend;
- versão.

### Hub de projetos

Tela inicial:

- botão Novo projeto;
- projetos recentes;
- fixados;
- arquivados;
- atividade recente;
- custo e tarefas abertas por projeto.

Modal Novo projeto:

- nome;
- descrição;
- template opcional;
- modelo padrão;
- criar conversa inicial;
- botão Criar projeto.

Após criação:

1. backend cria Project;
2. cria diretório;
3. grava project.json;
4. cria conversa inicial com Aria;
5. navega para /projects/:id/chat/:conversationId.

Se alguma etapa falhar, executar rollback e informar exatamente o que ocorreu.

### Workspace de projeto

Layout inspirado em IDE, sem copiar visualmente o VS Code:

```text
┌ Project rail ┬ Context panel ┬ Main tabs                  ┬ Inspector ┐
│ projetos     │ chats         │ Chat | arquivo | preview  │ agentes   │
│ navegação    │ arquivos      │ múltiplas abas            │ tasks     │
│ global       │ agentes       │                            │ atividade │
└──────────────┴───────────────┴────────────────────────────┴───────────┘
```

Painéis devem ser redimensionáveis e recolhíveis. Em telas menores, context panel e inspector viram drawers.

### Chat

A experiência deve lembrar ferramentas modernas de agentes:

- múltiplas tabs de conversa;
- título editável;
- fixar, arquivar, duplicar e apagar;
- seletor de modelo por conversa;
- mensagens com markdown;
- tool calls recolhíveis;
- cards de delegação com agente, duração e status;
- arquivos alterados como links;
- diff resumido;
- confirmações inline;
- botão cancelar;
- indicador de contexto/projeto;
- composer com anexos, atalhos e botão enviar;
- estado offline e retomada;
- sem emojis como iconografia.

Não esconder falhas. Timeout, tool denial e anti-fabricação devem ser eventos explícitos na timeline.

### Explorador de arquivos

Context panel:

- árvore lazy-loading;
- criar arquivo/pasta;
- renomear;
- apagar;
- busca;
- arquivos alterados recentemente;
- indicadores de mudança.

Main tabs:

- editor de código;
- preview markdown;
- imagem;
- PDF;
- CSV/TSV;
- JSON;
- HTML sandbox;
- texto;
- diff.

Sugestão:

- CodeMirror 6 para edição e syntax highlighting;
- DOMPurify para markdown/HTML;
- iframe sandbox sem allow-same-origin para preview HTML não confiável;
- PDF.js para PDF;
- visualizador tabular virtualizado para CSV;
- evitar Monaco inicialmente por peso, workers e complexidade.

Primeira versão pode ser somente leitura, adicionando edição depois de estabilizar segurança e concorrência.

### Preview web

Adicionar Preview do projeto para HTML estático:

- servidor interno com URL assinada e expiração;
- CSP restritiva;
- iframe sandbox;
- escolha do entrypoint;
- refresh manual e automático opcional;
- console capturado;
- tamanhos desktop/tablet/mobile.

Não implementar navegador remoto irrestrito no MVP. Um browser completo na VPS amplia muito a superfície de ataque. Tratar como fase posterior com container isolado.

### Dashboard e analytics

Filtros:

- todos os projetos;
- um projeto;
- seleção múltipla;
- equipe;
- agente;
- modelo;
- período.

Indicadores:

- projetos ativos;
- agentes ativos;
- runs em execução;
- taxa de sucesso;
- timeouts;
- falhas por ferramenta;
- tokens input/output/cache;
- custo;
- duração mediana e p95;
- tarefas por status;
- delegações por agente;
- arquivos alterados;
- tool calling rate;
- anti-fabrication retries.

As equipes e agentes históricos devem continuar nos filtros mesmo depois de removidos. Derivar filtros da união de projects, tasks, runs e usage_events, não apenas do config atual.

### Configurações

Organizar em seções:

- Geral
- Modelos e providers
- Projetos
- Agentes e delegação
- Ferramentas e shell
- Memória
- Dados e privacidade
- Segurança e acesso remoto
- Aparência
- Backup e exportação
- Diagnóstico

Incluir teste de provider, visão de variáveis ausentes sem revelar valores, limites de timeout/concurrency, retenção de logs, exportação e restore.

## 7. Segurança para VPS

Não expor a porta atual diretamente à internet.

Arquitetura recomendada:

- aplicação escuta em loopback;
- reverse proxy Caddy ou Nginx;
- HTTPS obrigatório;
- autenticação OIDC, passkey ou pelo menos sessão com senha forte;
- cookie Secure, HttpOnly e SameSite;
- proteção CSRF para mutações;
- rate limit;
- auditoria de login e ações destrutivas;
- sessão com expiração;
- bloqueio após tentativas;
- headers CSP, frame-ancestors, nosniff e referrer-policy;
- secrets apenas no servidor;
- nunca devolver tokens de provider ao frontend.

Para uso pessoal, Tailscale ou WireGuard é preferível a abrir a aplicação publicamente. SSH tunnel continua sendo fallback seguro.

File browser, shell e preview devem ter permissões independentes. O usuário pode permitir chat remoto sem permitir edição de arquivos ou terminal.

## 8. Ordem de implementação

### Fase 0 — ADR e contratos

- documentar Project como isolamento;
- mapear team versus project;
- definir rotas e schema;
- definir threat model para VPS;
- criar fixtures e testes de migração.

Critério: decisões aprovadas antes de mexer na UI.

### Fase 1 — Project foundation

- migrations;
- ProjectService;
- CRUD;
- diretórios;
- projeto Legacy;
- ProjectExecutionContext;
- confinamento de file/shell;
- testes de traversal e cruzamento.

Critério: dois projetos não conseguem ler, escrever, delegar ou recuperar memória um do outro.

### Fase 2 — Chat backend

- ConversationService;
- runs/run_events;
- POST messages;
- SSE por run;
- cancelamento;
- timeout;
- confirmação;
- persistência e retomada.

Critério: enviar mensagem pela API, acompanhar tools, atualizar a página e continuar vendo a timeline correta.

### Fase 3 — App shell e projetos

- novo roteamento;
- project switcher;
- hub;
- workspace layout;
- criação e arquivamento;
- responsividade;
- ícones.

Critério: criar e alternar projetos sem terminal.

### Fase 4 — Chat completo

- tabs;
- composer;
- streaming;
- tool cards;
- delegações;
- confirmações;
- cancelamento;
- gerenciamento de conversas.

Critério: fluxo principal com Aria e agentes funciona inteiramente pela web.

### Fase 5 — Arquivos e preview

- árvore;
- visualizadores somente leitura;
- busca;
- tabs;
- diff;
- HTML preview sandbox.

Critério: inspecionar todos os formatos suportados sem acesso SSH.

### Fase 6 — Analytics por projeto

- project_id em usage/tasks/runs;
- filtros globais e múltiplos;
- métricas de tool calling e timeout;
- histórico de agentes/equipes.

Critério: totais globais equivalem à soma dos projetos e filtros não perdem entidades históricas.

### Fase 7 — Memória, dados e configurações

- gestão de memória;
- gestão de conversas;
- export/delete;
- settings estruturados;
- diagnóstico.

Critério: ações destrutivas são confirmadas, auditadas e testadas.

### Fase 8 — Acesso remoto

- auth;
- HTTPS;
- CSRF;
- rate limit;
- auditoria;
- permissões;
- documentação de Tailscale/reverse proxy.

Critério: revisão de segurança concluída antes de disponibilizar fora de localhost.

### Fase 9 — Edição e operação avançada

- editor;
- salvamento concorrente;
- terminal opcional;
- browser remoto isolado;
- templates;
- backups;
- instalação como PWA.

## 9. Estratégia de testes

- migrations com banco antigo;
- isolamento por project_id;
- path traversal, symlink e junction;
- criação com rollback;
- SSE reconnect;
- refresh durante tool call;
- cancelamento e timeout;
- propagação de failed sem virar done;
- anti-fabricação;
- múltiplos chats concorrentes;
- analytics por um, vários e todos os projetos;
- exclusão de conversa/memória;
- acessibilidade por teclado;
- contraste;
- 360px, 768px, 1440px;
- preview HTML hostil;
- CSRF e sessão expirada;
- smoke em Windows e Linux.

## 10. Regras para a IA implementadora

1. Não reescrever tudo de uma vez.
2. Preservar CLI funcional durante a migração.
3. Fazer uma migration por fase.
4. Não usar team como substituto de project_id.
5. Não confiar em path vindo do frontend.
6. Não expor shell no MVP remoto.
7. Não introduzir emojis na interface.
8. Reusar tokens, componentes, Lucide e SVGs de agentes.
9. Criar testes antes ou junto da lógica sensível.
10. Entregar cada fase com typecheck, testes, build e relatório de alterações.

## 11. Prompt mestre para delegação

```text
Implemente a fase [NOME DA FASE] do plano docs/WEB-PLATFORM-PLAN.md.

Antes de editar:
1. leia o plano completo;
2. inspecione schema, web server, chat router, tools, analytics e design system;
3. liste riscos e arquivos afetados;
4. confirme que a fase não depende de uma fase ainda ausente.

Regras:
- preserve mudanças existentes do usuário;
- não faça redesign fora da fase;
- Project é a unidade de isolamento; team nunca substitui project_id;
- isolamento de filesystem e memória deve estar em código;
- mantenha CLI funcionando;
- sem emojis na UI;
- use Lucide e os SVGs existentes;
- ações destrutivas exigem confirmação;
- não exponha a aplicação remotamente sem a fase de segurança.

Ao concluir:
- rode testes, typecheck e build;
- descreva migrations;
- informe endpoints e componentes;
- liste limitações;
- não marque como pronto algo que não verificou.
```

## 12. Escopo recomendado do primeiro ciclo

Delegar somente as fases 0, 1 e 2 no primeiro ciclo. Não começar pela interface.

O maior risco não é visual: é criar uma UI bonita sobre um backend onde chats, agentes, arquivos e memórias ainda não têm isolamento por projeto. Após ProjectExecutionContext e ChatRunService estarem testados, a interface poderá crescer sem acumular dívida estrutural.
