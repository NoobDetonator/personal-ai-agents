# Produtividade e operacao da plataforma web

## Editor seguro

O editor trabalha apenas dentro da raiz do projeto, recusa links simbolicos,
segredos e caminhos protegidos. Cada salvamento envia o `ETag` recebido na
abertura. Se outro agente ou processo alterou o arquivo, a API retorna `409` e
preserva o rascunho no navegador; ela nunca sobrescreve silenciosamente.

Criacao usa `If-None-Match: *`, salvamento/rename/delete usam `If-Match`, e a
escrita passa por um arquivo temporario no mesmo diretorio antes do rename.
Exclusao exige o caminho exato e pastas nao vazias nao sao removidas.

## Templates

Projetos novos podem partir de `blank`, `web-static`, `node-typescript` ou
`research`. Os templates sao internos, deterministas e nao executam comandos ou
instalam dependencias.

## Backups

O painel cria bundles JSON versionados em `.aria/backups`, fora do explorador de
arquivos do agente. O bundle inclui dados do projeto e arquivos em Base64, mas
ignora `.env`, chaves, bancos, `.git`, `.aria`, `node_modules` e links simbolicos.
O limite atual e 5.000 arquivos ou 25 MB de conteudo. Guarde uma copia baixada
fora da VPS; o bundle foi desenhado para recuperacao assistida e auditoria, nao
para ser executado diretamente.

## PWA

O painel pode ser instalado como aplicativo. O service worker guarda somente a
casca visual e a pagina offline. Rotas `/api/`, conversas, respostas, arquivos e
tokens nunca entram no cache offline.

## Limites intencionais

- Nao ha terminal HTTP remoto. Comandos continuam passando pelo runtime dos
  agentes, confinamento do projeto e confirmacoes existentes.
- Nao ha browser remoto irrestrito. Previews HTML continuam em iframe sandbox e
  buscas web continuam protegidas contra SSRF.
- Um browser/terminal interativo futuro exige processo isolado, limites de CPU e
  memoria, filesystem efemero, allowlist de rede e sessao descartavel. Ele nao
  deve compartilhar o processo ou as credenciais do painel.
