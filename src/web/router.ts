import fs from 'node:fs';
import type http from 'node:http';
import { getConfig } from '../config/loader.js';
import { getDb } from '../db/connection.js';
import { readUserProfile } from '../agents/user-profile.js';
import { listSkillMetas } from '../skills/loader.js';
import { getAvailableModels } from '../config/models.js';
import { cancelDelegation, listTaskRows } from '../tools/tasks.js';
import { WebSecurity } from './security.js';
import { HttpError, json, readBody, setSecurityHeaders } from './http.js';
import { serveStatic } from './static.js';
import { getProject, archiveProject } from '../projects/service.js';
import {
  createProjectDirectory, deleteProjectPath, diffProjectFile, listProjectFiles,
  readProjectFile, readProjectRawFile, renameProjectPath,
  searchProjectFiles, writeProjectFile,
} from '../projects/files-service.js';
import {
  auditEvent, clearProjectMemories, deleteProjectMemory, listAuditEvents,
  listProjectMemories, readProjectMemory,
} from '../projects/data-service.js';
import { listProjectConversations } from '../projects/conversation-service.js';
import { cancelRun } from '../chat/run-service.js';
import { listProjectTemplates } from '../projects/templates.js';
import { forkConversation } from '../db/conversation-helpers.js';
import {
  getProjectKnowledgeGraph, getVaultOverview, rebuildProjectKnowledge,
  recordMemoryFeedback, reflectProjectMemory, searchProjectVault,
} from '../memory/vault-service.js';
import {
  createProjectBackup, deleteProjectBackup, listProjectBackups,
} from '../projects/backup-service.js';
import {
  apiAgent, apiAnalytics, apiConversation, apiGroups, apiSchedules, apiState,
  handleConfirm, handleSettings,
} from './api/state.js';
import {
  apiProjectDetail, apiProjects, downloadProjectBackup, downloadProjectExport,
  handleCreateProject, handleDeleteProject, handlePatchProject, handleProjectSettings,
} from './api/projects.js';
import {
  apiRunEvents, handleCreateConversation, handleDeleteConversationData,
  handlePatchConversation, handlePostMessage,
} from './api/chat.js';
import { handleSse } from './sse.js';

const LOOPBACK_HOST = '127.0.0.1';

function apiDiagnostics(security: WebSecurity): unknown {
  const db = getDb();
  const quick = db.pragma('quick_check') as Array<Record<string, unknown>>;
  const counts: Record<string, number> = {};
  for (const table of ['projects', 'conversations', 'messages', 'runs', 'tasks', 'usage_events', 'audit_events']) {
    counts[table] = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  }
  return {
    status: quick.every(row => Object.values(row).includes('ok')) ? 'healthy' : 'degraded',
    version: '3.0.0',
    uptimeSec: Math.floor(process.uptime()),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    database: { quickCheck: quick, counts },
    web: {
      bind: LOOPBACK_HOST,
      remoteAccess: !!getConfig().web.publicUrl,
      sessionAuth: true,
      passwordConfigured: security.passwordConfigured,
      trustProxy: getConfig().web.trustProxy,
      sessionTtlMinutes: getConfig().web.sessionTtlMinutes,
      capabilities: getConfig().web.capabilities,
    },
    generatedAt: new Date().toISOString(),
  };
}

function serveProjectRaw(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId: string,
  filePath: string,
): void {
  const file = readProjectRawFile(projectId, filePath);
  setSecurityHeaders(res);
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('ETag', file.etag);
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(200);
  fs.createReadStream(file.absolute).pipe(res);
}

