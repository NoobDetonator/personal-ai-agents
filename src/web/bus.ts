import { EventEmitter } from 'node:events';

export type BusEventType =
  | 'stream_start'   // { agentId, agentName }
  | 'stream_delta'   // { agentId, text }
  | 'stream_end'     // { agentId, agentName, text }
  | 'tool_call'      // { agentId, toolName }
  | 'chat_message'   // { agentId, agentName, text }
  | 'tokens'         // { agentId, inputTokens, outputTokens }
  | 'system'         // { text }
  | 'error'          // { text }
  | 'group_header'   // { participants: string[] }
  | 'confirmations'  // { pending: Array<{id, message, command}> }
  | 'delegation'     // { id, from?, to, taskId?, toolName?, status: start|progress|done|failed|cancelled }
  | 'board_changed'  // { taskId?, action: 'deleted'|'cleared', count? }
  | 'conversation_changed'; // { conversationId, action: 'deleted' }

export interface BusEvent {
  type: BusEventType;
  payload: Record<string, unknown>;
  ts: number;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emitBus(type: BusEventType, payload: Record<string, unknown>): void {
  emitter.emit('event', { type, payload, ts: Date.now() } satisfies BusEvent);
}

export function onBusEvent(listener: (event: BusEvent) => void): () => void {
  emitter.on('event', listener);
  return () => emitter.off('event', listener);
}
