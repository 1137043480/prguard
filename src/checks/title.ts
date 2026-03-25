import { Config } from '../config/schema';
import { CheckResult, PRData } from '../config/types';

const CONVENTIONAL_PREFIXES = [
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf',
  'test', 'build', 'ci', 'chore', 'revert',
];

const CONVENTIONAL_REGEX = new RegExp(
  `^(${CONVENTIONAL_PREFIXES.join('|')})(\\(.+\\))?!?:\\s.+`
);

export function checkTitle(pr: PRData, config: Config): CheckResult[] {
  const results: CheckResult[] = [];

  // Check: conventional title format
  if (config.requireConventionalTitle) {
    const isConventional = CONVENTIONAL_REGEX.test(pr.title);
    results.push({
      name: 'title-conventional',
      passed: isConventional,
      message: isConventional
        ? 'PR title follows conventional commit format'
        : `PR title does not follow conventional format (e.g., "feat: add feature", "fix: resolve bug"). Got: "${pr.title}"`,
      severity: 'warning',
      category: 'title',
      score: isConventional ? 100 : 30,
    });
  }

  // Check: title not too short
  const minLength = 10;
  const isTooShort = pr.title.length < minLength;
  results.push({
    name: 'title-length',
    passed: !isTooShort,
    message: isTooShort
      ? `PR title is too short (${pr.title.length} chars, minimum ${minLength})`
      : 'PR title has adequate length',
    severity: 'warning',
    category: 'title',
    score: isTooShort ? 20 : 100,
  });

  // Check: blocked title patterns
  if (config.blockedTitlePatterns.length > 0) {
    for (const pattern of config.blockedTitlePatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(pr.title)) {
          results.push({
            name: 'title-blocked-pattern',
            passed: false,
            message: `PR title matches blocked pattern: "${pattern}"`,
            severity: 'error',
            category: 'title',
            score: 0,
          });
          break;
        }
      } catch {
        // Invalid regex, try exact match
        if (pr.title.toLowerCase().includes(pattern.toLowerCase())) {
          results.push({
            name: 'title-blocked-pattern',
            passed: false,
            message: `PR title matches blocked pattern: "${pattern}"`,
            severity: 'error',
            category: 'title',
            score: 0,
          });
          break;
        }
      }
    }
  }

  // Check: title not all caps
  const isAllCaps = pr.title === pr.title.toUpperCase() && pr.title.length > 5;
  if (isAllCaps) {
    results.push({
      name: 'title-all-caps',
      passed: false,
      message: 'PR title is all uppercase, looks spammy',
      severity: 'warning',
      category: 'title',
      score: 10,
    });
  }

  return results;
}
