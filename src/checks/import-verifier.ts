import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../config/schema';
import { CheckResult, PRData } from '../config/types';

// Regex patterns for different import styles
const IMPORT_PATTERNS = [
  // JS/TS: import xxx from 'yyy'
  /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g,
  // JS/TS: require('yyy')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // Python: import yyy
  /^import\s+([\w.]+)/gm,
  // Python: from yyy import xxx
  /^from\s+([\w.]+)\s+import/gm,
  // Go: import "pkg" or import "github.com/xxx"
  /import\s+(?:\w+\s+)?"([^"]+)"/g,
  // Go: grouped imports
  /^\s*(?:\w+\s+)?"([^"]+)"/gm,
  // Java: import com.xxx.yyy
  /^import\s+(?:static\s+)?([\w.]+)/gm,
  // Rust: use crate::xxx or use xxx::yyy
  /^use\s+([\w:]+(?:::[\w:]+)*)/gm,
  // C/C++: #include "xxx" (local headers)
  /^#include\s+"([^"]+)"/gm,
];

// Known built-in modules that should not be flagged
const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'url', 'http', 'https', 'crypto', 'stream', 'util',
  'events', 'buffer', 'querystring', 'child_process', 'cluster', 'net',
  'dns', 'tls', 'readline', 'zlib', 'assert', 'process', 'vm', 'worker_threads',
  'node:fs', 'node:path', 'node:os', 'node:url', 'node:http', 'node:https',
  'node:crypto', 'node:stream', 'node:util', 'node:events', 'node:buffer',
]);

const PYTHON_BUILTINS = new Set([
  'os', 'sys', 'json', 'math', 'time', 'datetime', 'collections', 'functools',
  'itertools', 'typing', 'pathlib', 'argparse', 'logging', 'unittest', 'io',
  're', 'copy', 'abc', 'enum', 'dataclasses', 'contextlib', 'hashlib', 'hmac',
  'base64', 'secrets', 'uuid', 'random', 'string', 'textwrap', 'struct',
  'threading', 'multiprocessing', 'subprocess', 'socket', 'http', 'urllib',
  'email', 'html', 'xml', 'csv', 'sqlite3', 'pickle', 'shelve', 'gzip',
  'zipfile', 'tarfile', 'tempfile', 'glob', 'shutil', 'pprint', 'inspect',
  'traceback', 'warnings', 'weakref', 'types', 'importlib', 'pkgutil',
]);

const GO_BUILTINS = new Set([
  'fmt', 'os', 'io', 'net', 'log', 'math', 'sort', 'sync', 'time', 'strings',
  'strconv', 'bytes', 'errors', 'context', 'crypto', 'encoding', 'flag', 'hash',
  'path', 'reflect', 'regexp', 'runtime', 'testing', 'unicode', 'unsafe',
  'bufio', 'builtin', 'compress', 'container', 'database', 'debug', 'embed',
  'expvar', 'go', 'html', 'image', 'index', 'mime', 'plugin', 'text',
  'net/http', 'io/ioutil', 'os/exec', 'path/filepath', 'encoding/json',
  'encoding/xml', 'encoding/csv', 'encoding/base64', 'crypto/sha256',
  'database/sql', 'net/url', 'io/fs', 'log/slog',
]);

const JAVA_BUILTINS_PREFIX = [
  'java.', 'javax.', 'jakarta.',
  'sun.', 'com.sun.', 'org.w3c.', 'org.xml.',
];

const RUST_BUILTINS = new Set([
  'std', 'core', 'alloc', 'crate', 'self', 'super',
]);

// Extract imports from PR diff
function extractImportsFromDiff(files: PRData['files']): Map<string, string[]> {
  const importsByFile = new Map<string, string[]>();

  for (const file of files) {
    if (!file.patch) continue;

    const addedLines = file.patch
      .split('\n')
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .map(l => l.slice(1)); // Remove leading +

    const imports: string[] = [];
    const fullText = addedLines.join('\n');

    for (const pattern of IMPORT_PATTERNS) {
      // Reset regex
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(fullText)) !== null) {
        const importPath = match[1];
        if (importPath) {
          imports.push(importPath);
        }
      }
    }

    if (imports.length > 0) {
      importsByFile.set(file.filename, imports);
    }
  }

  return importsByFile;
}

