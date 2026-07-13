export type ToolEffect =
  | 'read'
  | 'write'
  | 'delete'
  | 'execute'
  | 'create'
  | 'update'
  | 'communicate'
  | 'unknown';

export interface ToolExecutionRecord {
  toolCallId?: string;
  name: string;
  effect: ToolEffect;
  success: boolean;
  output?: unknown;
}

const TOOL_EFFECTS: Record<string, ToolEffect> = {
  readFile: 'read',
  listFiles: 'read',
  webSearch: 'read',
  readWebPage: 'read',
  searchConversations: 'read',
  readMemory: 'read',
  readSoul: 'read',
  readDaily: 'read',
  readDeepMemory: 'read',
  listSkills: 'read',
  useSkill: 'read',
  listAgents: 'read',
  listSubordinates: 'read',
  listAgentProfiles: 'read',
  listTasks: 'read',
  listSchedules: 'read',
  checkMessages: 'read',
  getCurrentTime: 'read',
  getSystemInfo: 'read',

  writeFile: 'write',
  appendFile: 'write',
  editFile: 'write',
  saveMemory: 'write',
  appendDailyNote: 'write',
  saveDeepMemory: 'write',
  seedAgentMemory: 'write',

  deleteFile: 'delete',
  deleteAgent: 'delete',
  deleteTask: 'delete',
  clearBoard: 'delete',
  deleteConversation: 'delete',
  clearConversations: 'delete',
  deleteSchedule: 'delete',

  runCommand: 'execute',

  createAgent: 'create',
  createTask: 'create',
  createSchedule: 'create',
  createSkill: 'create',

  configureAgent: 'update',
  updateTaskStatus: 'update',
  updateSkill: 'update',
  updateUserProfile: 'update',
  editSoul: 'update',

  sendMessage: 'communicate',
  delegateTask: 'communicate',
  delegateTasks: 'communicate',
};

export function getToolEffect(toolName: string): ToolEffect {
  return TOOL_EFFECTS[toolName] ?? 'unknown';
}

export function isToolOutputSuccess(output: unknown): boolean {
  if (output instanceof Error) return false;
  if (typeof output === 'string') {
    return !/^\s*(?:\[?erro\]?|error|falha)\b/i.test(output);
  }
  if (output && typeof output === 'object') {
    const value = output as Record<string, unknown>;
    if (value.error) return false;
    if (value.success === false) return false;
    if (typeof value.exitCode === 'number' && value.exitCode !== 0) return false;
  }
  return true;
}

export function successfulEffects(records: ToolExecutionRecord[]): Set<ToolEffect> {
  return new Set(records.filter(record => record.success).map(record => record.effect));
}
