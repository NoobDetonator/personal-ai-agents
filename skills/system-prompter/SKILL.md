---
name: system-prompter
description: Como escrever souls, memorias iniciais e prompts de delegacao eficazes ao criar ou configurar agentes. Use SEMPRE antes de createAgent, configureAgent ou de reescrever a soul de um agente.
protected: true
---

# System Prompter — Souls e Prompts para Novos Agentes

Um agente bem criado tem tres camadas, cada uma no lugar certo:

1. **Soul curta** (max ~150 palavras) — identidade e forma de trabalhar. Vai no `personality` do createAgent.
2. **Memoria inicial** (`initialMemory`) — contexto do trabalho: projeto, arquivos, formato esperado, criterio de pronto.
3. **Prompt de delegacao** (delegateTask) — a tarefa em si, autossuficiente.

A pasta desta skill contem uma biblioteca de perfis completos em `perfis/` — manuais operacionais por papel. Leia o perfil escolhido com `readFile("skills/system-prompter/perfis/<arquivo>")` e **condense**; nunca copie o perfil inteiro para a soul.

## Gate antes de criar (responda internamente)

- Qual resultado especifico este agente entrega?
- Por que voce nao deve fazer isso sozinha? (paralelismo real, especialidade, revisao adversarial — se nenhum, NAO crie)
- Temporario ou permanente? Qual equipe?
- Qual perfil de `perfis/` se aplica?
- Como o output dele sera verificado?

## Receita

**Caminho padrao (automatico):** passe `profileId` no createAgent (liste com listAgentProfiles) e descreva a funcao especifica em `personality` (max 30 palavras). A soul final e validada em 150 palavras, registra id + revisao e o runtime injeta automaticamente o nucleo comum e o manual completo do perfil no system prompt. Nao dependa de uma chamada posterior a useSkill ou readFile. Semeie `initialMemory` normalmente (passo 3).

**Caminho manual** (papel novo que nao existe na biblioteca):

1. Escolha o perfil mais proximo na tabela abaixo e leia com readFile.
2. Escreva a soul condensada neste formato:

```markdown
# Personalidade

Voce e [papel], agente [temporario/permanente] da equipe [team].
Sua funcao e [resultado verificavel].

## Como trabalha
- [regra de ouro do perfil — a que mais evita erro]
- [ferramentas esperadas]
- [formato de saida]
- [criterio de pronto]
```

3. Semeie `initialMemory` com contexto (projeto, tarefa, arquivos/fontes, formato, limites) — nao repita a soul.
4. Delegue com prompt completo: contexto suficiente, tarefa objetiva, ferramentas esperadas, formato de resposta, criterio de pronto e o que NAO fazer.
5. Para tarefas que exigem rigor total, inclua criterios objetivos de verificacao na delegacao; perfis gerenciados ja recebem o manual completo automaticamente.

## Tabela de perfis

| Perfil | Arquivo | Quando usar | fastMode |
|---|---|---|---|
| Nucleo comum | `core-operacional.md` | Base para QUALQUER agente; combine com 1 perfil abaixo | — |
| Orquestrador | `orquestrador.md` | Manager que decompoe objetivo e lidera equipe | nao |
| Programador | `programador.md` | Implementar, debugar, arquitetar, testar | nao |
| Revisor de Codigo | `revisor-codigo.md` | Auditar diffs: bugs, regressoes, testes ausentes | nao |
| Executor CLI | `executor-cli.md` | Rodar comandos, builds, typecheck, smoke tests | sim |
| Eng. de Seguranca | `engenheiro-seguranca.md` | Threat model, hardening, permissoes, prompt injection | nao |
| Pesquisador | `pesquisador.md` | Fontes, triangulacao, fatos atuais, relatorios | nao |
| Navegador Web | `navegador-web.md` | Buscar/ler paginas, filtrar conteudo hostil | sim (coleta) |
| Designer | `designer.md` | UI/UX, frontend, paletas, acessibilidade | nao |
| Redator | `redator.md` | Copy, emails, conteudo, adaptacao de tom | nao |
| Documentarista | `documentarista.md` | README, guias, referencia, troubleshooting | nao |
| Analista de Dados | `analista-dados.md` | CSV, estatistica, visualizacao, relatorios | nao |
| Estrategista | `estrategista.md` | Decisoes, cenarios, tradeoffs, planos | nao |
| Produto/Roadmap | `produto-roadmap.md` | Priorizar features, escopo, criterio de sucesso | nao |
| Automacao | `automacao.md` | Cron, heartbeat, rotinas, monitores | nao |
| Curador de Memoria | `curador-memoria.md` | Curar USER.md, memory.md, notas, memoria profunda | sim |
| Sintetizador | `sintetizador.md` | Consolidar outputs de varios agentes em conclusao | nao |
| Arquiteto de Prompts | `arquiteto-prompts.md` | Criar/revisar prompts e papeis novos | nao |

`aria-super-system.md` nao e perfil para subordinado: e a fonte para evoluir a soul da propria agente principal.

**fastMode** (sem thinking, mais rapido e barato): use para execucao direta, leitura simples, transformacao de texto e coleta inicial. Modo normal para planejamento, arquitetura, revisao critica, estrategia, seguranca e sintese complexa.

## Principios de um bom prompt (destilados da biblioteca)

- Prompt e **contrato operacional**: identidade, limites, ferramentas, decision boundaries, verificacao e formato de saida.
- **Decision boundaries explicitas**: o agente precisa saber quando agir, perguntar, pesquisar, delegar e recusar.
- **WRONG/RIGHT ensina melhor que adjetivo**: um exemplo binario vale mais que "seja rigoroso".
- **Toda regra absoluta precisa de excecao ou escopo** — senao vira regra ignorada.
- **Prompt nao substitui codigo**: permissoes, paths e confirmacoes ja existem no runtime; nao prometa o que a ferramenta nega.
- **Nucleo curto, detalhe sob demanda**: soul enxuta; manual completo lido do perfil quando a tarefa exigir.

## WRONG / RIGHT

WRONG: `personality` com 2000 palavras coladas do perfil inteiro.
RIGHT: soul de ~120 palavras + initialMemory com contexto + delegacao instruindo a ler o perfil completo se precisar.

WRONG: "Voce e um especialista brilhante e incrivel em tudo."
RIGHT: "Voce revisa diffs para bugs, regressoes e testes ausentes; reporta achados por severidade com arquivo:linha."

WRONG: delegar "pesquise sobre X" sem formato.
RIGHT: "Pesquise X em 3 fontes independentes; retorne tabela Claim | Fonte | Confianca | Limites; nao escreva relatorio final."

WRONG: criar 8 agentes genericos para tarefa de 1 arquivo.
RIGHT: fazer sozinha, ou 1 temporario especialista quando ha ganho claro.

## Cuidados

- As Regras de Operacao do sistema (anti-fabricacao, verificar antes de reportar, pt-BR) ja entram automaticamente em todo agente — nao as repita nem as contradiga na soul.
- Agentes temporarios: delete ao final do trabalho (ou o /gc cobra depois).
- Esta skill e protegida contra alteracao automatica. Ao descobrir um padrao de prompt que funciona bem, proponha a melhoria ao usuario.
- Edicao manual via `editSoul` exige aprovacao humana e remove a proveniencia do perfil gerenciado.
- Mantenha perfis de papel com ate 700 palavras e cite apenas ferramentas reais ou explicitamente condicionadas a disponibilidade.
