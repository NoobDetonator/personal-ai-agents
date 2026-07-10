# Agentes, memória e skills

## Aria e agentes locais

`agents/aria/soul.md` é a única soul incluída na instalação padrão. O registro procura subdiretórios em `agents/`; cada diretório encontrado é registrado na configuração local. Assim, agentes criados pela Aria e suas alterações são dados de execução e permanecem ignorados pelo Git.

Cada agente pode ter `soul.md`, `memory.md`, notas diárias em `memory/` e memórias profundas em `memories/`. O perfil compartilhado do usuário fica em `USER.md`. Todos esses arquivos são locais e não devem ser adicionados ao repositório.

## Skills

A aplicação descobre diretórios de primeiro nível em `skills/` que contenham `SKILL.md`. O diretório pode receber skills criadas durante o uso, mas o controle de versão só deve incluir mudanças revisadas intencionalmente. Veja `skills/README.md`.
