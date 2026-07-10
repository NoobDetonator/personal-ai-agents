import type { ToolSet } from 'ai';
import { readFileTool, writeFileTool, appendFileTool, editFileTool, deleteFileTool, listFilesTool } from './file-ops.js';
import { webSearchTool } from './web-search.js';
import { readWebPageTool } from './web-read.js';
import { createShellTools } from './shell.js';
import { searchConversationsTool, createConversationMgmtTools } from './conversation-search.js';
import { createSchedulingTools } from './scheduling.js';
import { createMemoryTools } from './memory-ops.js';
import { createCommTools } from './agent-comm.js';
import { createAgentManagementTools, listAgentsTool } from './agent-mgmt.js';
import { getCurrentTimeTool, getSystemInfoTool } from './system-info.js';
import { listSkillsTool, useSkillTool, createSkillTool, updateSkillTool } from '../skills/tools.js';
import { createTaskTools } from './tasks.js';
import { createGroupTools } from './group-tool.js';
import { getMcpTools } from '../mcp/manager.js';
import { getConfig } from '../config/loader.js';
import type { Agent } from '../agents/agent.js';

export function buildToolSet(
  agentId: string,
  dispatchFn: (from: string, to: string, content: string) => Promise<string>,
  onAgentCreated?: (agent: Agent) => void,
): ToolSet {
  const schedulingTools = createSchedulingTools(agentId);
  const memoryTools = createMemoryTools(agentId);
  const commTools = createCommTools(agentId, dispatchFn);
  const agentMgmtTools = createAgentManagementTools(agentId, onAgentCreated);
  const conversationMgmtTools = createConversationMgmtTools(agentId);

  // Leaders (principal and managers) get the company board + delegation tools
  const role = getConfig().agents[agentId]?.role ?? 'worker';
  const leaderTools = role === 'principal' || role === 'manager'
    ? { ...createTaskTools(agentId), ...createGroupTools(agentId) }
    : {};

  return {
    ...getMcpTools(),
    ...leaderTools,

    // File operations
    readFile: readFileTool,
    writeFile: writeFileTool,
    appendFile: appendFileTool,
    editFile: editFileTool,
    deleteFile: deleteFileTool,
    listFiles: listFilesTool,

    // Web
    webSearch: webSearchTool,
    readWebPage: readWebPageTool,

    // Shell
    runCommand: createShellTools(agentId).runCommand,

    // Scheduling
    createSchedule: schedulingTools.createSchedule,
    listSchedules: schedulingTools.listSchedules,
    deleteSchedule: schedulingTools.deleteSchedule,

    // Skills
    listSkills: listSkillsTool,
    useSkill: useSkillTool,
    createSkill: createSkillTool,
    updateSkill: updateSkillTool,

    // Memory
    readMemory: memoryTools.readMemory,
    saveMemory: memoryTools.saveMemory,
    readSoul: memoryTools.readSoul,
    editSoul: memoryTools.editSoul,
    appendDailyNote: memoryTools.appendDailyNote,
    readDailyNote: memoryTools.readDailyNote,
    saveDeepMemory: memoryTools.saveDeepMemory,
    readDeepMemory: memoryTools.readDeepMemory,
    updateUserProfile: memoryTools.updateUserProfile,
    finishOnboarding: memoryTools.finishOnboarding,
    searchConversations: searchConversationsTool,
    deleteConversation: conversationMgmtTools.deleteConversation,
    clearConversations: conversationMgmtTools.clearConversations,

    // Agent management (hierarchy-aware)
    createAgent: agentMgmtTools.createAgent,
    configureAgent: agentMgmtTools.configureAgent,
    seedAgentMemory: agentMgmtTools.seedAgentMemory,
    listSubordinates: agentMgmtTools.listSubordinates,
    deleteAgent: agentMgmtTools.deleteAgent,
    listAgents: listAgentsTool,

    // Inter-agent communication
    sendMessage: commTools.sendMessage,
    checkMessages: commTools.checkMessages,

    // System
    getCurrentTime: getCurrentTimeTool,
    getSystemInfo: getSystemInfoTool,
  };
}
