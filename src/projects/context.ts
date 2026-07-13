import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de execução que acompanha toda chamada iniciada por um projeto
 * (chat, delegação, schedule, heartbeat). As ferramentas de arquivo e shell
 * consomem `projectRoot` para confinar acesso ao diretório do projeto. Ver
 * docs/adr/0002-project-execution-context.md.
 */
export interface ProjectExecutionContext {
  /** UUID do projeto (ou o id sentinela 'legacy'). */
  projectId: string;
  /**
   * Caminho ABSOLUTO da raiz de confinamento do projeto (o diretório de
   * arquivos). Sempre resolvido pelo backend a partir de projectId — nunca
   * recebido do frontend.
   */
  projectRoot: string;
  conversationId?: string;
  runId?: string;
  /** Modelo efetivo herdado do projeto ou sobrescrito pela conversa. */
  model?: string;
  provider?: string;
  /** Mensagem humana que iniciou o turno atual; usada para preservar fatos ditados literalmente. */
  userMessage?: string;
}

const storage = new AsyncLocalStorage<ProjectExecutionContext>();

/**
 * Estabelece o contexto do projeto para toda a árvore assíncrona de `fn`.
 * É a única forma de ativar um contexto; as tools apenas o leem.
 */
export function runWithProjectContext<T>(ctx: ProjectExecutionContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Contexto ativo, ou undefined fora de um run de projeto (ex.: CLI legada). */
export function getProjectContext(): ProjectExecutionContext | undefined {
  return storage.getStore();
}

/** Contexto ativo; lança se ausente. Para caminhos que exigem projeto. */
export function requireProjectContext(): ProjectExecutionContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('Nenhum ProjectExecutionContext ativo para esta operação.');
  }
  return ctx;
}
