# Acesso remoto seguro

O painel continua escutando exclusivamente em `127.0.0.1`. Não abra a porta
`3131` no firewall e não altere o bind para `0.0.0.0`. O acesso remoto deve
chegar por Tailscale ou por um reverse proxy HTTPS executado na mesma máquina.

## Opção recomendada: Tailscale Serve

1. Instale o Tailscale na VPS e no computador cliente.
2. Mantenha `web.port` em `3131`.
3. Publique o serviço loopback com HTTPS do tailnet:

```bash
sudo tailscale serve --bg https / http://127.0.0.1:3131
tailscale serve status
```

4. Defina uma senha longa apenas no ambiente do processo:

```bash
export PAA_WEB_PASSWORD='use-uma-senha-unica-com-mais-de-20-caracteres'
```

5. Configure a URL HTTPS exibida por `tailscale serve status`:

```json
{
  "web": {
    "enabled": true,
    "port": 3131,
    "publicUrl": "https://nome-da-vps.seu-tailnet.ts.net",
    "trustProxy": true,
    "sessionTtlMinutes": 480,
    "capabilities": {
      "chat": true,
      "files": true,
      "memory": true,
      "settings": false
    }
  }
}
```

Reinicie a aplicação. O acesso pela URL pública mostrará a tela de login. O
link com token impresso no terminal continua destinado somente ao acesso local.

## Reverse proxy com Caddy

Use esta opção apenas quando Tailscale não atender. Restrinja o firewall às
portas `80/443`; a porta `3131` continua fechada.

```caddyfile
agents.exemplo.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3131 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-For {remote_host}
        header_up Host {host}
    }
}
```

Configure `web.publicUrl` como `https://agents.exemplo.com`, ative
`web.trustProxy` e defina `PAA_WEB_PASSWORD`. Não coloque a senha no
`config.json`, em unit files versionados ou em imagens Docker.

## Permissões remotas

As capacidades são verificadas somente em requisições que chegam pelo host
público. O acesso local mantém todas as funções administrativas.

- `chat`: SSE, conversas, runs e cancelamento;
- `files`: explorador, busca, diff e visualizadores;
- `memory`: memórias, export de dados e auditoria do projeto;
- `settings`: configurações e diagnóstico.

Não existe endpoint de terminal remoto. A ferramenta de shell continua sendo
acionada pelo runtime dos agentes e segue as confirmações e o confinamento do
projeto.

## Controles aplicados

- senha mínima de 12 caracteres via `PAA_WEB_PASSWORD`;
- cookie `HttpOnly`, `SameSite=Strict` e `Secure` sob URL pública;
- sessão com expiração configurável;
- cinco tentativas de login a cada 15 minutos por IP;
- rate limit separado para leituras e mutações;
- validação de `Host`, `Origin`, `Sec-Fetch-Site` e `X-Forwarded-Proto`;
- `X-Forwarded-For` aceito somente de proxy loopback explicitamente confiável;
- auditoria de login, logout, expiração, bloqueio e negação de permissão;
- CSP, `nosniff`, bloqueio de framing e previews isolados preservados.

## Checklist antes de disponibilizar

- [ ] `PAA_WEB_PASSWORD` tem 20 ou mais caracteres e não foi versionada.
- [ ] `web.publicUrl` usa `https://` e coincide exatamente com o domínio.
- [ ] `web.trustProxy` está ativo somente com proxy local controlado.
- [ ] A porta 3131 não está acessível externamente.
- [ ] Capacidades desnecessárias estão desativadas.
- [ ] Login incorreto, sessão expirada e logout foram testados.
- [ ] A auditoria aparece na aba Memórias > Auditoria.
- [ ] Há backup recente antes de habilitar exclusões remotas.

## Desativação de emergência

Defina `web.publicUrl` como `null`, desligue o Tailscale Serve/reverse proxy e
reinicie a aplicação. O painel volta a aceitar apenas o fluxo local por token.
