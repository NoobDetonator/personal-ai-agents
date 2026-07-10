/**
 * Contrato minimo de um canal de comunicacao com o usuario.
 *
 * O terminal (src/chat/cli.ts) e o primeiro canal. Canais futuros
 * (ex: Telegram) implementam esta interface e sao registrados no startup:
 * recebem mensagens do usuario via onMessage e entregam respostas/notificacoes
 * proativas (scheduler, heartbeat) via deliver.
 */
export interface Channel {
  /** Identificador do canal (ex: "terminal", "telegram"). */
  id: string;

  /** Entrega uma mensagem proativa ao usuario (resultado de cron, heartbeat, etc). */
  deliver(text: string): Promise<void>;

  /** Registra o handler chamado a cada mensagem recebida do usuario. */
  onMessage(handler: (text: string) => Promise<void>): void;

  /** Inicia o canal (conexao, polling, prompt loop...). */
  start(): Promise<void>;

  /** Encerra o canal. */
  stop(): Promise<void>;
}
