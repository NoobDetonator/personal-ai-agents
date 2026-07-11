import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { getConfig, updateConfig } from '../config/loader.js';
import { getDb } from '../db/connection.js';
import { askConfirmation } from '../chat/confirm.js';

const ROOT_DIR = process.cwd();
const PHYSICAL_ROOT_DIR = fs.realpathSync.native(ROOT_DIR);

// Characters that allow chaining/redirecting/substituting — commands containing
// them never bypass confirmation via the allowlist. `$` covers $() substitution
// (PowerShell e sh); newlines viram script multi-linha no powershell -Command.
const CHAIN_CHARS = /[;&|<>`$\r\n]/;

export function isAllowlisted(command: string, allowlist: string[]): boolean {
  const trimmed = command.trim();
  if (CHAIN_CHARS.test(trimmed)) return false;
  return allowlist.some(prefix => {
    const p = prefix.trim();
    return p.length > 0 && (trimmed === p || trimmed.startsWith(p + ' '));
  });
}

function canonicalizePath(targetPath: string): string | null {
  let existing = path.resolve(targetPath);
  const missingSegments: string[] = [];
  try {
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) return null;
      missingSegments.unshift(path.basename(existing));
      existing = parent;
    }
    return path.resolve(fs.realpathSync.native(existing), ...missingSegments);
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... [truncado: ${text.length - max} caracteres omitidos]`;
}

function runShell(command: string, cwd: string, timeoutSec: number): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise(resolve => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, windowsHide: true })
      : spawn('/bin/sh', ['-c', command], { cwd });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutSec * 1000);

    child.stdout.on('data', d => { stdout += String(d); });
    child.stderr.on('data', d => { stderr += String(d); });

    child.on('error', err => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr + '\n' + err.message, timedOut });
    });

    child.on('close', code => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

function logCommand(agentId: string, command: string, cwd: string, exitCode: number | null): void {
  try {
    getDb().prepare(
      'INSERT INTO command_log (id, agent_id, command, cwd, exit_code) VALUES (?, ?, ?, ?, ?)'
    ).run(randomUUID().slice(0, 8), agentId, command, cwd, exitCode);
  } catch {
    // logging is best-effort
  }
}

function addToAllowlist(command: string): void {
  const config = getConfig();
  const trimmed = command.trim();
  if (!config.shell.allowlist.includes(trimmed)) {
    updateConfig({
      shell: { ...config.shell, allowlist: [...config.shell.allowlist, trimmed] },
    });
  }
}

export function createShellTools(agentId: string) {
  const runCommand = tool({
    description:
      'Executar um comando no terminal do sistema (PowerShell no Windows, sh no Linux). O comando roda DENTRO do cwd — use caminhos relativos a ele e NAO repita o prefixo do cwd no comando (ex: com cwd padrao workspace/, um arquivo em workspace/pasta/x.js e executado como "node pasta/x.js"). O usuario pode precisar aprovar o comando.',
    inputSchema: z.object({
      command: z.string().describe('O comando a executar (caminhos relativos ao cwd)'),
      cwd: z
        .string()
        .optional()
        .describe('Diretorio de trabalho relativo ao projeto (padrao: workspace/ ou workspace/<sua-equipe>/)'),
    }),
    execute: async ({ command, cwd }) => {
      const config = getConfig();
      const shellCfg = config.shell;

      if (shellCfg.mode === 'off') {
        return { error: 'Execucao de comandos esta desativada (shell.mode = "off" no config.json).' };
      }

      // Working directory must stay inside the project (default: the team workspace)
      const team = config.agents[agentId]?.team;
      const defaultDir = team ? path.join('workspace', team) : 'workspace';
      const requestedWorkdir = path.resolve(ROOT_DIR, cwd ?? defaultDir);
      const lexicalRel = path.relative(ROOT_DIR, requestedWorkdir);
      if (lexicalRel.startsWith('..') || path.isAbsolute(lexicalRel)) {
        return { error: `Diretorio de trabalho fora do projeto: ${cwd}` };
      }

      const workdir = canonicalizePath(requestedWorkdir);
      if (!workdir) {
        return { error: `Nao foi possivel validar o diretorio de trabalho: ${cwd}` };
      }
      const rel = path.relative(PHYSICAL_ROOT_DIR, workdir);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { error: `Diretorio de trabalho aponta para fora do projeto: ${cwd}` };
      }
      if (!fs.existsSync(workdir)) {
        fs.mkdirSync(workdir, { recursive: true });
      }

      if (shellCfg.mode === 'confirm' && !isAllowlisted(command, shellCfg.allowlist)) {
        const result = await askConfirmation(
          `${agentId} quer executar:\n    ${command}\n  Permitir?`,
          { command }
        );
        if (result.answer === 'no') {
          return {
            error: result.timedOut
              ? 'Nenhuma aprovacao recebida a tempo (contexto em background). Comando nao executado.'
              : 'Usuario negou a execucao do comando.',
          };
        }
        if (result.answer === 'always') {
          addToAllowlist(command);
        }
      }

      const { exitCode, stdout, stderr, timedOut } = await runShell(command, workdir, shellCfg.timeoutSec);
      logCommand(agentId, command, rel || '.', timedOut ? null : exitCode);

      if (timedOut) {
        return {
          error: `Comando excedeu o timeout de ${shellCfg.timeoutSec}s e foi encerrado.`,
          cwd: rel || '.',
          stdout: truncate(stdout, 4000),
          stderr: truncate(stderr, 2000),
        };
      }

      return {
        exitCode,
        cwd: rel || '.',
        stdout: truncate(stdout, 8000),
        stderr: truncate(stderr, 4000),
      };
    },
  });

  return { runCommand };
}
