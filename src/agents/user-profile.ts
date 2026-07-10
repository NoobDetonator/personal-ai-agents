import fs from 'node:fs';
import path from 'node:path';

const PROFILE_PATH = path.join(process.cwd(), 'USER.md');

export const PROFILE_SECTIONS = [
  'Identidade',
  'Trabalho e Funcoes',
  'Gostos e Interesses',
  'Como Prefere as Coisas',
  'Notas',
] as const;

const TEMPLATE = `# Perfil do Usuario

Perfil compartilhado com TODOS os agentes. Atualizado conforme conhecemos melhor o usuario.

## Identidade
- (Nada registrado ainda)

## Trabalho e Funcoes
- (Nada registrado ainda)

## Gostos e Interesses
- (Nada registrado ainda)

## Como Prefere as Coisas
- (Nada registrado ainda)

## Notas
- (Nada registrado ainda)
`;

export function getUserProfilePath(): string {
  return PROFILE_PATH;
}

export function readUserProfile(): string {
  try {
    return fs.readFileSync(PROFILE_PATH, 'utf-8');
  } catch {
    return '';
  }
}

export function appendToUserProfile(section: string, content: string): void {
  let profile = readUserProfile();
  if (!profile) {
    profile = TEMPLATE;
  }

  const sectionHeader = `## ${section}`;
  const placeholder = '- (Nada registrado ainda)';

  if (profile.includes(sectionHeader)) {
    const sectionIndex = profile.indexOf(sectionHeader);
    const afterHeader = sectionIndex + sectionHeader.length;
    const nextSectionIndex = profile.indexOf('\n## ', afterHeader);
    const sectionEnd = nextSectionIndex === -1 ? profile.length : nextSectionIndex;
    const sectionContent = profile.substring(afterHeader, sectionEnd);

    let newSectionContent: string;
    if (sectionContent.includes(placeholder)) {
      newSectionContent = sectionContent.replace(placeholder, `- ${content}`);
    } else {
      newSectionContent = sectionContent.trimEnd() + `\n- ${content}\n`;
    }

    profile = profile.substring(0, afterHeader) + newSectionContent + profile.substring(sectionEnd);
  } else {
    profile = profile.trimEnd() + `\n\n## ${section}\n- ${content}\n`;
  }

  fs.writeFileSync(PROFILE_PATH, profile, 'utf-8');
}
