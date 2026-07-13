# Arquitetura

O código da aplicação está em `src/` e é compilado de TypeScript para `dist/`. O ponto de entrada (`src/index.ts`) carrega a configuração local, inicializa o banco SQLite, descobre agentes locais, carrega skills, monta as ferramentas e inicia CLI, agendador, heartbeat e painel web.

| Área | Responsabilidade |
| --- | --- |
| `src/config/` | Valores padrão, leitura/gravação de `config.json` e watcher local. |
| `src/agents/` | Registro, souls, memória e ciclo de vida dos agentes. |
| `src/skills/` | Descoberta e leitura de diretórios com `SKILL.md`. |
| `src/db/` | Conexão SQLite e schema em `data/agents.db`. |
| `src/web/` | Servidor HTTP/SSE e API do painel. `server.ts` mantém autenticação e ciclo de vida, `router.ts` despacha rotas, `api/` separa estado, projetos e conversas, e `sse.ts` gerencia streaming. |
| `src/chat/`, `src/tools/`, `src/scheduler/`, `src/heartbeat/` | Interação, ferramentas e automações de execução. |

O servidor entrega os assets de `web/` diretamente; eles não são gerados pelo TypeScript. O painel usa scripts clássicos pequenos e ordenados, sem bundler: `core.js` reúne infraestrutura compartilhada, `project-files.js` contém renderizadores seguros e `features/` separa navegação, projetos, chat, arquivos, visão geral, agentes, memória, configurações e eventos ao vivo. `app.js` ficou restrito à inicialização.

Os arquivos do dashboard compartilham o escopo global do navegador e, por isso, sua ordem em `web/index.html` faz parte do contrato. `scripts/dashboard-sources.mjs` mantém a lista canônica; as verificações de sintaxe e lint validam o conjunto concatenado somente em memória, além de confirmar que o HTML carrega todos os arquivos na ordem correta.

`design-system/` é um showroom separado. Ele compartilha alguns tokens e ícones com `web/`, mas também possui HTML, estilos e scripts próprios. A duplicação foi mantida nesta reorganização porque unificá-la exigiria alterar o fluxo do painel ou do showroom; uma futura mudança deve definir um processo de build e uma fonte compartilhada antes de remover arquivos.
