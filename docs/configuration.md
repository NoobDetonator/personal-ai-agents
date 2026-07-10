# Configuração e validação

Use `.env.example` como referência e crie `.env` localmente com ao menos uma chave de API suportada. `config.json` não é distribuído: quando ausente, a aplicação parte de `DEFAULT_CONFIG` e persiste a configuração local ao iniciar.

Por padrão, a configuração aponta para a Aria como `defaultAgent`. O painel web fica habilitado na porta `3131`, e o banco é criado em `data/agents.db` quando necessário. Esses valores podem ser ajustados pelo próprio aplicativo no `config.json` local.

O projeto exige Node.js 20 ou superior. Para validar uma instalação:

```bash
npm ci
npm run typecheck
npm run build
```

Há um driver E2E em `scripts/e2e-driver.mjs`, executado manualmente com um arquivo de passos. Não há script de testes automatizados no `package.json` nesta revisão.
