import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, looksFabricated } from '../src/agents/agent.js';

test('anti-fabricacao reconhece alegacoes positivas sem tool call', () => {
  const claims = [
    'Executei o comando com sucesso.',
    'O arquivo foi criado em workspace/saida.md.',
    'Os testes passaram sem erros.',
    'Abri o browser e conferi o console.',
  ];

  for (const claim of claims) {
    assert.equal(looksFabricated(claim, 0), true, claim);
  }
});

test('anti-fabricacao nao pune negacoes e limites honestos', () => {
  const honest = [
    'Nao executei o comando.',
    'O arquivo nao foi criado.',
    'Nao posso confirmar que os testes passaram.',
    'Sem acesso ao repositorio, nao verifiquei o arquivo.',
  ];

  for (const response of honest) {
    assert.equal(looksFabricated(response, 0), false, response);
  }
});

test('alegacao positiva em outra clausula continua sendo detectada', () => {
  assert.equal(
    looksFabricated('Os testes passaram, mas nao executei o build.', 0),
    true,
  );
});

test('tool call real em qualquer continuacao autoriza o relato final', async () => {
  const agent = new Agent('teste');
  const results = [
    {
      text: 'Vou concluir.',
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      toolCallCount: 1,
      finishReason: 'length',
    },
    {
      text: 'O arquivo foi criado.',
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      toolCallCount: 0,
      finishReason: 'stop',
    },
  ];
  let calls = 0;
  (agent as any).chatStream = async () => {
    calls++;
    const result = results.shift();
    assert.ok(result);
    return result;
  };

  const response = await agent.processMessage('Crie o arquivo.');

  assert.equal(response, 'O arquivo foi criado.');
  assert.equal(calls, 2);
});

test('duas alegacoes sem ferramenta sao descartadas', async () => {
  const agent = new Agent('teste');
  let calls = 0;
  (agent as any).chatStream = async () => {
    calls++;
    return {
      text: calls === 1 ? 'Executei o comando.' : 'O arquivo foi criado.',
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      toolCallCount: 0,
      finishReason: 'stop',
    };
  };

  const response = await agent.processMessage('Execute.');

  assert.match(response, /Nada foi executado de verdade/i);
  assert.equal(calls, 2);
});
