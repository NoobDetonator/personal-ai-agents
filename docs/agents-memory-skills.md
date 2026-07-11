# Agentes, memória e skills

## Aria e agentes locais

`agents/aria/soul.md` é a única soul incluída na instalação padrão. Agentes criados durante o uso, suas souls, memórias, notas diárias e memórias profundas são estado local ignorado pelo Git.

Perfil do usuário, memória e notas são enviados ao modelo como dados em uma mensagem de usuário separada. Apenas regras fixas e souls validadas permanecem no system prompt. Conteúdo dinâmico não pode alterar regras, ferramentas ou permissões.

## Perfis e souls

`createAgent`, `configureAgent` e o comando `/novo` aceitam `profileId`. O compositor gera uma soul de até 150 palavras, registra o id e a revisão do perfil e limita a missão a 30 palavras. Edição manual da própria soul exige confirmação humana e remove a proveniência do perfil.

## Skills

A aplicação descobre diretórios de primeiro nível em `skills/` que contenham `SKILL.md`. Skills internas usam `protected: true`. Somente a agente principal pode criar ou atualizar skills persistentes, sempre com confirmação humana. Consulte `skills/README.md` para as regras de governança.
