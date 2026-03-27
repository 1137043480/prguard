/**
 * Core Runner — platform-agnostic PRGuard execution logic
 * 
 * Takes a PlatformAdapter and Config, runs all checks,
 * AI analysis, scoring, and reporting.
 */

import { PlatformAdapter } from '../platform/adapter';
import { Config } from '../config/schema';
import { CheckResult } from '../config/types';
import { checkTitle } from '../checks/title';
import { checkDescription } from '../checks/description';
import { checkCommits } from '../checks/commits';
import { checkBranch } from '../checks/branch';
import { checkFiles } from '../checks/files';
import { checkContributor } from '../checks/contributor';
import { checkImports } from '../checks/import-verifier';
import { checkCodeStyle } from '../checks/style-checker';
import { calculateScore } from '../scoring/scorer';
import { createAIProvider } from '../ai/analyzer';
import { reviewCode } from '../ai/code-reviewer';

/**
 * Run all PRGuard checks via the provided platform adapter.
 */
export async function runPRGuard(
  adapter: PlatformAdapter,
  config: Config,
  options: {
    // Options that were previously read from core.getInput() directly
    verifyImports?: boolean;
    checkCodeStyle?: boolean;
    checkPrHistory?: boolean;
    checkMultiPr?: boolean;
    maxReposPerDay?: number;
    inlineReview?: boolean;
  } = {},
): Promise<void> {
  adapter.info('🛡️ PRGuard — AI-powered PR quality guardian');
  adapter.info(`Mode: ${config.mode}`);
  adapter.info(`Platform: ${adapter.platformName}`);

  // Fetch PR/MR data
  adapter.info('📊 Fetching PR data...');
  const prData = await adapter.fetchMRData();

  // Run all rule checks
  adapter.info('🔍 Running rule checks...');
  const results: CheckResult[] = [
    ...checkTitle(prData, config),
    ...checkDescription(prData, config),
    ...checkCommits(prData, config),
    ...checkBranch(prData, config),
    ...checkFiles(prData, config),
    ...checkContributor(prData, config),
  ];

  adapter.info(`📋 Rule checks complete: ${results.length} checks, ${results.filter(r => !r.passed).length} failed`);

  // V2: Advanced checks
  const workspacePath = adapter.getWorkspacePath();
  if (workspacePath) {
    adapter.info('🔬 Running advanced checks (V2)...');

    // Import verification (checkout required)
    if (options.verifyImports !== false) {
      const importResults = checkImports(prData, config, workspacePath);
      results.push(...importResults);
      adapter.info(`  📦 Import verification: ${importResults.length} checks`);
    }

    // Code style comparison
    if (options.checkCodeStyle !== false) {
      const styleResults = checkCodeStyle(prData, config, workspacePath);
      results.push(...styleResults);
      adapter.info(`  🎨 Code style: ${styleResults.length} checks`);
    }
  }

  // PR history analysis (via adapter)
  if (options.checkPrHistory !== false) {
    adapter.info('  📜 Analyzing PR history...');
    const history = await adapter.fetchAuthorHistory(prData.author);
    if (history) {
      if (history.isFirstTime) {
        results.push({
          name: 'history-first-time',
          passed: true,
          message: `⚡ First-time contributor to this repository`,
          severity: 'info',
          category: 'contributor',
          score: 50,
        });
      } else {
        const mergeRate = history.mergedPRs / history.totalPRs;
        const rejectionRate = history.rejectedPRs / history.totalPRs;

        results.push({
          name: 'history-merge-rate',
          passed: mergeRate >= 0.3,
          message: mergeRate >= 0.3
            ? `Contributor has ${Math.round(mergeRate * 100)}% merge rate (${history.mergedPRs}/${history.totalPRs} PRs merged)`
            : `⚠️ Contributor has low merge rate: ${Math.round(mergeRate * 100)}% (${history.mergedPRs}/${history.totalPRs} PRs merged, ${history.rejectedPRs} rejected)`,
          severity: mergeRate >= 0.3 ? 'info' : 'warning',
          category: 'contributor',
          score: Math.round(Math.max(20, mergeRate * 100)),
        });

        if (rejectionRate > 0.7 && history.totalPRs >= 3) {
          results.push({
            name: 'history-serial-rejected',
            passed: false,
            message: `🚩 ${Math.round(rejectionRate * 100)}% of this contributor's PRs were rejected (${history.rejectedPRs}/${history.totalPRs}) — possible spam/slop pattern`,
            severity: 'warning',
            category: 'slop-pattern',
            score: 10,
          });
        }

        if (history.mergedPRs >= 5) {
          results.push({
            name: 'history-active-contributor',
            passed: true,
            message: `✅ Active contributor with ${history.mergedPRs} merged PRs — high trust`,
            severity: 'info',
            category: 'contributor',
            score: 100,
          });
        }
      }
    }
  }

  // Multi-PR correlation detection (via adapter)
  if (options.checkMultiPr !== false) {
    adapter.info('  🕸️ Checking cross-repo PR activity...');
    const maxRepos = options.maxReposPerDay || 10;
    const activity = await adapter.fetchCrossRepoActivity(prData.author, maxRepos);
    if (activity) {
      if (activity.uniqueRepos > maxRepos) {
        results.push({
          name: 'multi-pr-spam-detected',
          passed: false,
          message: `🚨 User "${prData.author}" opened ${activity.totalPRs} PRs across ${activity.uniqueRepos} repos in the last 24h (threshold: ${maxRepos}) — strong bot/spam signal`,
          severity: 'error',
          category: 'slop-pattern',
          score: 0,
        });
      } else if (activity.totalPRs > 20) {
        results.push({
          name: 'multi-pr-high-volume',
          passed: false,
          message: `⚠️ User "${prData.author}" opened ${activity.totalPRs} PRs in the last 24h — unusually high volume`,
          severity: 'warning',
          category: 'slop-pattern',
          score: 20,
        });
      } else if (activity.totalPRs > 5 && activity.uniqueRepos > 3) {
        results.push({
          name: 'multi-pr-moderate',
          passed: true,
          message: `User opened ${activity.totalPRs} PRs across ${activity.uniqueRepos} repos in 24h — moderate activity`,
          severity: 'info',
          category: 'contributor',
          score: 70,
        });
      }
    }
  }

  adapter.info(`📋 All checks complete: ${results.length} total, ${results.filter(r => !r.passed).length} failed`);

  // Run AI analysis if configured
  let aiAnalysis;
  if (config.mode === 'ai' && config.ai.apiKey) {
    adapter.info('🤖 Running AI analysis...');
    try {
      const provider = createAIProvider(config);
      const diff = await adapter.fetchDiff();
      aiAnalysis = await provider.analyze(prData, diff);
      adapter.info('🤖 AI analysis complete');
    } catch (error) {
      adapter.warning(`AI analysis failed (continuing with rules only): ${error}`);
    }

    // V3: Line-level AI code review
    if (options.inlineReview !== false) {
      adapter.info('📝 Running line-level code review...');
      try {
        const codeReview = await reviewCode(prData, config, workspacePath || undefined);
        if (codeReview.comments.length > 0) {
          adapter.info(`📝 Found ${codeReview.comments.length} inline comment(s)`);
          await adapter.postInlineReview(prData, codeReview.comments);
        } else {
          adapter.info('📝 No inline issues found');
        }
      } catch (error) {
        adapter.warning(`Inline code review failed: ${error}`);
      }
    }
  }

  // Calculate final score
  const report = calculateScore(results, aiAnalysis);

  // Determine pass/fail
  report.passed = report.failedChecks <= config.maxFailures &&
                  report.qualityScore >= config.minQualityScore;

  adapter.info(`\n${'='.repeat(50)}`);
  adapter.info(`Quality Score: ${report.qualityScore}/100`);
  adapter.info(`Status: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);
  adapter.info(`Checks: ${report.totalChecks} total, ${report.failedChecks} failed`);
  adapter.info(`${'='.repeat(50)}\n`);

  // Set outputs
  adapter.setOutput('quality-score', report.qualityScore.toString());
  adapter.setOutput('passed', report.passed.toString());
  adapter.setOutput('failures', report.failedChecks.toString());
  adapter.setOutput('report', JSON.stringify(report));

  // Post comment
  if (config.commentOnPr) {
    adapter.info('💬 Posting review comment...');
    await adapter.postComment(report);

    // Add label on failure
    if (!report.passed && config.addLabel) {
      await adapter.addLabel(config.addLabel);
    }

    // Close PR if configured
    if (!report.passed && config.closePr) {
      await adapter.closeMR();
    }
  }

  // Set action status
  if (!report.passed) {
    adapter.setFailed(
      `PR quality check failed (score: ${report.qualityScore}/100, ` +
      `${report.failedChecks} failures, max allowed: ${config.maxFailures})`
    );
  }
}
