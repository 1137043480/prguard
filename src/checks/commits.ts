import { Config } from '../config/schema';
import { CheckResult, PRData } from '../config/types';

const CONVENTIONAL_REGEX = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\s.+/;

export function checkCommits(pr: PRData, config: Config): CheckResult[] {
  const results: CheckResult[] = [];

  if (pr.commits.length === 0) return results;

  // Check: conventional commit messages
  if (config.requireConventionalCommits) {
    const nonConventional = pr.commits.filter(c => !CONVENTIONAL_REGEX.test(c.message.split('\n')[0]));
    const passed = nonConventional.length === 0;
    results.push({
      name: 'commits-conventional',
      passed,
      message: passed
        ? 'All commit messages follow conventional format'
        : `${nonConventional.length}/${pr.commits.length} commits don't follow conventional format: ${nonConventional.map(c => `"${c.message.split('\n')[0]}"`).slice(0, 3).join(', ')}`,
      severity: 'warning',
      category: 'commits',
      score: passed ? 100 : 40,
    });
  }

  // Check: commit message length
  const longCommits = pr.commits.filter(
    c => c.message.split('\n')[0].length > config.maxCommitMessageLength
  );
  if (longCommits.length > 0) {
    results.push({
      name: 'commits-message-length',
      passed: false,
      message: `${longCommits.length} commit(s) have overly long messages (max ${config.maxCommitMessageLength} chars)`,
      severity: 'warning',
      category: 'commits',
      score: 40,
    });
  }

  // Check: commit author matches PR author
  if (config.requireCommitAuthorMatch) {
    const mismatchedCommits = pr.commits.filter(c => c.author !== pr.author);
    const passed = mismatchedCommits.length === 0;
    results.push({
      name: 'commits-author-match',
      passed,
      message: passed
        ? 'All commit authors match PR author'
        : `${mismatchedCommits.length} commit(s) have different authors than PR author "${pr.author}"`,
      severity: 'info',
      category: 'commits',
      score: passed ? 100 : 60,
    });
  }

  // Check: AI slop commit patterns
  const slopCommitPatterns = [
    /^update/i,
    /^fix\s*$/i,
    /^changes/i,
    /^commit/i,
    /^wip/i,
    /^\.$/,
    /^[a-f0-9]{6,}$/, // just a hash
    /^asdf/i,
    /^test$/i,
  ];

  const slopCommits = pr.commits.filter(c => {
    const firstLine = c.message.split('\n')[0].trim();
    return slopCommitPatterns.some(p => p.test(firstLine));
  });

  if (slopCommits.length > 0) {
    results.push({
      name: 'commits-lazy-messages',
      passed: false,
      message: `${slopCommits.length} commit(s) have lazy/meaningless messages: ${slopCommits.map(c => `"${c.message.split('\n')[0]}"`).slice(0, 3).join(', ')}`,
      severity: 'warning',
      category: 'slop-pattern',
      score: 20,
    });
  }

  // Check: single mega-commit (slop signal)
  if (pr.commits.length === 1 && pr.additions > 500) {
    results.push({
      name: 'commits-single-mega',
      passed: false,
      message: `Single commit with ${pr.additions} additions — large changes should be broken into logical commits`,
      severity: 'warning',
      category: 'slop-pattern',
      score: 30,
    });
  }

  return results;
}