// Check if a JS/TS import exists in the project
function verifyJSImport(importPath: string, sourceFile: string, workspacePath: string): boolean {
  // Skip built-in modules
  if (NODE_BUILTINS.has(importPath)) return true;

  // Skip scoped and common packages (check node_modules or package.json)
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    // It's a package import — check package.json
    const pkgJsonPath = path.join(workspacePath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };
        // Check root package name (e.g., "lodash" from "lodash/merge")
        const rootPkg = importPath.startsWith('@')
          ? importPath.split('/').slice(0, 2).join('/')
          : importPath.split('/')[0];
        if (allDeps[rootPkg]) return true;
      } catch {
        // Can't read package.json
      }
    }
    // Also check if node_modules exists
    const nmPath = path.join(workspacePath, 'node_modules', importPath);
    if (fs.existsSync(nmPath)) return true;

    // Package not found
    return false;
  }

  // Relative import — resolve against source file
  const sourceDir = path.dirname(path.join(workspacePath, sourceFile));
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', ''];

  for (const ext of extensions) {
    const resolved = path.resolve(sourceDir, importPath + ext);
    if (fs.existsSync(resolved)) return true;
    // Check index file
    const indexPath = path.resolve(sourceDir, importPath, `index${ext}`);
    if (fs.existsSync(indexPath)) return true;
  }

  return false;
}

// Check if a Python import exists
function verifyPythonImport(importPath: string, sourceFile: string, workspacePath: string): boolean {
  const rootModule = importPath.split('.')[0];

  // Skip built-in modules
  if (PYTHON_BUILTINS.has(rootModule)) return true;

  // Check requirements.txt
  const reqPath = path.join(workspacePath, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    const reqs = fs.readFileSync(reqPath, 'utf-8').toLowerCase();
    if (reqs.includes(rootModule.toLowerCase())) return true;
  }

  // Check if local module exists
  const modulePath = importPath.replace(/\./g, '/');
  const possiblePaths = [
    path.join(workspacePath, modulePath + '.py'),
    path.join(workspacePath, modulePath, '__init__.py'),
    path.join(workspacePath, 'src', modulePath + '.py'),
    path.join(workspacePath, 'src', modulePath, '__init__.py'),
  ];

  return possiblePaths.some(p => fs.existsSync(p));
}

// Check if a Go import exists
function verifyGoImport(importPath: string, workspacePath: string): boolean {
  // Skip standard library
  if (GO_BUILTINS.has(importPath)) return true;
  // Standard lib packages don't contain dots in first segment
  const firstSeg = importPath.split('/')[0];
  if (!firstSeg.includes('.') && !importPath.includes('/')) return true; // likely stdlib

  // Check go.mod for module dependencies
  const goModPath = path.join(workspacePath, 'go.mod');
  if (fs.existsSync(goModPath)) {
    const goMod = fs.readFileSync(goModPath, 'utf-8');
    // Check module path (local packages)
    const moduleMatch = goMod.match(/^module\s+(.+)$/m);
    if (moduleMatch && importPath.startsWith(moduleMatch[1])) return true;
    // Check require block
    if (goMod.includes(importPath.split('/').slice(0, 3).join('/'))) return true;
  }

  // Check if local package directory exists
  const localPkg = path.join(workspacePath, importPath);
  if (fs.existsSync(localPkg)) return true;

  return false;
}

// Check if a Java import exists
function verifyJavaImport(importPath: string, workspacePath: string): boolean {
  // Skip JDK built-in packages
  if (JAVA_BUILTINS_PREFIX.some(p => importPath.startsWith(p))) return true;

  // Check pom.xml for Maven dependencies
  const pomPath = path.join(workspacePath, 'pom.xml');
  if (fs.existsSync(pomPath)) {
    const pom = fs.readFileSync(pomPath, 'utf-8');
    // Extract groupId from import (e.g., "org.springframework" from "org.springframework.boot.xxx")
    const parts = importPath.split('.');
    const groupPrefix = parts.slice(0, Math.min(3, parts.length)).join('.');
    if (pom.includes(groupPrefix)) return true;
  }

  // Check build.gradle for Gradle dependencies
  for (const gradleFile of ['build.gradle', 'build.gradle.kts']) {
    const gradlePath = path.join(workspacePath, gradleFile);
    if (fs.existsSync(gradlePath)) {
      const gradle = fs.readFileSync(gradlePath, 'utf-8');
      const parts = importPath.split('.');
      const groupPrefix = parts.slice(0, Math.min(3, parts.length)).join('.');
      if (gradle.includes(groupPrefix)) return true;
    }
  }

  // Check if local Java file exists
  const javaPath = importPath.replace(/\./g, '/');
  const possiblePaths = [
    path.join(workspacePath, 'src/main/java', javaPath + '.java'),
    path.join(workspacePath, 'src', javaPath + '.java'),
    path.join(workspacePath, javaPath + '.java'),
  ];
  return possiblePaths.some(p => fs.existsSync(p));
}

