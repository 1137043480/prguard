import { Config } from '../config/schema';
import { CheckResult, PRData } from '../config/types';

// Detect randomly generated usernames (common in spam/slop accounts)
function isSpamUsername(username: string): boolean {
  // Pattern 1: random alphanumeric (e.g., "a8k2x9q4r1")
  if (/^[a-z][a-z0-9]{8,}$/i.test(username) && !/[aeiou]{2}/i.test(username)) {
    return true;
  }

  // Pattern 2: name + random digits (e.g., "user123456789")
  if (/^[a-z]+\d{6,}$/i.test(username)) {
    return true;
  }

  // Pattern 3: repetitive patterns (e.g., "ababab123")
  if (/(.)\1{4,}/.test(username)) {
    return true;
  }

  return false;
}

export function checkContributor(pr: PRData, config: Config): CheckResult[] {
  const results: CheckResult[] = [];

  // Check: account age
  if (config.minAccountAgeDays > 0) {
    const accountCreated = new Date(pr.authorCreatedAt);
    const now = new Date();
    const ageDays = Math.floor((now.getTime() - accountCreated.getTime()) / (1000 * 60 * 60 * 24));
    const isOldEnough = ageDays >= config.minAccountAgeDays;

    results.push({
      name: 'contributor-account-age',
      passed: isOldEnough,
      message: isOldEnough
        ? `Contributor account is ${ageDays} days old`
        : `Contributor account is only ${ageDays} days old (minimum ${config.minAccountAgeDays} days) — very new accounts are more likely to submit slop`,
      severity: 'warning',
      category: 'contributor',
      score: isOldEnough ? 100 : 20,
    });
  }

  // Check: spam username detection
  if (config.detectSpamUsernames) {
    const isSpam = isSpamUsername(pr.author);
    if (isSpam) {
      results.push({
        name: 'contributor-spam-username',
        passed: false,
        message: `Username "${pr.author}" matches spam/bot patterns`,
        severity: 'warning',
        category: 'contributor',
        score: 15,
      });
    }
  }

  // Check: author association (gives extra trust)
  const trustedAssociations = ['OWNER', 'MEMBER', 'COLLABORATOR'];
  const isTrusted = trustedAssociations.includes(pr.authorAssociation);
  if (isTrusted) {
    results.push({
      name: 'contributor-trusted',
      passed: true,
      message: `Contributor is a ${pr.authorAssociation.toLowerCase()} — trusted`,
      severity: 'info',
      category: 'contributor',
      score: 100,
    });
  }

  return results;
}
