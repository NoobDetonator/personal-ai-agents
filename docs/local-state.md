# Estado local e histórico

Os itens abaixo são deliberadamente ignorados porque podem conter segredos, perfil pessoal, conversas ou dados gerados em execução:

- `.env`, `config.json`, `USER.md` e `PRODUCT.md`;
- `data/`, `workspace/`, bancos SQLite e arquivos `-journal`, `-shm` e `-wal`;
- agentes criados em `agents/`, suas memórias, diários e memórias profundas;
- caches, arquivos temporários, `node_modules/` e `dist/`.

Antes de cada commit, revise explicitamente o índice com `git diff --cached --name-status` e confirme que nenhum desses caminhos foi adicionado. O `.gitignore` protege novos commits, mas não remove conteúdo de commits anteriores. Qualquer auditoria e limpeza de histórico deve ser planejada e executada separadamente, sem reescrever o histórico nesta reorganização.
