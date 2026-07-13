import type http from 'node:http';
import { getConfig } from '../../config/loader.js';
import { getAvailableModels } from '../../config/models.js';
import {
  assignAgentToProject,
  createProject,
  deleteProject,
  getProject,
  getProjectSettings,
  listProjects,
  updateProject,
  updateProjectSettings,
} from '../../projects/service.js';
import { createProjectConversation, listProjectConversations } from '../../projects/conversation-service.js';
import { listProjectTemplates } from '../../projects/templates.js';
import { auditEvent, exportProjectData, ProjectDataError } from '../../projects/data-service.js';
import { readProjectBackup } from '../../projects/backup-service.js';
import { HttpError, json, readBody, setSecurityHeaders } from '../http.js';

export function apiProjects(params: URLSearchParams): unknown {
  const status = params.get('status');
  return listProjects(status === 'archived' || status === 'active' ? status : undefined);
}

export function apiProjectDetail(id: string): unknown | null {
  const project = getProject(id);
  if (!project) return null;
  return {
    project,
    settings: getProjectSettings(id),
    conversations: listProjectConversations(id, { includeArchived: true }),
  };
}

export async function handleCreateProject(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readBody(req);
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Nome do projeto e obrigatorio');
  if (name.length > 120) throw new HttpError(400, 'Nome muito longo');
  const templateId = body.templateId != null ? String(body.templateId) : 'blank';
  if (!listProjectTemplates().some(template => template.id === templateId)) {
    throw new HttpError(400, 'Template de projeto invalido.');
  }

  const project = createProject({
    name,
    description: body.description != null ? String(body.description) : null,
    defaultModel: body.defaultModel != null ? String(body.defaultModel) : null,
    defaultProvider: body.defaultProvider != null ? String(body.defaultProvider) : null,
    templateId,
  });

  let conversationId: string | null = null;
  try {
    if (body.createInitialConversation) {
      const defaultAgent = getConfig().defaultAgent;
      const defaultConfig = getConfig().agents[defaultAgent];
      if (!defaultConfig) throw new Error('Agente padrao nao encontrado.');
      assignAgentToProject(project.id, defaultAgent, {
        role: defaultConfig.role ?? null,
        team: defaultConfig.team ?? null,
      });
      conversationId = createProjectConversation(project.id, defaultAgent, {
        title: 'Conversa inicial',
        createdBy: 'web',
      });
    }
  } catch (error) {
    deleteProject(project.id, project.name);
    throw error;
  }
  json(res, 201, { project, conversationId });
}

export async function handlePatchProject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
): Promise<void> {
  const body = await readBody(req);
  const status = body.status === 'active' || body.status === 'archived' ? body.status : undefined;
  const updated = updateProject(id, {
    name: body.name != null ? String(body.name) : undefined,
    description: body.description !== undefined ? (body.description === null ? null : String(body.description)) : undefined,
    status,
  });
  if (updated) json(res, 200, { project: updated });
  else json(res, 404, { error: 'projeto nao encontrado' });
}

export async function handleDeleteProject(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
): Promise<void> {
  const body = await readBody(req);
  const result = deleteProject(id, String(body.confirmName ?? ''));
  json(res, result.ok ? 200 : 400, result.ok ? { success: true } : { error: result.error });
}

export async function handleProjectSettings(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string,
): Promise<void> {
  if (!getProject(projectId)) return json(res, 404, { error: 'projeto nao encontrado' });
  const body = await readBody(req);
  const patch: Parameters<typeof updateProjectSettings>[1] = {};
  if (body.defaultModel === null) {
    patch.default_model = null;
    patch.default_provider = null;
  } else if (typeof body.defaultModel === 'string') {
    const model = getAvailableModels().find(item => item.id === body.defaultModel);
    if (!model) throw new HttpError(400, 'Modelo invalido.');
    patch.default_model = model.id;
    patch.default_provider = model.provider;
  }
  if (body.shellMode === null || body.shellMode === 'auto' || body.shellMode === 'confirm' || body.shellMode === 'off') {
    patch.shell_mode = body.shellMode as string | null;
  }
  if (body.delegationTimeoutSec === null) patch.delegation_timeout_sec = null;
  else if (typeof body.delegationTimeoutSec === 'number' && body.delegationTimeoutSec >= 10 && body.delegationTimeoutSec <= 3600) {
    patch.delegation_timeout_sec = Math.floor(body.delegationTimeoutSec);
  }
  if (body.maxConcurrency === null) patch.max_concurrency = null;
  else if (typeof body.maxConcurrency === 'number' && body.maxConcurrency >= 1 && body.maxConcurrency <= 16) {
    patch.max_concurrency = Math.floor(body.maxConcurrency);
  }
  if (typeof body.memoryEnabled === 'boolean') patch.memory_enabled = body.memoryEnabled ? 1 : 0;
  const settings = updateProjectSettings(projectId, patch);
  auditEvent(projectId, 'settings.update', 'project', projectId, { fields: Object.keys(patch) });
  json(res, 200, { settings });
}

export function downloadProjectExport(res: http.ServerResponse, projectId: string): void {
  const project = getProject(projectId);
  if (!project) throw new ProjectDataError(404, 'Projeto nao encontrado.');
  const body = Buffer.from(JSON.stringify(exportProjectData(projectId), null, 2));
  const safeName = project.slug.replace(/[^a-z0-9-]/gi, '-');
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-export.json"`);
  res.writeHead(200);
  res.end(body);
}

export function downloadProjectBackup(res: http.ServerResponse, projectId: string, backupId: string): void {
  const backup = readProjectBackup(projectId, backupId);
  setSecurityHeaders(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(backup.body.length));
  res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
  res.writeHead(200);
  res.end(backup.body);
}
