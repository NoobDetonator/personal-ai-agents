---
name: Personal AI Agents — Painel Web
description: Painel de controle neumórfico e vivo para uma hierarquia pessoal de agentes de IA
colors:
  pulso-indigo: "#818cf8"
  pulso-indigo-claro: "#a5b4fc"
  pulso-indigo-fundo: "#6366f1"
  pulso-indigo-suave: "#818cf826"
  azul-secundario: "#60a5fa"
  violeta-papel: "#a78bfa"
  verde-sucesso: "#34d399"
  ambar-alerta: "#fbbf24"
  vermelho-perigo: "#f87171"
  ciano-info: "#22d3ee"
  grafite-base: "#1f232b"
  grafite-elevado: "#242932"
  grafite-profundo: "#181b22"
  neve-texto: "#f8fafc"
  nevoa-texto: "#94a3b8"
  nevoa-secundaria: "#e2e8f0"
typography:
  display:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "48px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Outfit, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.1em"
  code:
    fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.pulso-indigo}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.pulso-indigo-claro}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.nevoa-secundaria}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.grafite-base}"
    textColor: "{colors.neve-texto}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-brand:
    backgroundColor: "{colors.pulso-indigo-suave}"
    textColor: "{colors.pulso-indigo}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System: Personal AI Agents — Painel Web

## 1. Overview

**Creative North Star: "A Máquina Orgânica"**

O painel é a superfície de controle de uma hierarquia pessoal de agentes de IA — e parece isso: uma máquina que respira. Todo elemento nasce de uma única superfície de fundo (grafite) e se destaca dela por luz e sombra, nunca por bordas ou cor plana. É neumorfismo levado a sério: botões e cards têm volume, parecem pressionáveis, e reagem fisicamente ao toque (sobem, afundam, brilham). A precisão técnica — tipografia geométrica, escala modular, hierarquia rígida — convive com essa textura tátil e macia, como uma sala de controle que tem pulso.

O sistema rejeita explicitamente o molde de dashboard SaaS genérico (fundos brancos planos, cards com borda fina + sombra solta, ícones de biblioteca) e o peso visual de ferramentas enterprise B2B. Este é um painel pessoal — cada agente tem identidade própria (ícone, cor de papel, personalidade), não é uma linha em uma tabela de usuários.

**Key Characteristics:**
- Dark-first: o tema escuro é a referência canônica de todos os tokens; o tema claro é uma reatribuição, não o padrão.
- Neumorfismo real: toda superfície interativa carrega sombra dupla (clara + escura) e um par de estados outset/inset.
- Índigo como pulso único de ação — nunca dividido com outra cor "de marca".
- Violeta reservado exclusivamente para identidade/papel de agente.
- Outfit como única voz tipográfica de prosa; JetBrains Mono só para dados literais.

## 2. Colors

A paleta é construída em três camadas de intenção: grafite como a "pele" neutra da máquina, índigo como o pulso de atividade que percorre essa pele, e um conjunto estrito de cores de feedback que só aparecem quando comunicam um estado real.

