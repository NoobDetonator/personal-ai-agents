# Configuração e validação

Use `.env.example` como referência e crie `.env` localmente com ao menos uma chave de API suportada. `config.json` não é distribuído: quando ausente, a aplicação parte de `DEFAULT_CONFIG` e persiste a configuração local ao iniciar.

Por padrão, a configuração aponta para a Aria como `defaultAgent`. O painel web fica habilitado na porta `3131`, e o banco é criado em `data/agents.db` quando necessário. Esses valores podem ser ajustados pelo próprio aplicativo no `config.json` local.

O projeto exige Node.js 20 ou superior. Para validar uma instalação:

```bash
npm ci
npm run typecheck
npm run build
```

H? testes automatizados em `tests/`, um driver E2E manual em `scripts/e2e-driver.mjs` e avalia??es comportamentais em `scripts/prompt-eval.mjs`. Use `npm run eval:prompts -- --dry-run` para validar sem API; o modo live consome tokens do provider configurado.
