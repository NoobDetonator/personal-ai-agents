# ADR 0004 — Threat model para acesso remoto (VPS)

- **Status:** aceito (guia; implementação na Fase 8)
- **Data:** 2026-07-12
- **Fase:** 0 (contratos) — a implementação remota é a Fase 8
- **Contexto do código:** `src/web/server.ts` (loopback, sessão, CSP, CSRF).

Este documento define o modelo de ameaças **antes** de qualquer exposição fora de
`localhost`. Nenhuma das fases 1–7 abre a aplicação à rede; ela permanece em
`127.0.0.1`. A Fase 8 só prossegue após revisão contra este documento.

## Ativos a proteger

1. **Chaves de provider de IA** (`.env`: DEEPSEEK/OPENAI/ANTHROPIC/…). Nunca
   devem sair do servidor nem retornar ao frontend.
2. **Filesystem da VPS** — via file-ops e shell.
3. **Execução de shell** — RCE efetivo por design (a ferramenta existe).
4. **Dados do usuário** — conversas, memórias, perfil, tarefas.
5. **A própria sessão** — token que autentica o painel.

## Superfícies

- HTTP do painel (`web.port`, hoje 3131, loopback).
- Canal SSE.
- Tools acionadas por agentes (file/shell/web), incluindo prompt injection via
  conteúdo externo.
- MCP servers configurados.

## Atores de ameaça

- **Rede aberta**: varredura/scanner se a porta for exposta sem proxy.
- **CSRF / navegador do usuário**: site malicioso tentando falar com o painel.
- **Prompt injection**: página/arquivo/resultado de busca instruindo o agente a
  exfiltrar segredos ou escapar do projeto.
- **DNS rebinding**: rebind de hostname para atingir `127.0.0.1`.
- **Multiusuário futuro** (fora de escopo agora): um projeto acessando outro.

## Controles já presentes (baseline a preservar)

- Bind exclusivo em `127.0.0.1` (`LOOPBACK_HOST`).
- Token de sessão de 32 bytes; cookie `HttpOnly; SameSite=Strict; Path=/`;
  comparação `timingSafeEqual`.
- CSRF: `sec-fetch-site: cross-site` rejeitado; origin validado contra host/porta
  loopback em toda mutação.
- Validação de `Host` (`isAllowedHost`) — mitiga DNS rebinding.
- CSP restritiva (`default-src 'self'`, `object-src 'none'`, `base-uri 'none'`,
  `frame-ancestors 'none'`), `nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`.
- Limite de corpo (`MAX_BODY_BYTES`), somente `GET`/`POST`.
- Isolamento de file/shell por projeto (ADR 0002) reduz o raio de um agente
  comprometido a um único `projectRoot`.

## Requisitos para a Fase 8 (antes de expor)

1. **Não expor a porta direto.** App fica em loopback; à frente, **reverse proxy**
   (Caddy/Nginx) com **HTTPS obrigatório**. Preferir **Tailscale/WireGuard** para
   uso pessoal; SSH tunnel como fallback. Exposição pública é o último recurso.
2. **Autenticação real** além do token de sessão: OIDC, passkey, ou no mínimo
   senha forte + sessão. Cookie `Secure` quando sob HTTPS.
3. **Sessão com expiração**, rotação de token, e **bloqueio após N tentativas**.
4. **Rate limit** por IP/rota nas mutações e no login.
5. **Auditoria** de login e de toda ação destrutiva (delete de projeto/conversa/
   memória, mudança de config) — reutilizar `run_events`/tabela de auditoria.
6. **Permissões independentes** por capacidade: chat remoto pode ser permitido
   sem liberar file browser, e file browser sem liberar shell. O shell **não** é
   exposto no MVP remoto.
7. **Secrets apenas no servidor**; endpoints de config mostram "variável ausente"
   sem revelar valores; nunca serializar tokens de provider para o cliente
   (o `apiState` atual já não os expõe — manter).
8. **Preview HTML** roda em iframe sandbox sem `allow-same-origin`, com CSP
   própria e URL assinada expirável (Fase 5).

## Não-objetivos (deste ciclo)

- Multi-tenant / múltiplos usuários humanos.
- Navegador remoto irrestrito na VPS (amplia demais a superfície; Fase 9, em
  container isolado).
- Exposição pública sem proxy — proibida.

## Revisão

A Fase 8 deve produzir um checklist marcando cada requisito acima como atendido,
com teste correspondente (CSRF, sessão expirada, rate limit, permissões
independentes) antes de qualquer bind fora de loopback.
