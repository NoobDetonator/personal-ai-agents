import type http from 'node:http';
import { getConfig } from '../../config/loader.js';
import { getDb } from '../../db/connection.js';
import { getProject, assignAgentToProject } from '../../projects/service.js';
import {
  createProjectConversation,
  patchConversation,
} from '../../projects/conversation-service.js';
import { deleteProjectConversation } from '../../projects/data-service.js';
import { startChatRun } from '../../chat/run-service.js';
import { getRun, listRunEvents } from '../../db/run-helpers.js';
import { HttpError, json, readBody } from '../http.js';
import { getAvailableModels } from '../../config/models.js';

export async function handleCreateConversation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string,
): Promise<void> {
  if (!getProject(projectId)) return json(res, 404, { error: 'projeto nao encontrado' });
  const body = await readBody(req);
  const agentId = body.agentId != null ? String(body.agentId) : getConfig().defaultAgent;
  if (!/^[a-z0-9_-]+$/i.test(agentId)) throw new HttpError(400, 'agentId invalido');
  const agentConfig = getConfig().agents[agentId];
  if (!agentConfig) throw new HttpError(404, 'agente nao encontrado');
  assignAgentToProject(projectId, agentId, {
    role: agentConfig.role ?? null,
    team: agentConfig.team ?? null,
  });
  const conversationId = createProjectConversation(projectId, agentId, {
    title: body.title != null ? String(body.title) : undefined,
    createdBy: 'web',
  });
  json(res, 201, { conversationId });
}

export async function handlePatchConversation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
): Promise<void> {
  const body = await readBody(req);
  const patch: Parameters<typeof patchConversation>[1] = {
    title: body.title != null ? String(body.title) : undefined,
    pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
    archived: typeof body.archived === 'boolean' ? body.archived : undefined,
  };
  if (body.model === null) {
    patch.modelOverride = null;
    patch.providerOverride = null;
  } else if (typeof body.model === 'string') {
    const model = getAvailableModels().find(candidate => candidate.id === body.model);
    if (!model) throw new HttpError(400, 'Modelo invalido ou indisponivel.');
    patch.modelOverride = model.id;
    patch.providerOverride = model.provider;
  }
  const ok = patchConversation(id, {
    ...patch,
  });
  json(res, ok ? 200 : 404, { success: ok });
}

export async function handleDeleteConversationData(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  conversationId: string,
): Promise<void> {
  const body = await readBody(req);
  const row = getDb().prepare("SELECT COALESCE(project_id, 'legacy') AS projectId FROM conversations WHERE id = ?")
    .get(conversationId) as { projectId: string } | undefined;
  if (!row) return json(res, 404, { error: 'conversa nao encontrada' });
  deleteProjectConversation(row.projectId, conversationId, String(body.confirmId ?? ''));
  json(res, 200, { success: true });
}

export async function handlePostMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  conversationId: string,
): Promise<void> {
  const body = await readBody(req);
  const text = String(body.text ?? '').trim();
  if (!text) throw new HttpError(400, 'Texto da mensagem e obrigatorio');
  try {
    const { runId } = startChatRun({ conversationId, text });
    json(res, 202, { runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha ao iniciar execucao';
    json(res, message.includes('execucao ativa') ? 409 : 404, { error: message });
  }
}

export function apiRunEvents(runId: string, params: URLSearchParams): unknown | null {
  const run = getRun(runId);
  if (!run) return null;
  const after = Math.max(0, Number(params.get('after') ?? '0') || 0);
  return { run, events: listRunEvents(runId, after) };
}
