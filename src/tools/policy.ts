const WORKER_BASE_TOOLS = new Set([
  'readFile', 'writeFile', 'appendFile', 'editFile', 'listFiles',
  'webSearch', 'readWebPage',
  'listSkills', 'useSkill',
  'readMemory', 'saveMemory', 'readSoul', 'appendDailyNote', 'saveDeepMemory',
  'searchConversations', 'sendMessage', 'checkMessages',
  'getCurrentTime', 'getSystemInfo',
]);

const TECHNICAL_PROFILES = new Set([
  'programador', 'revisor-codigo', 'executor-cli', 'engenheiro-seguranca',
  'designer', 'analista-dados', 'automacao',
]);

const MEMORY_PROFILES = new Set(['curador-memoria']);

/** Politica explicita de menor privilegio para o toolset entregue ao modelo. */
export function allowedToolNamesForAgent(
  role: string,
  profile: string | null | undefined,
  availableNames: Iterable<string>,
): string[] {
  const available = Array.from(availableNames);
  if (role === 'principal') return available;

  if (role === 'manager') {
    return available.filter(name =>
      ![
        'createSkill', 'updateSkill', 'updateUserProfile', 'finishOnboarding', 'editSoul',
        'deleteConversation', 'clearConversations', 'createSchedule', 'deleteSchedule',
      ].includes(name),
    );
  }

  const allowed = new Set(WORKER_BASE_TOOLS);
  if (profile && TECHNICAL_PROFILES.has(profile)) {
    allowed.add('runCommand');
    allowed.add('deleteFile');
  }
  if (profile && MEMORY_PROFILES.has(profile)) {
    allowed.add('readDailyNote');
    allowed.add('readDeepMemory');
  }
  return available.filter(name => allowed.has(name));
}
