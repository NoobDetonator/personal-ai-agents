# Arquitetura

O código da aplicação está em `src/` e é compilado de TypeScript para `dist/`. O ponto de entrada (`src/index.ts`) carrega a configuração local, inicializa o banco SQLite, descobre agentes locais, carrega skills, monta as ferramentas e inicia CLI, agendador, heartbeat e painel web.

| Área | Responsabilidade |
| --- | --- |
| `src/config/` | Valores padrão, leitura/gravação de `config.json` e watcher local. |
| `src/agents/` | Registro, souls, memória e ciclo de vida dos agentes. |
| `src/skills/` | Descoberta e leitura de diretórios com `SKILL.md`. |
| `src/db/` | Conexão SQLite e schema em `data/agents.db`. |
| `src/web/` | Servidor HTTP/SSE e API do painel. |
| `src/chat/`, `src/tools/`, `src/scheduler/`, `src/heartbeat/` | Interação, ferramentas e automações de execução. |

O servidor entrega os assets de `web/` diretamente; eles não são gerados pelo TypeScript. `design-system/` é um showroom separado. Ele compartilha alguns tokens e ícones com `web/`, mas também possui HTML, estilos e scripts próprios. A duplicação foi mantida nesta reorganização porque unificá-la exigiria alterar o fluxo do painel ou do showroom; uma futura mudança deve definir um processo de build e uma fonte compartilhada antes de remover arquivos.
