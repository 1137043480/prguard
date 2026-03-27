/**
 * PRGuard — GitHub Actions Entry Point
 * 
 * This is the entry point for GitHub Actions.
 * Creates a GitHubAdapter and runs the platform-agnostic core logic.
 */

import * as core from '@actions/core';
import { buildConfig } from './config/schema';
import { GitHubAdapter } from './platform/github';
import { runPRGuard } from './core/runner';

async function run(): Promise<void> {
  try {
    // Parse configuration from action inputs
    const config = buildConfig((name) => core.getInput(name));

    // Create GitHub adapter
    const adapter = new GitHubAdapter(config.githubToken);

    // Check exemptions
    const skipCheck = adapter.shouldSkip({
      exemptDraftPrs: config.exemptDraftPrs,
      exemptBots: config.exemptBots,
      exemptUsers: config.exemptUsers,
      exemptLabels: config.exemptLabels,
      disableAutoExempt: core.getInput('disable-auto-exempt') === 'true',
    });

    if (skipCheck.skip) {
      core.info(`⏭️ Skipping: ${skipCheck.reason}`);
      core.setOutput('quality-score', '100');
      core.setOutput('passed', 'true');
      core.setOutput('failures', '0');
      return;
    }

    // Run PRGuard with adapter
    await runPRGuard(adapter, config, {
      verifyImports: core.getInput('verify-imports') !== 'false',
      checkCodeStyle: core.getInput('check-code-style') !== 'false',
      checkPrHistory: core.getInput('check-pr-history') !== 'false',
      checkMultiPr: core.getInput('check-multi-pr') !== 'false',
      maxReposPerDay: parseInt(core.getInput('max-repos-per-day') || '10'),
      inlineReview: core.getInput('inline-review') !== 'false',
    });
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`PRGuard error: ${error.message}`);
    } else {
      core.setFailed('PRGuard encountered an unknown error');
    }
  }
}

run();
