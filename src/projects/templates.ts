export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  files: Record<string, string>;
}

const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    name: 'Em branco',
    description: 'Workspace vazio para comecar do zero.',
    icon: 'file-plus-2',
    files: {},
  },
  {
    id: 'web-static',
    name: 'Site estático',
    description: 'HTML, CSS e JavaScript prontos para preview.',
    icon: 'panel-top',
    files: {
      'README.md': '# Site estatico\n\nAbra `index.html` no explorador para visualizar o projeto.\n',
      'index.html': '<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>Novo projeto</title>\n  <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n  <main><h1>Novo projeto</h1><p>Comece a construir aqui.</p></main>\n  <script src="script.js"></script>\n</body>\n</html>\n',
      'styles.css': ':root { color-scheme: dark; font-family: system-ui, sans-serif; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111827; color: #f8fafc; }\nmain { width: min(680px, 88vw); }\n',
      'script.js': "console.log('Projeto iniciado.');\n",
    },
  },
  {
    id: 'node-typescript',
    name: 'Node + TypeScript',
    description: 'Estrutura minima para um aplicativo TypeScript.',
    icon: 'braces',
    files: {
      'README.md': '# Node + TypeScript\n\nExecute `npm install` e depois `npm run dev`.\n',
      'package.json': '{\n  "name": "novo-projeto",\n  "private": true,\n  "type": "module",\n  "scripts": { "dev": "tsx src/index.ts", "build": "tsc" },\n  "devDependencies": { "tsx": "^4.21.0", "typescript": "^5.9.3" }\n}\n',
      'tsconfig.json': '{\n  "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "outDir": "dist" },\n  "include": ["src"]\n}\n',
      'src/index.ts': "console.log('Ola, projeto!');\n",
      '.gitignore': 'node_modules/\ndist/\n.env\n',
    },
  },
  {
    id: 'research',
    name: 'Pesquisa',
    description: 'Notas, fontes e síntese separadas.',
    icon: 'search-check',
    files: {
      'README.md': '# Pesquisa\n\nDefina o problema, registre fontes e consolide os achados.\n',
      'notes/questions.md': '# Perguntas\n\n- Qual problema queremos responder?\n',
      'notes/sources.md': '# Fontes\n\nRegistre URL, data e confiabilidade de cada fonte.\n',
      'notes/findings.md': '# Achados\n\n## Evidencias\n\n## Lacunas\n',
    },
  },
];

export function listProjectTemplates(): Array<Omit<ProjectTemplate, 'files'> & { fileCount: number }> {
  return TEMPLATES.map(({ files, ...template }) => ({ ...template, fileCount: Object.keys(files).length }));
}

export function getProjectTemplate(id: string | null | undefined): ProjectTemplate {
  const template = TEMPLATES.find(item => item.id === (id || 'blank'));
  if (!template) throw new Error('Template de projeto invalido.');
  return template;
}
