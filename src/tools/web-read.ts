import { tool } from 'ai';
import { z } from 'zod';

const MAX_CONTENT_CHARS = 12000;

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
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'Apenas URLs http/https sao suportadas.' };
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PersonalAIAgents/2.0',
          'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
        },
      });

      if (!response.ok) {
        return { error: `Pagina retornou status ${response.status}` };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const raw = await response.text();

      if (contentType.includes('application/json')) {
        return {
          url,
          contentType: 'json',
          content: raw.length > MAX_CONTENT_CHARS ? raw.slice(0, MAX_CONTENT_CHARS) + '\n... [truncado]' : raw,
        };
      }

      const { title, text } = htmlToText(raw);
      return {
        url,
        title,
        content: text.length > MAX_CONTENT_CHARS ? text.slice(0, MAX_CONTENT_CHARS) + '\n... [truncado]' : text,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'erro desconhecido';
      return { error: `Falha ao buscar pagina: ${msg}` };
    }
  },
});
