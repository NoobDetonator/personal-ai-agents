import { getAgent } from '../agents/registry.js';

const MAX_DEPTH = 3;
let currentDepth = 0;

export async function dispatchMessage(fromAgent: string, toAgent: string, content: string): Promise<string> {
  if (currentDepth >= MAX_DEPTH) {
    return `[Limite de comunicacao atingido - nao posso responder agora]`;
  }

  const target = getAgent(toAgent);
  if (!target) {
    return `[Agente "${toAgent}" nao encontrado]`;
  }

  currentDepth++;
  try {
    const response = await target.processMessage(content, {
      context: `Voce recebeu uma mensagem do agente "${fromAgent}". Responda de forma direta.`,
    });
    return response;
  } catch (error) {
    return `[Erro ao comunicar com ${toAgent}: ${error instanceof Error ? error.message : 'desconhecido'}]`;
  } finally {
    currentDepth--;
  }
}
