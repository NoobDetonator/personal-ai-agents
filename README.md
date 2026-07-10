# Personal AI Agents 3.0

Uma assistente de IA pessoal para terminal, com painel web local e suporte a equipes de agentes. Uma instalação nova começa somente com a **Aria**; os demais agentes são criados durante o uso.

## Requisitos

- Node.js 20 ou superior
- Uma chave de API compatível em `.env` (veja `.env.example`)

## Primeiros passos

```bash
git clone https://github.com/NoobDetonator/personal-ai-agents.git
cd personal-ai-agents
npm ci
cp .env.example .env
# preencha ao menos uma chave de API em .env
npm run dev
```

O programa cria `config.json`, `data/` e `workspace/` localmente quando necessário. Esses arquivos representam o estado de uso e não são versionados. O painel web local usa a porta `3131` por padrão.

## Validação

```bash
npm run typecheck
npm run build
node scripts/e2e-driver.mjs <passos.json>
```

O repositório não expõe um script `test`; o driver E2E é executado com um arquivo de passos apropriado ao cenário.

## Estrutura

```text
agents/aria/                 # Soul versionada da agente padrão
docs/                        # Arquitetura, configuração e separação de estado
skills/                      # Skills embarcadas; veja skills/README.md
src/                         # Aplicação TypeScript
web/                         # Assets do painel servido pela aplicação
design-system/               # Showroom independente do design system
data/, workspace/            # Estado local gerado em uso (ignorados)
```

Consulte a [documentação](docs/) para arquitetura, configuração, agentes, memória, skills e estado local.
