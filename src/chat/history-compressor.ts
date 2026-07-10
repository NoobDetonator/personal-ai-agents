import { generateText, type ModelMessage } from 'ai';
import type { Agent } from '../agents/agent.js';

const RECENT_MESSAGES_TO_KEEP = 12;
const SUMMARY_PREFIX = '[Contexto anterior resumido]:';

export async function compressHistory(
  messages: ModelMessage[],
  agent: Agent,
): Promise<ModelMessage[]> {
  if (messages.length <= RECENT_MESSAGES_TO_KEEP + 2) {
    return messages;
  }

  const olderMessages = messages.slice(0, -RECENT_MESSAGES_TO_KEEP);
  const recentMessages = messages.slice(-RECENT_MESSAGES_TO_KEEP);

  let previousSummary = '';
  let messagesToSummarize = olderMessages;

  // Detect existing summary from prior compression
  if (
    olderMessages.length >= 2 &&
    typeof olderMessages[0].content === 'string' &&
    olderMessages[0].content.startsWith(SUMMARY_PREFIX)
  ) {
    previousSummary = olderMessages[0].content;
    messagesToSummarize = olderMessages.slice(2);
  }

  if (messagesToSummarize.length === 0) {
    return messages;
  }

  const conversationText = messagesToSummarize
    .map(m => {
      const role = m.role === 'user' ? 'Usuario' : 'Assistente';
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${role}: ${content}`;
    })
    .join('\n');

  const promptParts = [
    'Resuma a conversa abaixo de forma concisa, preservando:',
    '- Fatos importantes mencionados pelo usuario',
    '- Preferencias do usuario',
    '- Decisoes tomadas',
    '- Nomes proprios e dados especificos',
    '- Tarefas em andamento ou pendentes',
  ];

  if (previousSummary) {
    promptParts.push(`\nResumo anterior:\n${previousSummary}\n\nIncorpore o resumo anterior com as novas informacoes.`);
  }

  promptParts.push(`\nConversa para resumir:\n${conversationText}`);
  promptParts.push('\nEscreva um resumo objetivo em topicos. Maximo 500 palavras.');

  try {
    const result = await generateText({
      model: agent.getModel(),
      system: 'Voce e um sumarizador de conversas. Seja conciso e preciso. Responda apenas com o resumo.',
      messages: [{ role: 'user' as const, content: promptParts.join('\n') }],
      maxOutputTokens: 1024,
      temperature: 0.3,
    });

    return [
      { role: 'user' as const, content: `${SUMMARY_PREFIX} ${result.text}` },
      { role: 'assistant' as const, content: 'Entendido, mantenho esse contexto em mente.' },
      ...recentMessages,
    ];
  } catch {
    // Fallback: simple slice if summarization fails
    return messages.slice(-RECENT_MESSAGES_TO_KEEP);
  }
}
