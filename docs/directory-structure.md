# Estrutura de diretórios

```text
agents/aria/soul.md              soul versionada da agente padrão
skills/                          skills embarcadas e seu inventário
src/                             código-fonte TypeScript
web/                             interface estática do painel
design-system/                   showroom independente do design system
scripts/                         utilitários de desenvolvimento e E2E
docs/                            documentação do projeto
data/                            banco e sessões locais (ignorado)
workspace/                       arquivos de trabalho locais (ignorado)
config.json                      configuração local criada em execução (ignorado)
```

O conteúdo sob `agents/`, exceto `agents/aria/soul.md`, é estado local. Novos agentes, souls alteradas durante o uso, memórias, notas diárias e memórias profundas não fazem parte do código versionado.
