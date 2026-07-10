import { tool } from 'ai';
import { z } from 'zod';
import { getConfig } from '../config/loader.js';

export const getCurrentTimeTool = tool({
  description: 'Obter a data e hora atual',
  inputSchema: z.object({}),
  execute: async () => {
    const config = getConfig();
    const now = new Date().toLocaleString('pt-BR', {
      timeZone: config.scheduler.timezone,
      dateStyle: 'full',
      timeStyle: 'medium',
    });
    return { dateTime: now, timezone: config.scheduler.timezone };
  },
});

export const getSystemInfoTool = tool({
  description: 'Obter informacoes sobre o sistema e configuracao atual',
  inputSchema: z.object({}),
  execute: async () => {
    const config = getConfig();
    return {
      aiProvider: config.ai.provider,
      aiModel: config.ai.model,
      timezone: config.scheduler.timezone,
      schedulerEnabled: config.scheduler.enabled,
      language: config.display.language,
    };
  },
});
