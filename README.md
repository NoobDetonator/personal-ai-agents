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

## Segurança do painel

O painel escuta apenas em `127.0.0.1` e usa uma sessão aleatória a cada execução. Abra o link completo impresso pelo terminal; ele contém um token temporário, cria um cookie `HttpOnly` e remove o token da barra de endereço por redirecionamento.

Requisições com Host ou Origin externos são recusadas. A API também limita corpos JSON a 64 KB e aplica headers de segurança no painel.


## Validação

```bash
npm run typecheck
npm run build
npm test
node scripts/e2e-driver.mjs <passos.json>
npm run eval:prompts -- --dry-run
npm run eval:prompts
```

`npm test` roda a suíte de invariantes de segurança em `tests/` (validação de caminhos e symlinks nas operações de arquivo, bloqueio de SSRF na leitura web, allowlist do shell e carregamento confiável de configuração). A mesma suíte roda no CI (GitHub Actions, Linux e Windows) a cada push. O driver E2E é executado com um arquivo de passos apropriado ao cenário.

`eval:prompts -- --dry-run` valida o catalogo sem chamar API. Sem `--dry-run`, executa cenarios comportamentais com o provider configurado, consome tokens e retorna exit code 1 se algum criterio falhar.

## Segurança das ferramentas dos agentes

- Operações de arquivo ficam restritas a `workspace/` por padrão (`fileOps.allowedPaths`); caminhos são resolvidos fisicamente, então symlinks/junctions não escapam das pastas permitidas. `config.json`, `.env*`, bancos `.db`, `.git/` e `node_modules/` nunca são acessíveis, e sobrescrever/deletar pede confirmação.
- A leitura de páginas web recusa endereços privados/reservados (incluindo `localhost` e metadata de cloud), URLs com credenciais e revalida cada redirecionamento; respostas são limitadas a 1 MB.
- A allowlist do shell não aceita comandos com encadeamento (`;`, `&`, `|`, `<`, `>`), substituição (`` ` ``, `$`) ou múltiplas linhas — esses sempre exigem confirmação.
- O timeout do shell encerra a arvore de processos quando o sistema operacional permite e retorna um alerta explicito quando essa garantia e negada pelo ambiente.
- A limpeza em massa do board exige confirmacao humana sem permissao permanente e nunca remove tarefas com delegacao ativa.
- `config.json` é validado ao carregar; um arquivo corrompido é preservado em backup datado (nunca sobrescrito silenciosamente) e a escrita é atômica.

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