export async function routeAuthenticatedRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  security: WebSecurity,
): Promise<void> {
  const method = req.method ?? 'GET';
  const p = url.pathname;
if (method === 'GET' && p === '/api/events') return handleSse(res);
if (method === 'GET' && p === '/api/state') return json(res, 200, apiState(url.searchParams));
if (method === 'GET' && p === '/api/analytics') return json(res, 200, apiAnalytics(url.searchParams));
if (method === 'GET' && p === '/api/tasks') return json(res, 200, listTaskRows());
if (method === 'GET' && p === '/api/skills') return json(res, 200, listSkillMetas().map(s => ({ id: s.id, name: s.name, description: s.description })));
if (method === 'GET' && p === '/api/schedules') return json(res, 200, apiSchedules());
if (method === 'GET' && p === '/api/groups') return json(res, 200, apiGroups());
if (method === 'GET' && p === '/api/models') return json(res, 200, getAvailableModels());
if (method === 'GET' && p === '/api/profile') return json(res, 200, { profile: readUserProfile() });
if (method === 'GET' && p === '/api/diagnostics') return json(res, 200, apiDiagnostics(security));
if (method === 'GET' && p === '/api/audit') return json(res, 200, listAuditEvents(url.searchParams.get('project') ?? undefined));

const agentMatch = p.match(/^\/api\/agents\/([a-z0-9_-]+)$/);
if (method === 'GET' && agentMatch) {
  const data = apiAgent(agentMatch[1], url.searchParams.get('project'));
  return data ? json(res, 200, data) : json(res, 404, { error: 'agente nao encontrado' });
}

const convMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)$/);
if (method === 'GET' && convMatch) {
  const conversation = apiConversation(convMatch[1]);
  return conversation ? json(res, 200, conversation) : json(res, 404, { error: 'conversa nao encontrada' });
}

// --- Projects ---
if (method === 'GET' && p === '/api/project-templates') return json(res, 200, listProjectTemplates());
if (method === 'GET' && p === '/api/projects') return json(res, 200, apiProjects(url.searchParams));
if (method === 'POST' && p === '/api/projects') return await handleCreateProject(req, res);

const projectFilesMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/files$/i);
if (method === 'GET' && projectFilesMatch) {
  return json(res, 200, listProjectFiles(projectFilesMatch[1], url.searchParams.get('path') ?? ''));
}
if (method === 'POST' && projectFilesMatch) {
  const body = await readBody(req);
  if (body.kind !== 'directory') throw new HttpError(400, 'Tipo de item invalido.');
  const result = createProjectDirectory(projectFilesMatch[1], String(body.path ?? ''));
  auditEvent(projectFilesMatch[1], 'file.create_directory', 'file', result.path);
  return json(res, 201, result);
}

const projectRawMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/file\/raw$/i);
if (method === 'GET' && projectRawMatch) {
  return serveProjectRaw(req, res, projectRawMatch[1], url.searchParams.get('path') ?? '');
}

const projectFileMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/file$/i);
if (method === 'GET' && projectFileMatch) {
  return json(res, 200, readProjectFile(projectFileMatch[1], url.searchParams.get('path') ?? ''));
}
if (method === 'PATCH' && projectFileMatch) {
  const body = await readBody(req);
  if (typeof body.content !== 'string') throw new HttpError(400, 'Conteudo textual obrigatorio.');
  const create = req.headers['if-none-match'] === '*';
  const expectedEtag = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : null;
  const document = writeProjectFile(projectFileMatch[1], String(body.path ?? ''), body.content, { create, expectedEtag });
  auditEvent(projectFileMatch[1], create ? 'file.create' : 'file.update', 'file', document.path, { bytes: document.size });
  return json(res, create ? 201 : 200, { document });
}
if (method === 'DELETE' && projectFileMatch) {
  const body = await readBody(req);
  const expectedEtag = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : null;
  const result = deleteProjectPath(projectFileMatch[1], String(body.path ?? ''), String(body.confirmPath ?? ''), expectedEtag);
  auditEvent(projectFileMatch[1], 'file.delete', 'file', result.path, { kind: result.kind });
  return json(res, 200, { success: true, ...result });
}

const projectFileRenameMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/file\/rename$/i);
if (method === 'POST' && projectFileRenameMatch) {
  const body = await readBody(req);
  const expectedEtag = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : null;
  const result = renameProjectPath(projectFileRenameMatch[1], String(body.path ?? ''), String(body.destination ?? ''), expectedEtag);
  auditEvent(projectFileRenameMatch[1], 'file.rename', 'file', result.path, { source: String(body.path ?? '') });
  return json(res, 200, result);
}

const projectSearchMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/search$/i);
if (method === 'GET' && projectSearchMatch) {
  return json(res, 200, searchProjectFiles(projectSearchMatch[1], url.searchParams.get('q') ?? ''));
}

const projectDiffMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/diff$/i);
if (method === 'GET' && projectDiffMatch) {
  return json(res, 200, diffProjectFile(projectDiffMatch[1], url.searchParams.get('path') ?? ''));
}


const projectVaultMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/vault$/i);
if (method === 'GET' && projectVaultMatch) {
  return json(res, 200, searchProjectVault(projectVaultMatch[1], url.searchParams.get('q') ?? '', {
    status: url.searchParams.get('status') || undefined,
    type: url.searchParams.get('type') || undefined,
    agentId: url.searchParams.get('agent') || undefined,
    view: ['review', 'unlinked', 'feedback'].includes(url.searchParams.get('view') ?? '') ? url.searchParams.get('view') as 'review' | 'unlinked' | 'feedback' : undefined,
    limit: Number(url.searchParams.get('limit') ?? 80),
  }));
}

const projectVaultOverviewMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/vault\/overview$/i);
if (method === 'GET' && projectVaultOverviewMatch) {
  return json(res, 200, getVaultOverview(projectVaultOverviewMatch[1]));
}

const projectVaultGraphMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/vault\/graph$/i);
if (method === 'GET' && projectVaultGraphMatch) {
  const requestedLayer = url.searchParams.get('layer');
  const layer = requestedLayer === 'memory' || requestedLayer === 'code' ? requestedLayer : 'all';
  return json(res, 200, getProjectKnowledgeGraph(
    projectVaultGraphMatch[1], layer, Number(url.searchParams.get('limit') ?? 800),
  ));
}

const projectVaultReindexMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/vault\/reindex$/i);
if (method === 'POST' && projectVaultReindexMatch) {
  const result = rebuildProjectKnowledge(projectVaultReindexMatch[1]);
  auditEvent(projectVaultReindexMatch[1], 'vault.reindex', 'project', projectVaultReindexMatch[1], result);
  return json(res, 200, result);
}

const projectVaultFeedbackMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/vault\/feedback$/i);
if (method === 'POST' && projectVaultFeedbackMatch) {
  const body = await readBody(req);
  if (!['useful', 'dead_end', 'corrected'].includes(String(body.outcome))) {
    throw new HttpError(400, 'Resultado de memoria invalido.');
  }
  const id = recordMemoryFeedback({
    projectId: projectVaultFeedbackMatch[1],
    memoryId: typeof body.memoryId === 'string' ? body.memoryId : null,
    agentId: typeof body.agentId === 'string' ? body.agentId : null,
    question: String(body.question ?? ''),
    answer: typeof body.answer === 'string' ? body.answer : undefined,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
    outcome: body.outcome as 'useful' | 'dead_end' | 'corrected',
  });
  auditEvent(projectVaultFeedbackMatch[1], 'vault.feedback', 'memory', String(body.memoryId ?? ''), { outcome: body.outcome });
  return json(res, 201, { id });
}

const projectVaultReflectMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/vault\/reflect$/i);
if (method === 'POST' && projectVaultReflectMatch) {
  const result = reflectProjectMemory(projectVaultReflectMatch[1]);
  auditEvent(projectVaultReflectMatch[1], 'vault.reflect', 'project', projectVaultReflectMatch[1], result.outcomes);
  return json(res, 200, result);
}
const projectMemoriesMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/memories$/i);
if (projectMemoriesMatch) {
  const projectId = projectMemoriesMatch[1];
  if (method === 'GET') return json(res, 200, listProjectMemories(projectId));
  if (method === 'DELETE') {
    const body = await readBody(req);
    const removed = clearProjectMemories(projectId, String(body.confirmName ?? ''));
    return json(res, 200, { success: true, removed });
  }
}

const projectMemoryMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/memory$/i);
if (projectMemoryMatch) {
  const projectId = projectMemoryMatch[1];
  const memoryId = url.searchParams.get('id') ?? '';
  if (method === 'GET') return json(res, 200, readProjectMemory(projectId, memoryId));
  if (method === 'DELETE') {
    const body = await readBody(req);
    const removed = deleteProjectMemory(projectId, memoryId, String(body.confirmId ?? ''));
    return json(res, 200, { success: true, removed });
  }
}

const projectBackupsMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/backups$/i);
if (projectBackupsMatch) {
  if (method === 'GET') return json(res, 200, listProjectBackups(projectBackupsMatch[1]));
  if (method === 'POST') return json(res, 201, createProjectBackup(projectBackupsMatch[1]));
}

const projectBackupMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/backup$/i);
if (projectBackupMatch) {
  const backupId = url.searchParams.get('id') ?? '';
  if (method === 'GET') return downloadProjectBackup(res, projectBackupMatch[1], backupId);
  if (method === 'DELETE') {
    const body = await readBody(req);
    deleteProjectBackup(projectBackupMatch[1], backupId, String(body.confirmId ?? ''));
    return json(res, 200, { success: true });
  }
}

const projectExportMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/export$/i);
if (method === 'GET' && projectExportMatch) return downloadProjectExport(res, projectExportMatch[1]);

const projectSettingsMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/settings$/i);
if (method === 'PATCH' && projectSettingsMatch) return await handleProjectSettings(req, res, projectSettingsMatch[1]);

const projectAuditMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/audit$/i);
if (method === 'GET' && projectAuditMatch) return json(res, 200, listAuditEvents(projectAuditMatch[1]));

const projMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})$/i);
if (projMatch) {
  const pid = projMatch[1];
  if (method === 'GET') {
    const data = apiProjectDetail(pid);
    return data ? json(res, 200, data) : json(res, 404, { error: 'projeto nao encontrado' });
  }
  if (method === 'PATCH') return await handlePatchProject(req, res, pid);
  if (method === 'DELETE') return await handleDeleteProject(req, res, pid);
}

const projArchiveMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/archive$/i);
if (method === 'POST' && projArchiveMatch) {
  const ok = archiveProject(projArchiveMatch[1]);
  return json(res, ok ? 200 : 404, { success: ok });
}

const projConvMatch = p.match(/^\/api\/projects\/([a-z0-9-]{1,64})\/conversations$/i);
if (projConvMatch) {
  const pid = projConvMatch[1];
  if (method === 'GET') {
    if (!getProject(pid)) return json(res, 404, { error: 'projeto nao encontrado' });
    return json(res, 200, listProjectConversations(pid, { includeArchived: true }));
  }
  if (method === 'POST') return await handleCreateConversation(req, res, pid);
}

// --- Conversations (project-scoped) & runs ---
const convScopedMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)$/);
if (method === 'PATCH' && convScopedMatch) return await handlePatchConversation(req, res, convScopedMatch[1]);
if (method === 'DELETE' && convScopedMatch) return await handleDeleteConversationData(req, res, convScopedMatch[1]);

const convForkMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)\/fork$/);
if (method === 'POST' && convForkMatch) {
  const newId = forkConversation(convForkMatch[1]);
  return newId ? json(res, 201, { conversationId: newId }) : json(res, 404, { error: 'conversa nao encontrada' });
}

const convMsgMatch = p.match(/^\/api\/conversations\/([a-f0-9-]+)\/messages$/);
if (method === 'POST' && convMsgMatch) return await handlePostMessage(req, res, convMsgMatch[1]);

const runEventsMatch = p.match(/^\/api\/runs\/([a-f0-9-]+)\/events$/);
if (method === 'GET' && runEventsMatch) {
  const data = apiRunEvents(runEventsMatch[1], url.searchParams);
  return data ? json(res, 200, data) : json(res, 404, { error: 'run nao encontrado' });
}

const runCancelMatch = p.match(/^\/api\/runs\/([a-f0-9-]+)\/cancel$/);
if (method === 'POST' && runCancelMatch) {
  const ok = cancelRun(runCancelMatch[1]);
  return json(res, ok ? 200 : 404, { success: ok });
}

if (method === 'POST' && p === '/api/settings') return await handleSettings(req, res);
if (method === 'POST' && p === '/api/confirm') return await handleConfirm(req, res);
if (method === 'POST' && p === '/api/delegations/cancel') {
  const body = await readBody(req);
  const ok = cancelDelegation(String(body.id ?? ''));
  return json(res, ok ? 200 : 404, { success: ok });
}

if (p.startsWith('/api/')) return json(res, 404, { error: 'endpoint desconhecido' });
if (method === 'GET') return serveStatic(p, res);

res.setHeader('Allow', 'GET');
return json(res, 405, { error: 'metodo nao permitido' });
}
