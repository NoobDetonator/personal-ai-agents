# Skills embarcadas

O projeto inclui duas skills internas protegidas: `criando-skills` e `system-prompter`. Skills com `protected: true` não podem ser alteradas por agentes.

Somente a agente principal recebe `createSkill` e `updateSkill`. Criar ou atualizar uma skill persistente exige confirmação humana sem permissão permanente. Workers e managers podem listar e usar skills, mas não criá-las nem reescrevê-las.

O `system-prompter` fornece perfis para composição determinística de souls. Agentes criados com `profileId` registram o id e a revisão do perfil na configuração. Skills criadas durante o uso continuam sendo estado local que deve ser revisado antes de qualquer commit.
