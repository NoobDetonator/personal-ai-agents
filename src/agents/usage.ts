/**
 * Contador de uso da sessao atual (desde o boot). Alimentado por
 * Agent.chat/chatStream — cobre chat, grupos, delegacoes, cron e heartbeat.
 * O custo e acumulado por chamada com o preco do modelo usado nela.
 * Cada chamada tambem vira uma linha em usage_events (historico para analytics).
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { getProjectContext } from '../projects/context.js';

// Precos por 1M de tokens (USD), da doc oficial de cada provedor.
// Modelos fora da tabela: custo nao estimado (mostra so tokens).
const PRICING: Record<string, { inMiss: number; inHit: number; out: number }> = {
  'deepseek-v4-flash': { inMiss: 0.14, inHit: 0.0028, out: 0.28 },
  'deepseek-v4-pro': { inMiss: 0.435, inHit: 0.003625, out: 0.87 },
  // legados (ate 2026-07-24)
  'deepseek-chat': { inMiss: 0.14, inHit: 0.0028, out: 0.28 },
  'deepseek-reasoner': { inMiss: 0.14, inHit: 0.0028, out: 0.28 },
  // Z.AI (tabela de precos da doc oficial)
  'glm-5.2': { inMiss: 1.4, inHit: 0.26, out: 4.4 },
  'glm-5.1': { inMiss: 1.0, inHit: 0.2, out: 3.2 },
  'glm-4.6': { inMiss: 0.6, inHit: 0.11, out: 2.2 },
  'glm-4.5-air': { inMiss: 0.2, inHit: 0.03, out: 1.1 },
  'glm-4.5-flash': { inMiss: 0, inHit: 0, out: 0 },
};

let calls = 0;
let inputTokens = 0;
let outputTokens = 0;
let cachedInputTokens = 0;
let costUsd = 0;
let costKnown = true; // false se alguma chamada usou modelo sem preco na tabela
let unmeteredCalls = 0;

/** Custo (USD) de uma chamada; null quando o modelo nao tem preco tabelado. */
export function computeCallCost(input: number, output: number, cached: number, modelId: string): number | null {
  const price = PRICING[modelId];
  if (!price) return null;
  const miss = Math.max(0, input - cached);
  return (miss * price.inMiss + cached * price.inHit + output * price.out) / 1_000_000;
}

export interface UsageMeta {
  agentId?: string;
  kind?: 'chat' | 'recall' | 'summary';
  durationMs?: number;
  /** false quando timeout/cancelamento permite apenas uma contagem parcial. */
  usageKnown?: boolean;
}

export function addUsage(input: number, output: number, cached: number, modelId: string, meta?: UsageMeta): void {
  calls++;
  inputTokens += input;
  outputTokens += output;
  cachedInputTokens += cached;

  const callCost = computeCallCost(input, output, cached, modelId);
  const usageKnown = meta?.usageKnown !== false;
  if (!usageKnown) unmeteredCalls++;
  if (callCost != null) {
    costUsd += callCost;
  }
  if (callCost == null || !usageKnown) {
    costKnown = false;
  }

  // Historico persistente (fail-open: metricas nunca quebram uma chamada,
  // ex.: testes que usam addUsage sem banco inicializado).
  try {
    getDb().prepare(
      `INSERT INTO usage_events (id, agent_id, model, kind, input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, project_id, usage_known)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      meta?.agentId ?? null,
      modelId,
      meta?.kind ?? 'chat',
      input,
      output,
      cached,
      callCost,
      meta?.durationMs ?? null,
      getProjectContext()?.projectId ?? 'legacy',
      usageKnown ? 1 : 0,
    );
  } catch {
    // sem banco: mantem apenas os contadores de sessao
  }
}

export interface SessionUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheHitRate: number; // 0..1
  costUsd: number | null; // null quando algum modelo nao tem preco tabelado
  minimumCostUsd: number;
  costKnown: boolean;
  unmeteredCalls: number;
}

export function getSessionUsage(): SessionUsage {
  return {
    calls,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : 0,
    costUsd: costKnown ? costUsd : null,
    minimumCostUsd: costUsd,
    costKnown,
    unmeteredCalls,
  };
}
