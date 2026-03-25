import * as fs from 'fs';
import * as path from 'path';
import { FileData } from '../config/types';

export interface ProjectContext {
  directoryTree: string;
  relatedFiles: Array<{ path: string; content: string }>;
  projectInfo: string;
}

// Import resolution patterns per language
const IMPORT_RESOLVERS: Record<string, RegExp[]> = {
  js: [
    /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  python: [
    /^import\s+([\w.]+)/gm,
    /^from\s+([\w.]+)\s+import/gm,
  ],
  go: [
    /import\s+(?:\w+\s+)?"([^"]+)"/g,
    /^\s*(?:\w+\s+)?"([^"]+)"/gm,
  ],
  java: [
    /^import\s+(?:static\s+)?([\w.]+)/gm,
  ],
  rust: [
    /^use\s+([\w:]+(?:::[\w:]+)*)/gm,
  ],
  cpp: [
    /^#include\s+"([^"]+)"/gm,
  ],
};

// Detect language from filename
function detectLang(filename: string): string | null {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filename)) return 'js';
  if (/\.py$/.test(filename)) return 'python';
  if (/\.go$/.test(filename)) return 'go';
  if (/\.java$/.test(filename)) return 'java';
  if (/\.rs$/.test(filename)) return 'rust';
  if (/\.(c|cpp|cc|cxx|h|hpp)$/.test(filename)) return 'cpp';
  return null;
}

// Extract import paths from a file's diff
function extractImportPaths(patch: string, lang: string): string[] {
  const addedLines = patch
    .split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1))
    .join('\n');

  const imports: string[] = [];
  const patterns = IMPORT_RESOLVERS[lang] || [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(addedLines)) !== null) {
      if (match[1]) imports.push(match[1]);
    }
  }

  return imports;
}

// Resolve import path to actual file path
function resolveImportToFile(importPath: string, sourceFile: string, workspace: string, lang: string): string | null {
  if (lang === 'js') {
    // Skip npm packages (non-relative imports without @/ prefix)
    if (!importPath.startsWith('.') && !importPath.startsWith('@/') && !importPath.startsWith('~/')) {
      return null;
    }

    // Handle alias like @/src/xxx
    let resolvedBase: string;
    if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
      resolvedBase = path.join(workspace, importPath.slice(2));
    } else {
      const sourceDir = path.dirname(path.join(workspace, sourceFile));
      resolvedBase = path.resolve(sourceDir, importPath);
    }

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', ''];
    for (const ext of extensions) {
      const full = resolvedBase + ext;
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return path.relative(workspace, full);
      }
      // Check index file
      const indexPath = path.join(resolvedBase, `index${ext}`);
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        return path.relative(workspace, indexPath);
      }
    }
  }

  if (lang === 'python') {
    const modulePath = importPath.replace(/\./g, '/');
    const candidates = [
      path.join(workspace, modulePath + '.py'),
      path.join(workspace, modulePath, '__init__.py'),
      path.join(workspace, 'src', modulePath + '.py'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return path.relative(workspace, c);
    }
  }

  if (lang === 'go') {
    // Only resolve local packages (those under the module path)
    const goModPath = path.join(workspace, 'go.mod');
    if (fs.existsSync(goModPath)) {
      const goMod = fs.readFileSync(goModPath, 'utf-8');
      const moduleMatch = goMod.match(/^module\s+(.+)$/m);
      if (moduleMatch && importPath.startsWith(moduleMatch[1])) {
        const localPath = importPath.slice(moduleMatch[1].length + 1);
        const dir = path.join(workspace, localPath);
        if (fs.existsSync(dir)) {
          // Find first .go file in directory
          try {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.go') && !f.endsWith('_test.go'));
            if (files.length > 0) return path.join(localPath, files[0]);
          } catch { /* skip */ }
        }
      }
    }
  }

  if (lang === 'java') {
    const javaPath = importPath.replace(/\./g, '/');
    const candidates = [
      path.join(workspace, 'src/main/java', javaPath + '.java'),
      path.join(workspace, 'src', javaPath + '.java'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return path.relative(workspace, c);
    }
  }

  if (lang === 'rust') {
    const moduleName = importPath.split('::')[0];
    if (['std', 'core', 'alloc', 'crate', 'self', 'super'].includes(moduleName)) {
      if (moduleName === 'crate' || moduleName === 'super' || moduleName === 'self') {
        // Local module — try to resolve
        const parts = importPath.split('::').slice(1);
        if (parts.length > 0) {
          const modPath = parts[0];
          const candidates = [
            path.join(workspace, 'src', modPath + '.rs'),
            path.join(workspace, 'src', modPath, 'mod.rs'),
          ];
          for (const c of candidates) {
            if (fs.existsSync(c)) return path.relative(workspace, c);
          }
        }
      }
      return null;
    }
  }

  if (lang === 'cpp') {
    const sourceDir = path.dirname(path.join(workspace, sourceFile));
    const searchDirs = [sourceDir, workspace, path.join(workspace, 'include'), path.join(workspace, 'src')];
    for (const dir of searchDirs) {
      const full = path.resolve(dir, importPath);
      if (fs.existsSync(full)) return path.relative(workspace, full);
    }
  }

  return null;
}

// Build a compact directory tree string
function buildDirectoryTree(workspace: string, maxDepth: number = 3): string {
  const lines: string[] = [];

  function walk(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Filter out noise
    const filtered = entries.filter(e =>
      !e.name.startsWith('.') &&
      !['node_modules', 'dist', 'build', '__pycache__', 'target', '.git',
        'vendor', 'coverage', '.next', '.nuxt', 'out'].includes(e.name)
    ).sort((a, b) => {
      // Directories first
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    // Limit to 20 entries per directory
    const shown = filtered.slice(0, 20);
    const hidden = filtered.length - shown.length;

    for (const entry of shown) {
      const isDir = entry.isDirectory();
      lines.push(`${prefix}${isDir ? '📁' : '📄'} ${entry.name}`);
      if (isDir) {
        walk(path.join(dir, entry.name), prefix + '  ', depth + 1);
      }
    }

    if (hidden > 0) {
      lines.push(`${prefix}... (+${hidden} more)`);
    }
  }

  walk(workspace, '', 0);
  return lines.join('\n');
}

// Read file content with truncation
function readFileContent(filePath: string, maxLines: number = 150): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      return lines.slice(0, maxLines).join('\n') + `\n\n// ... (${lines.length - maxLines} more lines truncated)`;
    }
    return content;
  } catch {
    return '// Unable to read file';
  }
}