// Check if a Rust import exists
function verifyRustImport(importPath: string, workspacePath: string): boolean {
  const rootCrate = importPath.split('::')[0];

  // Skip built-in crates
  if (RUST_BUILTINS.has(rootCrate)) return true;

  // Check Cargo.toml for dependencies
  const cargoPath = path.join(workspacePath, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    const cargo = fs.readFileSync(cargoPath, 'utf-8');
    // Normalize: crate names use hyphens in Cargo.toml but underscores in code
    const crateName = rootCrate.replace(/_/g, '-');
    if (cargo.includes(crateName) || cargo.includes(rootCrate)) return true;
  }

  // Check if local module exists
  const modulePath = rootCrate;
  const possiblePaths = [
    path.join(workspacePath, 'src', modulePath + '.rs'),
    path.join(workspacePath, 'src', modulePath, 'mod.rs'),
  ];
  return possiblePaths.some(p => fs.existsSync(p));
}

// Check if a C/C++ include exists
function verifyCppInclude(includePath: string, sourceFile: string, workspacePath: string): boolean {
  // Only check quoted includes (#include "xxx"), not angle bracket (#include <xxx>)
  // Angle brackets are system headers, captured by different regex

  const sourceDir = path.dirname(path.join(workspacePath, sourceFile));
  const searchDirs = [
    sourceDir,
    workspacePath,
    path.join(workspacePath, 'include'),
    path.join(workspacePath, 'src'),
    path.join(workspacePath, 'lib'),
  ];

  for (const dir of searchDirs) {
    const resolved = path.resolve(dir, includePath);
    if (fs.existsSync(resolved)) return true;
  }

  // Check CMakeLists.txt for external dependencies
  const cmakePath = path.join(workspacePath, 'CMakeLists.txt');
  if (fs.existsSync(cmakePath)) {
    const cmake = fs.readFileSync(cmakePath, 'utf-8');
    const baseName = path.basename(includePath, path.extname(includePath));
    if (cmake.toLowerCase().includes(baseName.toLowerCase())) return true;
  }

  return false;
}

export function checkImports(pr: PRData, config: Config, workspacePath?: string): CheckResult[] {
  const results: CheckResult[] = [];

  if (!workspacePath || !fs.existsSync(workspacePath)) {
    // No workspace available — skip verification
    return results;
  }

  const importsByFile = extractImportsFromDiff(pr.files);
  const nonExistentImports: { file: string; import: string }[] = [];

  for (const [filename, imports] of importsByFile) {
    const isJS = /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filename);
    const isPython = /\.py$/.test(filename);
    const isGo = /\.go$/.test(filename);
    const isJava = /\.java$/.test(filename);
    const isRust = /\.rs$/.test(filename);
    const isCpp = /\.(c|cpp|cc|cxx|h|hpp)$/.test(filename);

    for (const imp of imports) {
      let exists = true;

      if (isJS) {
        exists = verifyJSImport(imp, filename, workspacePath);
      } else if (isPython) {
        exists = verifyPythonImport(imp, filename, workspacePath);
      } else if (isGo) {
        exists = verifyGoImport(imp, workspacePath);
      } else if (isJava) {
        exists = verifyJavaImport(imp, workspacePath);
      } else if (isRust) {
        exists = verifyRustImport(imp, workspacePath);
      } else if (isCpp) {
        exists = verifyCppInclude(imp, filename, workspacePath);
      }

      if (!exists) {
        nonExistentImports.push({ file: filename, import: imp });
      }
    }
  }

  if (nonExistentImports.length > 0) {
    results.push({
      name: 'imports-verified-nonexistent',
      passed: false,
      message: `🔍 Verified non-existent imports (checked against project source):\n${nonExistentImports.map(i => `  • \`${i.import}\` in ${i.file}`).join('\n')}`,
      severity: 'error',
      category: 'slop-pattern',
      score: 0,
    });
  } else if (importsByFile.size > 0) {
    results.push({
      name: 'imports-verified',
      passed: true,
      message: `All imports verified against project source`,
      severity: 'info',
      category: 'files',
      score: 100,
    });
  }

  return results;
}
