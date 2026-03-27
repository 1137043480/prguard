/**
 * PRGuard — GitLab CI Entry Point
 * 
 * This is the entry point for GitLab CI/CD pipelines.
 * Reads configuration from environment variables,
 * creates a GitLabAdapter, and runs the core logic.
 * 
 * Required environment variables (auto-injected by GitLab CI):
 *   CI_MERGE_REQUEST_IID  — MR internal ID
 *   CI_PROJECT_ID         — Project ID
 *   CI_SERVER_URL         — GitLab instance URL
 * 
 * Required user-defined variables:
 *   GITLAB_TOKEN          — GitLab API token (Personal or Project)
 * 
 * Optional configuration (env vars):
 *   PRGUARD_MODE          — "rules" or "ai" (default: "rules")
 *   PRGUARD_AI_PROVIDER   — "openai", "ollama", "anthropic"
 *   PRGUARD_AI_API_KEY    — API key for AI provider
 *   PRGUARD_AI_BASE_URL   — Custom API base URL
 *   PRGUARD_AI_MODEL      — AI model name
 *   PRGUARD_MAX_FAILURES  — Max failures before action (default: 4)
 *   PRGUARD_MIN_SCORE     — Min quality score (default: 40)
 *   PRGUARD_CLOSE_MR      — "true" to close failing MRs
 *   PRGUARD_ADD_LABEL     — Label to add on failure
 *   ... (see buildConfigFromEnv for full list)
 */

import { buildConfigFromEnv } from './config/schema';
import { GitLabAdapter } from './platform/gitlab';
import { runPRGuard } from './core/runner';

async function run(): Promise<void> {
  try {
    // Validate required environment variables
    const mrIid = process.env.CI_MERGE_REQUEST_IID;
    const projectId = process.env.CI_PROJECT_ID;
    const serverUrl = process.env.CI_SERVER_URL;
    const token = process.env.GITLAB_TOKEN;

    if (!mrIid) {
      console.error('[PRGuard] ❌ CI_MERGE_REQUEST_IID not set. This job must run on merge_request events.');
      console.error('[PRGuard] Add this to your .gitlab-ci.yml:');
      console.error('  rules:');
      console.error('    - if: \'$CI_PIPELINE_SOURCE == "merge_request_event"\'');
      process.exitCode = 1;
      return;
    }

    if (!token) {
      console.error('[PRGuard] ❌ GITLAB_TOKEN not set.');
      console.error('[PRGuard] Create a Project or Personal Access Token with "api" scope,');
      console.error('[PRGuard] then add it as a CI/CD variable: Settings → CI/CD → Variables');
      process.exitCode = 1;
      return;
    }

    if (!projectId || !serverUrl) {
      console.error('[PRGuard] ❌ CI_PROJECT_ID or CI_SERVER_URL not available.');
      console.error('[PRGuard] These are normally auto-injected by GitLab CI.');
      process.exitCode = 1;
      return;
    }

    // Parse configuration from environment variables
    const config = buildConfigFromEnv();

    // Create GitLab adapter
    const adapter = new GitLabAdapter({
      token,
      gitlabUrl: serverUrl,
      projectId,
      mrIid,
    });

    // Parse options from environment variables
    const env = (name: string, fallback: string = '') =>
      process.env[`PRGUARD_${name}`] || fallback;

    // Run PRGuard with adapter
    await runPRGuard(adapter, config, {
      verifyImports: env('VERIFY_IMPORTS') !== 'false',
      checkCodeStyle: env('CHECK_CODE_STYLE') !== 'false',
      checkPrHistory: env('CHECK_PR_HISTORY') !== 'false',
      checkMultiPr: env('CHECK_MULTI_PR') !== 'false',
      maxReposPerDay: parseInt(env('MAX_REPOS_PER_DAY', '10')),
      inlineReview: env('INLINE_REVIEW') !== 'false',
    });
  } catch (error) {
    console.error(`[PRGuard] ❌ Fatal error: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

run();
