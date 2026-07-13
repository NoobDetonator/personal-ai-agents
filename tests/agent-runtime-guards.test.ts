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
    assert.equal(looksFabricated(claim, []), true, claim);
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
    assert.equal(looksFabricated(response, []), false, response);
  }
});

test('alegacao positiva em outra clausula continua sendo detectada', () => {
  assert.equal(
    looksFabricated('Os testes passaram, mas nao executei o build.', []),
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
      toolExecutions: [{ name: 'writeFile', effect: 'write' as const, success: true }],
      finishReason: 'length',
    },
    {
      text: 'O arquivo foi criado.',
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      toolCallCount: 0,
      toolExecutions: [],
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
      toolExecutions: [],
      finishReason: 'stop',
    };
  };

  const response = await agent.processMessage('Execute.');

  assert.match(response, /sem evidencia de uma ferramenta compativel/i);
  assert.equal(calls, 2);
});


test('ferramenta irrelevante nao autoriza alegacao de escrita', () => {
  assert.equal(
    looksFabricated('O arquivo foi criado.', [
      { name: 'webSearch', effect: 'read', success: true },
    ]),
    true,
  );
});

test('ferramenta com erro nao autoriza alegacao de execucao', () => {
  assert.equal(
    looksFabricated('Executei o comando com sucesso.', [
      { name: 'runCommand', effect: 'execute', success: false, output: { error: 'timeout' } },
    ]),
    true,
  );
});

test('evidencia bem-sucedida precisa ter efeito compativel com a alegacao', () => {
  assert.equal(
    looksFabricated('Os testes passaram sem erros.', [
      { name: 'runCommand', effect: 'execute', success: true, output: { exitCode: 0 } },
    ]),
    false,
  );
});


test('pedido concreto sem ferramenta relevante falha mesmo sem alegacao explicita', async () => {
  const agent = new Agent('teste');
  agent.setTools({ writeFile: {} as any });
  let calls = 0;
  (agent as any).chatStream = async () => {
    calls++;
    return {
      text: 'Aqui esta o conteudo solicitado.',
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      toolCallCount: 0,
      toolExecutions: [],
      activatedSkills: [],
      finishReason: 'stop',
    };
  };
  const response = await agent.processMessage('Crie um arquivo no workspace.');
  assert.match(response, /nenhuma ferramenta relevante/i);
  assert.equal(calls, 2);
});
