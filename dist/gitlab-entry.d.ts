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
export {};