// Detect project info from config files
function detectProjectInfo(workspace: string): string {
  const info: string[] = [];

  // package.json
  const pkgPath = path.join(workspace, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      info.push(`Project: ${pkg.name || 'unknown'} (${pkg.description || 'JS/TS project'})`);
      if (pkg.dependencies) info.push(`Dependencies: ${Object.keys(pkg.dependencies).join(', ')}`);
    } catch { /* skip */ }
  }

  // go.mod
  const goModPath = path.join(workspace, 'go.mod');
  if (fs.existsSync(goModPath)) {
    const mod = fs.readFileSync(goModPath, 'utf-8');
    const moduleMatch = mod.match(/^module\s+(.+)$/m);
    if (moduleMatch) info.push(`Go module: ${moduleMatch[1]}`);
  }

  // Cargo.toml
  const cargoPath = path.join(workspace, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    const cargo = fs.readFileSync(cargoPath, 'utf-8');
    const nameMatch = cargo.match(/^name\s*=\s*"(.+)"/m);
    if (nameMatch) info.push(`Rust crate: ${nameMatch[1]}`);
  }

  return info.join('\n') || 'Unknown project type';
}

// Main: build project context for a set of changed files
export function buildProjectContext(
  files: FileData[],
  workspace: string,
  maxRelatedFiles: number = 5,
): ProjectContext {
  // 1. Collect all import references from changed files
  const relatedPaths = new Set<string>();

  for (const file of files) {
    if (!file.patch) continue;
    const lang = detectLang(file.filename);
    if (!lang) continue;

    const importPaths = extractImportPaths(file.patch, lang);
    for (const imp of importPaths) {
      const resolved = resolveImportToFile(imp, file.filename, workspace, lang);
      if (resolved && !files.some(f => f.filename === resolved)) {
        relatedPaths.add(resolved);
      }
    }

    // Also check the full file for imports (not just diff), if it's a modification
    if (file.status === 'modified') {
      const fullPath = path.join(workspace, file.filename);
      if (fs.existsSync(fullPath)) {
        try {
          const fullContent = fs.readFileSync(fullPath, 'utf-8');
          for (const pattern of (IMPORT_RESOLVERS[lang] || [])) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(fullContent)) !== null) {
              if (match[1]) {
                const resolved = resolveImportToFile(match[1], file.filename, workspace, lang);
                if (resolved && !files.some(f => f.filename === resolved)) {
                  relatedPaths.add(resolved);
                }
              }
            }
          }
        } catch { /* skip */ }
      }
    }
  }

  // 2. Read related files (capped)
  const relatedFiles: Array<{ path: string; content: string }> = [];
  const sortedPaths = [...relatedPaths].slice(0, maxRelatedFiles);

  for (const relPath of sortedPaths) {
    const fullPath = path.join(workspace, relPath);
    if (fs.existsSync(fullPath)) {
      relatedFiles.push({
        path: relPath,
        content: readFileContent(fullPath),
      });
    }
  }

  // 3. Build directory tree
  const directoryTree = buildDirectoryTree(workspace);

  // 4. Detect project info
  const projectInfo = detectProjectInfo(workspace);

  return { directoryTree, relatedFiles, projectInfo };
}

// Format context for AI prompt
export function formatContextForPrompt(ctx: ProjectContext): string {
  let prompt = `## Project Context\n\n`;
  prompt += `**Project Info:**\n${ctx.projectInfo}\n\n`;
  prompt += `**Directory Structure:**\n\`\`\`\n${ctx.directoryTree}\n\`\`\`\n\n`;

  if (ctx.relatedFiles.length > 0) {
    prompt += `**Related Files (referenced by the changed code):**\n\n`;
    for (const file of ctx.relatedFiles) {
      prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }
  }

  return prompt;
}
