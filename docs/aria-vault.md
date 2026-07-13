# Aria Vault

O Aria Vault e a camada de memoria e conhecimento por projeto. Ele combina notas Markdown compativeis com Obsidian, busca textual deterministica, proveniencia, feedback e um grafo navegavel sem transformar conteudo recuperado em instrucoes para os agentes.

## Principios

1. **Markdown e a fonte canonica.** As notas continuam legiveis e portaveis fora da aplicacao.
2. **Indice e grafo sao derivados.** SQLite, FTS5, nos e arestas podem ser reconstruidos a partir dos arquivos.
3. **Memoria e dado sem autoridade.** Texto recuperado nunca altera system prompt, ferramentas ou permissoes.
4. **Proveniencia e estado sao explicitos.** Cada nota registra origem, confianca e ciclo de vida.
5. **Nada e promovido silenciosamente.** Inferencias e reflexoes nascem como `tentative` ou `needs_review`.
6. **Projeto e a fronteira de isolamento.** Workers pesquisam somente as proprias memorias; lideres podem consultar a memoria compartilhada do projeto.

## Contrato das notas

Memorias profundas usam frontmatter YAML aceito pelo Obsidian:

```markdown
---
title: "Decisao de autenticacao"
description: "Motivo e consequencias da escolha"
type: "decision"
status: "active"
confidence: 1
source_type: "user"
tags: [arquitetura, seguranca]
aliases: [Auth ADR]
links: [Modelo de ameacas]
implemented_by: [src/web/security.ts]
---

Conteudo da decisao. Relacionamentos tambem podem usar [[wikilinks]].
```

Estados suportados: `active`, `tentative`, `contested`, `superseded`, `stale` e `needs_review`. A origem `user` e reservada a entradas humanas; ferramentas de agentes so podem declarar `agent`, `observation`, `tool_result` ou `imported`.

## Camadas

- **Vault documental:** indexa memorias e notas diarias em `vault_documents`, com busca FTS5 por titulo, descricao, conteudo e tags.
- **Grafo de memoria:** cria nos e relacoes a partir de links, aliases, tags e conceitos.
- **Grafo tecnico:** mapeia arquivos e relacoes observaveis de JavaScript, TypeScript e Markdown dentro do workspace seguro.
- **Pontes:** `implemented_by` conecta decisoes e memorias aos arquivos que as implementam.
- **Feedback:** registra resultados `useful`, `dead_end` e `corrected`, preservando o hash da fonte usada.
- **Reflexao:** gera uma sintese revisavel em `.aria/reflections/LESSONS.md`; nao edita nem promove a memoria original.

O extrator tecnico nativo e deliberadamente conservador. Ele nao substitui um parser AST completo. Graphify, Hindsight ou outro motor podem ser adicionados futuramente como adaptadores opcionais, sem alterar o formato canonico nem tornar o sistema dependente de um servico externo.

## Painel

A area **Memoria** oferece:

- busca e filtros do Vault;
- origem, confianca, estado, tags e resumo de cada nota;
- grafo com camadas `memory`, `code` e `bridge`;
- filas salvas no estilo Obsidian Bases: revisao pendente, tentativas, notas sem links e aprendizados;
- acoes de feedback, reindexacao e reflexao;
- conversas e auditoria no mesmo contexto de projeto.

## Ferramentas dos agentes

- `saveDeepMemory`: grava nota canonica com metadados controlados;
- `searchVaultMemory`: consulta deterministica antes do fallback semantico;
- `recordMemoryOutcome`: registra a utilidade ou correcao de uma memoria;
- `readDeepMemory`: abre a fonte completa quando o trecho for relevante.

## API local

- `GET /api/projects/:id/vault`
- `GET /api/projects/:id/vault/overview`
- `GET /api/projects/:id/vault/graph`
- `POST /api/projects/:id/vault/reindex`
- `POST /api/projects/:id/vault/feedback`
- `POST /api/projects/:id/vault/reflect`

Em acesso remoto, todas essas rotas exigem a capacidade `memory` do projeto.

## Operacao e recuperacao

A sincronizacao acontece ao salvar e ao consultar o Vault. Se o indice derivado for removido ou ficar desatualizado, use **Reindexar** no painel ou chame o endpoint de reindexacao. Os arquivos Markdown permanecem intactos. Feedback de contestacao e revisao e reaplicado ao documento derivado durante uma nova indexacao.
