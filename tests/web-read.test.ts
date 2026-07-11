import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWebPageTool } from '../src/tools/web-read.js';

const exec = (readWebPageTool as any).execute as (args: { url: string }) => Promise<any>;

// Marcadores de bloqueio deliberado (vs. falha de rede)
const BLOCK_MARKERS = ['rede privada', 'locais nao sao permitidos', 'credenciais', 'http/https'];

async function expectBlocked(url: string): Promise<void> {
  const result = await exec({ url });
  assert.ok('error' in result, `esperava bloqueio para ${url}`);
  assert.ok(
    BLOCK_MARKERS.some(marker => String(result.error).includes(marker)),
    `erro nao indica bloqueio deliberado: ${result.error}`,
  );
}

test('bloqueia loopback IPv4 literal', () => expectBlocked('http://127.0.0.1:3131/api/state'));
test('bloqueia localhost por nome', () => expectBlocked('http://localhost:3131/'));
test('bloqueia sufixos .localhost e .local', async () => {
  await expectBlocked('http://foo.localhost/');
  await expectBlocked('http://impressora.local/');
});
test('bloqueia metadata de cloud (link-local)', () => expectBlocked('http://169.254.169.254/latest/meta-data/'));
test('bloqueia RFC1918', async () => {
  await expectBlocked('http://10.0.0.1/');
  await expectBlocked('http://172.16.0.1/');
  await expectBlocked('http://192.168.1.1/');
});
test('bloqueia IPv6 loopback e link-local', async () => {
  await expectBlocked('http://[::1]/');
  await expectBlocked('http://[fe80::1]/');
});
test('bloqueia credenciais embutidas na URL', () => expectBlocked('https://user:pass@example.com/'));
test('bloqueia protocolos nao-http', () => expectBlocked('file:///etc/passwd'));

test('permite site publico (pulado sem rede)', async t => {
  const result = await exec({ url: 'https://example.com/' });
  if ('error' in result && !BLOCK_MARKERS.some(m => String(result.error).includes(m))) {
    t.skip(`sem acesso a rede: ${result.error}`);
    return;
  }
  assert.ok(!('error' in result), `site publico foi bloqueado indevidamente: ${result.error}`);
});