### Primary
- **Pulso Índigo** (#818cf8): ação primária, foco, o halo de luz ao redor de botões primários — a corrente elétrica visível da interface. Usado com moderação: CTAs, links, estados ativos.
- **Pulso Índigo Claro** (#a5b4fc): hover do primário — o pulso "acelera" ao passar o mouse.
- **Pulso Índigo Fundo** (#6366f1): estado pressionado/ativo do primário; também a base do índigo no tema claro.
- **Pulso Índigo Suave** (#818cf826): fundo de baixa opacidade para badges e estados sutis (hover de ghost, badge de marca).

### Secondary
- **Azul Secundário** (#60a5fa): ações secundárias e links auxiliares — sempre menos frequente que o índigo, nunca no mesmo contexto visual dele.

### Tertiary
- **Violeta Papel** (#a78bfa): reservado exclusivamente para identidade e papel de agente (badges de role). Não aparece em nenhum outro contexto.

### Neutral
- **Grafite Base** (#1f232b): fundo padrão do tema escuro — a pele da máquina, de onde tudo emerge por sombra.
- **Grafite Elevado** (#242932): superfícies levantadas (cards, sidebar, painéis).
- **Grafite Profundo** (#181b22): superfícies afundadas (inputs, áreas sunken).
- **Neve Texto** (#f8fafc): texto primário no tema escuro.
- **Névoa Texto** (#94a3b8): texto secundário/muted — legendas, timestamps, apoio.
- **Névoa Secundária** (#e2e8f0): texto de maior ênfase que muted (ex: label de botão ghost).

### Named Rules
**The Feedback Reserve Rule.** Verde (sucesso), âmbar (alerta), vermelho (perigo) e ciano (info) só existem em resposta a um estado real do sistema. Se a cor não está comunicando status, ela é grafite ou índigo.
**The One Pulse Rule.** Índigo é a única cor de ação primária na tela em qualquer momento. Azul secundário existe, mas nunca disputa espaço com o índigo no mesmo contexto.

## 3. Typography

**Display Font:** Outfit (com -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)
**Body Font:** Outfit (mesma pilha)
**Label/Mono Font:** JetBrains Mono (com 'Cascadia Code', Consolas, "Courier New", monospace)

**Character:** Outfit sozinho carrega peso e leveza ao mesmo tempo — geométrica o bastante para parecer técnica, arredondada o bastante para não parecer fria. JetBrains Mono entra só onde a precisão literal importa (tokens, IDs, comandos executados).

### Hierarchy
- **Display** (800, 48px, lh 1.15, ls -0.03em): títulos principais de seção — nome de equipe, header de agente.
- **Headline** (700, 28px, lh 1.15, ls -0.015em): subtítulos de card, cabeçalhos de módulo.
- **Title** (600, 18px, lh 1.3, ls normal): título de card, nomes de agente na árvore de hierarquia.
- **Body** (400, 15px, lh 1.5): texto corrido, mensagens de chat, descrições. Máximo ~70ch de largura de linha.
- **Label** (700, 10px, ls 0.1em, uppercase): overlines, badges, rótulos de status — sempre caixa alta.

### Named Rules
**The Single Voice Rule.** Uma família só (Outfit) carrega toda a hierarquia visual — peso e tamanho fazem o trabalho, não uma segunda fonte. JetBrains Mono entra apenas para dados literais, nunca para prosa.

## 4. Elevation

O sistema é neumórfico por definição: toda superfície carrega uma dupla sombra (clara + escura) simulando luz vinda de um ângulo fixo, criando a sensação de que os elementos são fisicamente pressionáveis — convexos em repouso, côncavos quando pressionados ou focados. Não há sombras "flutuantes" genéricas fora de elementos que realmente flutuam sobre o conteúdo (tooltip, modal, toast, drawer), que usam uma sombra float separada, mais suave e direcional.

### Shadow Vocabulary
- **Outset (repouso)** (`2px 2px 4px #12141a, -2px -2px 4px #292f3a`, escalando de xs a xl): estado padrão de botões, cards, badges — a superfície parece levantada da pele grafite.
- **Inset (pressionado)** (`inset 2px 2px 4px #12141a, inset -2px -2px 4px #292f3a`): estado ativo/pressionado de botões, inputs em foco, cards sunken.
- **Float (flutuante)** (`0 4px 16px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.2)` na variante md): reservada a elementos que rompem o plano da página — tooltip, modal, toast, drawer.

### Named Rules
**The Press Rule.** Todo elemento interativo precisa dos dois estados neumórficos: outset em repouso e inset ao ativar/focar. Se não pressiona, não é neumórfico — é só decoração.

## 5. Components

Cada componente é tátil e vivo: responde fisicamente ao toque (pressiona, levanta, brilha), nunca fica estático como um retângulo com cor de fundo.

### Buttons
- **Shape:** cantos suavemente arredondados (10px)
- **Primary:** fundo Pulso Índigo, texto branco, sombra outset + halo sutil de 16px na cor primária suave; padding 8px 16px
- **Hover / Focus:** sombra outset cresce (sm → md), botão sobe 1px; foco visível adiciona anel de foco duplo em índigo
- **Ghost / Outline / Danger / Success:** ghost é transparente até o hover (preenche com índigo suave); outline tem borda sólida de 1px na cor primária; danger e success espelham o primary trocando a cor base

### Chips (Badge/Chip)
- **Style:** badge usa fundo de baixa opacidade da cor de status + texto na mesma cor, cantos de 6px; chip usa fundo grafite base, cantos totalmente arredondados (pill)
- **State:** chip interativo ganha sombra outset xs no hover; o botão de remover do chip (16px, circular) vira vermelho no hover

### Cards / Containers
- **Corner Style:** 20px
- **Background:** Grafite Base — a mesma cor do fundo da página; o card "emerge" por sombra, não por cor
- **Shadow Strategy:** outset médio em repouso; variante sunken usa inset; variante convex usa gradiente diagonal sutil (grafite elevado → grafite profundo)
- **Border:** nenhuma por padrão — a sombra dupla já define o limite
- **Internal Padding:** 24px

### Inputs / Fields
- **Style:** fundo grafite base, borda transparente de 2px, sombra inset (já nasce "afundado" na superfície)
- **Focus:** sombra inset mantida + anel de foco duplo em índigo
- **Error / Disabled:** erro troca a borda para vermelho-perigo e adiciona halo de 3px; disabled cai para 50% de opacidade

### Navigation
- Sidebar de 260px na mesma superfície neu-base do resto do painel; itens com raio médio (10px) e padding 12px/16px — nenhum destaque de seleção além do que os próprios componentes (badge, texto) já comunicam.

### Agent Identity Badges (signature component)
Cada agente carrega um badge de papel em Violeta Papel e ícones próprios (agent-icons/ai-icons) — o único lugar onde essa cor aparece, para nunca competir com o índigo de ação.

## 6. Do's and Don'ts

### Do:
- **Do** manter o índigo (#818cf8) como única cor de ação primária — halos, focos e CTAs sempre nessa cor.
- **Do** dar a cada elemento interativo os dois estados neumórficos: outset em repouso, inset ao pressionar/focar (The Press Rule).
- **Do** reservar violeta (#a78bfa) exclusivamente para identidade/papel de agente.
- **Do** manter o tema escuro como padrão — é o tema de referência para todos os tokens.

### Don't:
- **Don't** clonar a estética de dashboards SaaS genéricos (Notion/Linear/Vercel) — nada de fundos brancos planos, cards com borda fina e sombra solta, ícones de biblioteca genérica.
- **Don't** aproximar o visual de um painel enterprise B2B pesado (tipo AnalyzAI) — sem headers corporativos densos, sem paletas azul-corporativo neutras.
- **Don't** usar sombra "flutuante" (float) em elementos que não realmente flutuam sobre a página — reservada a tooltip/modal/toast/drawer.
- **Don't** usar mais de uma família tipográfica para prosa — Outfit carrega tudo; JetBrains Mono só para dados literais.
- **Don't** usar cores de feedback (verde/âmbar/vermelho/ciano) fora de contexto de status real.
