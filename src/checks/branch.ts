import { Config } from '../config/schema';
import { CheckResult, PRData } from '../config/types';

export function checkBranch(pr: PRData, config: Config): CheckResult[] {
  const results: CheckResult[] = [];

  // Check: source branch not in blocked list
  if (config.blockedSourceBranches.length > 0) {
    const isBlocked = config.blockedSourceBranches.some(
      b => pr.sourceBranch.toLowerCase() === b.toLowerCase()
    );
    results.push({
      name: 'branch-source-blocked',
      passed: !isBlocked,
      message: isBlocked
        ? `Source branch "${pr.sourceBranch}" is blocked — PRs from default branches are a common slop pattern`
        : `Source branch "${pr.sourceBranch}" is allowed`,
      severity: 'error',
      category: 'branch',
      score: isBlocked ? 0 : 100,
    });
  }

  // Check: target branch is allowed
  if (config.allowedTargetBranches.length > 0) {
    const isAllowed = config.allowedTargetBranches.some(
      b => pr.targetBranch.toLowerCase() === b.toLowerCase()
    );
    results.push({
      name: 'branch-target-allowed',
      passed: isAllowed,
      message: isAllowed
        ? `Target branch "${pr.targetBranch}" is allowed`
        : `Target branch "${pr.targetBranch}" is not in the allowed list`,
      severity: 'error',
      category: 'branch',
      score: isAllowed ? 100 : 0,
    });
  }

  // Check: branch naming convention
  const branchNameRegex = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?(\/.+)?$/;
  const hasGoodName = branchNameRegex.test(pr.sourceBranch);
  if (!hasGoodName && pr.sourceBranch.length > 0) {
    results.push({
      name: 'branch-naming',
      passed: false,
      message: `Source branch "${pr.sourceBranch}" has unusual naming — consider using lowercase with hyphens (e.g., "feat/add-feature")`,
      severity: 'info',
      category: 'branch',
      score: 50,
    });
  }

  return results;
}
