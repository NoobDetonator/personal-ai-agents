import { tool } from 'ai';
import { z } from 'zod';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_CONTENT_CHARS = 12000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, m => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

  const text = html
    // Drop non-content blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ')
    // Block-level tags become line breaks
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ');

  const cleaned = decodeEntities(text)
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n');

  return { title, text: cleaned };
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const version = isIP(normalized);

  if (version === 4) {
    const [a, b, c] = normalized.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (version === 6) {
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:')) return true;
    const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
    return (
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xff00) === 0xff00 ||
      normalized.startsWith('2001:db8:')
    );
  }

  return true;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Apenas URLs http/https sao suportadas.');
  }
  if (url.username || url.password) {
    throw new Error('URLs com credenciais nao sao permitidas.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Enderecos locais nao sao permitidos.');
  }

  const literalVersion = isIP(hostname);
  const addresses = literalVersion
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(entry => isPrivateAddress(entry.address))) {
    throw new Error('O endereco resolve para uma rede privada ou reservada.');
  }
}

async function fetchPublicPage(startUrl: URL): Promise<{ response: Response; finalUrl: URL }> {
  let current = startUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      signal: AbortSignal.timeout(20000),
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PersonalAIAgents/3.0',
        'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirecionamento sem destino.');
      if (redirects === MAX_REDIRECTS) throw new Error('Limite de redirecionamentos excedido.');
      current = new URL(location, current);
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error('Limite de redirecionamentos excedido.');
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('Resposta excede o limite de 1 MB.');
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Resposta excede o limite de 1 MB.');
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export const readWebPageTool = tool({
  description:
    'Ler o conteudo de uma pagina web como texto. Use apos webSearch para ler as paginas dos resultados, ou quando o usuario passar uma URL.',
  inputSchema: z.object({
    url: z.string().describe('URL completa da pagina (http/https)'),
  }),
  execute: async ({ url }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { error: `URL invalida: ${url}` };
    }

    try {
      const { response, finalUrl } = await fetchPublicPage(parsed);
      if (!response.ok) {
        return { error: `Pagina retornou status ${response.status}` };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const raw = await readLimitedBody(response);
      const resolvedUrl = finalUrl.toString();

      if (contentType.includes('application/json')) {
        return {
          url: resolvedUrl,
          contentType: 'json',
          content: raw.length > MAX_CONTENT_CHARS ? raw.slice(0, MAX_CONTENT_CHARS) + '\n... [truncado]' : raw,
        };
      }

      const { title, text } = htmlToText(raw);
      return {
        url: resolvedUrl,
        title,
        content: text.length > MAX_CONTENT_CHARS ? text.slice(0, MAX_CONTENT_CHARS) + '\n... [truncado]' : text,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'erro desconhecido';
      return { error: `Falha ao buscar pagina: ${msg}` };
    }
  },
});
