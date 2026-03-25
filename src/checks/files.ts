import { Config } from '../config/schema';
import { CheckResult, PRData } from '../config/types';

// Known suspicious file patterns
const SUSPICIOUS_FILE_PATTERNS = [
  /\.env$/,
  /\/\.env\./,
  /secrets?\./i,
  /credentials?\./i,
  /password/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
];

// Files that AI slop PRs commonly touch unnecessarily
const SLOP_TARGET_FILES = [
  'README.md',
  '.gitignore',
  'LICENSE',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
];

export function checkFiles(pr: PRData, config: Config): CheckResult[] {
  const results: CheckResult[] = [];

  // Check: number of files changed
  if (pr.changedFiles > config.maxFilesChanged) {
    results.push({
      name: 'files-too-many',
      passed: false,
      message: `PR changes ${pr.changedFiles} files (max ${config.maxFilesChanged}) — excessively large PRs are hard to review and often indicate AI-generated bulk changes`,
      severity: 'warning',
      category: 'files',
      score: 15,
    });
  }

  // Check: total additions
  if (pr.additions > config.maxAdditions) {
    results.push({
      name: 'files-too-many-additions',
      passed: false,
      message: `PR adds ${pr.additions} lines (max ${config.maxAdditions}) — very large additions are a slop indicator`,
      severity: 'warning',
      category: 'files',
      score: 15,
    });
  }

  // Check: blocked file patterns
  if (config.blockedFilePatterns.length > 0) {
    for (const file of pr.files) {
      for (const pattern of config.blockedFilePatterns) {
        const regex = new RegExp(pattern);
        if (regex.test(file.filename)) {
          results.push({
            name: 'files-blocked-pattern',
            passed: false,
            message: `File "${file.filename}" matches blocked pattern "${pattern}"`,
            severity: 'error',
            category: 'files',
            score: 0,
          });
        }
      }
    }
  }

  // Check: suspicious files (secrets, keys)
  for (const file of pr.files) {
    for (const pattern of SUSPICIOUS_FILE_PATTERNS) {
      if (pattern.test(file.filename)) {
        results.push({
          name: 'files-suspicious',
          passed: false,
          message: `⚠️ Potentially sensitive file modified: "${file.filename}" — verify this is intentional`,
          severity: 'error',
          category: 'files',
          score: 0,
        });
        break;
      }
    }
  }

  // Check: only touches slop target files
  const touchedSlopFiles = pr.files.filter(f =>
    SLOP_TARGET_FILES.some(s => f.filename.endsWith(s))
  );
  if (touchedSlopFiles.length === pr.files.length && pr.files.length > 0) {
    results.push({
      name: 'files-only-slop-targets',
      passed: false,
      message: `PR only modifies common slop target files: ${touchedSlopFiles.map(f => f.filename).join(', ')}`,
      severity: 'warning',
      category: 'slop-pattern',
      score: 10,
    });
  }

  // Check: AI slop pattern — excessive comment additions in code
  if (config.detectExcessiveComments) {
    let totalCommentLines = 0;
    let totalAdditions = 0;

    for (const file of pr.files) {
      if (!file.patch) continue;
      const addedLines = file.patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
      totalAdditions += addedLines.length;

      const commentPatterns = [
        /^\+\s*\/\//,     // JS/TS/Java/C++ single-line
        /^\+\s*#/,        // Python/Ruby/Shell
        /^\+\s*\*/,       // Multi-line comment body
        /^\+\s*\/\*/,     // Multi-line comment start
        /^\+\s*\*\//,     // Multi-line comment end
        /^\+\s*"""/,      // Python docstring
        /^\+\s*'''/,      // Python docstring
      ];

      const commentLines = addedLines.filter(line =>
        commentPatterns.some(p => p.test(line))
      );
      totalCommentLines += commentLines.length;
    }

    if (totalAdditions > 20) {
      const commentRatio = totalCommentLines / totalAdditions;
      if (commentRatio > 0.5) {
        results.push({
          name: 'files-excessive-comments',
          passed: false,
          message: `${Math.round(commentRatio * 100)}% of added lines are comments (${totalCommentLines}/${totalAdditions}) — excessive commenting is a common AI slop pattern`,
          severity: 'warning',
          category: 'slop-pattern',
          score: 20,
        });
      }
    }
  }

  // Check: detect hallucinated imports (known non-existent packages)
  if (config.detectHallucinatedImports) {
    const hallucinatedPackages: string[] = [];
    const suspiciousImportPatterns = [
      // Very specific fake packages that AI commonly hallucinates
      /from\s+['"](?:react-native-awesome-[a-z]+|@awesome\/[a-z-]+)['"]/,
      /import\s+.*from\s+['"](?:utils\/[a-z]+Helper|helpers\/[a-z]+Utils)['"]/,
      /require\(['"](?:super-[a-z]+-[a-z]+|mega-[a-z]+)['"]\)/,
    ];

    for (const file of pr.files) {
      if (!file.patch) continue;
      const addedLines = file.patch.split('\n').filter(l => l.startsWith('+'));

      for (const line of addedLines) {
        for (const pattern of suspiciousImportPatterns) {
          if (pattern.test(line)) {
            hallucinatedPackages.push(line.trim().slice(1)); // Remove leading +
          }
        }
      }
    }

    if (hallucinatedPackages.length > 0) {
      results.push({
        name: 'files-hallucinated-imports',
        passed: false,
        message: `Potentially hallucinated imports detected (verify these packages exist):\n${hallucinatedPackages.map(p => `  • ${p}`).join('\n')}`,
        severity: 'warning',
        category: 'slop-pattern',
        score: 10,
      });
    }
  }

  return results;
}
