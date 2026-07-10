import { generateText, type ModelMessage } from 'ai';
import { readMemory, writeMemory, appendDailyNote } from './personality.js';
import * as registry from './registry.js';
import type { Agent } from './agent.js';

const MIN_SESSION_MESSAGES = 6;

/**
 * Summarizes the current session into the agent's daily note.
 * Returns false when the session is too short to be worth summarizing.
 */
export async function summarizeSessionToDailyNote(agent: Agent, messages: ModelMessage[]): Promise<boolean> {
  const textMessages = messages.filter(m => typeof m.content === 'string');
  if (textMessages.length < MIN_SESSION_MESSAGES) return false;

  const conversationText = textMessages
    .map(m => `${m.role === 'user' ? 'Usuario' : 'Assistente'}: ${m.content as string}`)
    .join('\n')
    .slice(-8000);

  const result = await generateText({
    model: agent.getModel(),
    system: 'Voce resume sessoes de conversa em 1-3 frases objetivas. Responda apenas com o resumo.',
    messages: [{
      role: 'user' as const,
      content: `Resuma esta sessao em 1-3 frases (o que foi feito, decidido ou pendente):\n\n${conversationText}`,
    }],
    maxOutputTokens: 300,
    temperature: 0.3,
  });

  const summary = result.text.replace(/\s+/g, ' ').trim();
  if (!summary) return false;

  appendDailyNote(agent.id, `Resumo de sessao: ${summary}`);
  return true;
}

const MEMORY_LINE_THRESHOLD = 80;
const RECENT_ENTRIES_TO_KEEP = 30;
const SUMMARY_SECTION = '## Resumo Historico';

const activeSummarizations = new Set<string>();

export async function summarizeMemoryIfNeeded(agentId: string): Promise<void> {
  if (activeSummarizations.has(agentId)) return;

  const memory = readMemory(agentId);
  if (!memory) return;

  const lines = memory.split('\n');
  if (lines.length <= MEMORY_LINE_THRESHOLD) return;

  activeSummarizations.add(agentId);

  try {
    await performSummarization(agentId, memory);
  } finally {
    activeSummarizations.delete(agentId);
  }
}

interface MemorySection {
  header: string;
  body: string;
}

function parseSections(memory: string): MemorySection[] {
  const sections: MemorySection[] = [];
  const lines = memory.split('\n');

  let currentHeader = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentHeader) {
        sections.push({ header: currentHeader, body: currentBody.join('\n') });
      }
      currentHeader = line;
      currentBody = [];
    } else if (line.startsWith('# ') && !line.startsWith('## ')) {
      continue;
    } else if (!currentHeader) {
      continue;
    } else {
      currentBody.push(line);
    }
  }

  if (currentHeader) {
    sections.push({ header: currentHeader, body: currentBody.join('\n') });
  }

  return sections;
}

async function performSummarization(agentId: string, memory: string): Promise<void> {
  const sections = parseSections(memory);

  const existingSummary = sections.find(s => s.header === SUMMARY_SECTION);
  const contentSections = sections.filter(s => s.header !== SUMMARY_SECTION);

  const sectionsWithSplit = contentSections.map(section => {
    const entries = section.body
      .split('\n')
      .filter(line => line.trim().startsWith('- ') && !line.includes('(Nada registrado ainda)'));

    if (entries.length <= RECENT_ENTRIES_TO_KEEP) {
      return { header: section.header, oldEntries: [] as string[], recentEntries: entries };
    }

    const splitPoint = entries.length - RECENT_ENTRIES_TO_KEEP;
    return {
      header: section.header,
      oldEntries: entries.slice(0, splitPoint),
      recentEntries: entries.slice(splitPoint),
    };
  });

  const allOldEntries = sectionsWithSplit.flatMap(s =>
    s.oldEntries.map(e => `${s.header}: ${e}`)
  );

  if (allOldEntries.length === 0) return;

  const promptParts = [
    'Resuma as seguintes anotacoes de memoria de um agente de IA sobre o usuario.',
    'Mantenha todas as informacoes factuais importantes.',
    'Escreva em formato de topicos (bullet points) concisas.',
    'Preserve nomes, datas, preferencias especificas e decisoes.',
    'Maximo 20 topicos.',
  ];

  if (existingSummary) {
    promptParts.push(`\nResumo anterior existente:\n${existingSummary.body}`);
    promptParts.push('\nIncorpore o resumo anterior com as novas informacoes abaixo.');
  }

  promptParts.push(`\nAnotacoes antigas para incorporar no resumo:\n${allOldEntries.join('\n')}`);

  const agent = registry.getAgent(agentId);
  if (!agent) return;

  const result = await generateText({
    model: agent.getModel(),
    system: 'Voce e um assistente que resume anotacoes de memoria de forma concisa e precisa. Responda apenas com o resumo em topicos.',
    messages: [{ role: 'user' as const, content: promptParts.join('\n') }],
    maxOutputTokens: 1024,
    temperature: 0.3,
  });

  // Rebuild memory.md
  const newMemoryParts: string[] = [];

  newMemoryParts.push('# Memoria\n');
  newMemoryParts.push('Este arquivo contem coisas que eu lembro sobre nosso historico juntos.');
  newMemoryParts.push('Eu atualizo este arquivo automaticamente durante nossas conversas.\n');

  newMemoryParts.push(SUMMARY_SECTION);
  newMemoryParts.push(result.text);
  newMemoryParts.push('');

  for (const section of sectionsWithSplit) {
    newMemoryParts.push(section.header);
    if (section.recentEntries.length > 0) {
      newMemoryParts.push(section.recentEntries.join('\n'));
    } else {
      newMemoryParts.push('- (Nada registrado ainda)');
    }
    newMemoryParts.push('');
  }

  writeMemory(agentId, newMemoryParts.join('\n'));
}
