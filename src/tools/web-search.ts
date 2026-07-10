import { tool } from 'ai';
import { z } from 'zod';
import { search, SafeSearchType } from 'duck-duck-scrape';
import { getConfig } from '../config/loader.js';

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const results = await search(query, {
    safeSearch: SafeSearchType.MODERATE,
    locale: 'pt-BR',
  });

  if (results.noResults || results.results.length === 0) {
    return [];
  }

  return results.results.slice(0, maxResults).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description.replace(/<\/?b>/g, ''),
  }));
}

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results: BraveWebResult[];
  };
}

async function searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY nao configurada');
  }

  const params = new URLSearchParams({
    q: query,
    count: String(maxResults),
    search_lang: 'pt',
    country: 'BR',
  });

  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Brave API retornou status ${response.status}`);
  }

  const data = (await response.json()) as BraveSearchResponse;
  const results = data.web?.results ?? [];

  return results.slice(0, maxResults).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

export const webSearchTool = tool({
  description: 'Pesquisar na web por informacoes atualizadas (DuckDuckGo com fallback Brave)',
  inputSchema: z.object({
    query: z.string().describe('O que pesquisar na web'),
  }),
  execute: async ({ query }) => {
    const config = getConfig();
    const maxResults = config.search.maxResults;

    // Step 1: Try DuckDuckGo
    try {
      const ddgResults = await searchDuckDuckGo(query, maxResults);
      if (ddgResults.length > 0) {
        return { results: ddgResults, source: 'duckduckgo' };
      }
    } catch {
      // DDG failed — fall through to Brave
    }

    // Step 2: Try Brave (if enabled and API key exists)
    if (config.search.braveSearch.enabled && process.env.BRAVE_SEARCH_API_KEY) {
      try {
        const braveResults = await searchBrave(query, maxResults);
        if (braveResults.length > 0) {
          return { results: braveResults, source: 'brave' };
        }
      } catch {
        // Brave also failed
      }
    }

    // Step 3: Both failed
    return { results: [], message: 'Nenhum resultado encontrado em nenhum mecanismo de busca.' };
  },
});
