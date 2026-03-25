import { z } from 'zod';

// Configuration schema for PRGuard
export const ConfigSchema = z.object({
  githubToken: z.string(),
  mode: z.enum(['rules', 'ai']).default('rules'),

  // AI Configuration
  ai: z.object({
    provider: z.enum(['openai', 'ollama', 'anthropic']).default('openai'),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().default('gpt-4o-mini'),
  }).default({}),

  // Scoring
  maxFailures: z.number().default(4),
  minQualityScore: z.number().min(0).max(100).default(40),

  // PR Title
  requireConventionalTitle: z.boolean().default(true),
  blockedTitlePatterns: z.array(z.string()).default([
    'Update README.md', 'Update .gitignore', 'Minor fixes', 'Quick fix'
  ]),

  // PR Description
  requireDescription: z.boolean().default(true),
  minDescriptionLength: z.number().default(30),
  maxDescriptionLength: z.number().default(5000),
  requirePrTemplate: z.boolean().default(false),

  // Commits
  requireConventionalCommits: z.boolean().default(false),
  maxCommitMessageLength: z.number().default(200),
  requireCommitAuthorMatch: z.boolean().default(true),

  // Branches
  blockedSourceBranches: z.array(z.string()).default(['main', 'master']),
  allowedTargetBranches: z.array(z.string()).default([]),

  // File Changes
  blockedFilePatterns: z.array(z.string()).default([]),
  maxFilesChanged: z.number().default(50),
  maxAdditions: z.number().default(2000),

  // Contributor
  minAccountAgeDays: z.number().default(7),
  detectSpamUsernames: z.boolean().default(true),

  // AI Slop Detection
  detectExcessiveComments: z.boolean().default(true),
  detectHallucinatedImports: z.boolean().default(true),
  maxEmojiCount: z.number().default(10),

  // Actions
  closePr: z.boolean().default(false),
  addLabel: z.string().default('needs-review'),
  commentOnPr: z.boolean().default(true),

  // Exemptions
  exemptUsers: z.array(z.string()).default([]),
  exemptBots: z.boolean().default(true),
  exemptDraftPrs: z.boolean().default(true),
  exemptLabels: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;

// Parse comma-separated string into array
function parseCSV(value: string | undefined): string[] {
  if (!value || value.trim() === '') return [];
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

// Build config from GitHub Action inputs
export function buildConfig(getInput: (name: string) => string): Config {
  return ConfigSchema.parse({
    githubToken: getInput('github-token'),
    mode: getInput('mode') || 'rules',
    ai: {
      provider: getInput('ai-provider') || 'openai',
      apiKey: getInput('ai-api-key') || undefined,
      baseUrl: getInput('ai-base-url') || undefined,
      model: getInput('ai-model') || 'gpt-4o-mini',
    },
    maxFailures: parseInt(getInput('max-failures') || '4'),
    minQualityScore: parseInt(getInput('min-quality-score') || '40'),
    requireConventionalTitle: getInput('require-conventional-title') !== 'false',
    blockedTitlePatterns: parseCSV(getInput('blocked-title-patterns')),
    requireDescription: getInput('require-description') !== 'false',
    minDescriptionLength: parseInt(getInput('min-description-length') || '30'),
    maxDescriptionLength: parseInt(getInput('max-description-length') || '5000'),
    requirePrTemplate: getInput('require-pr-template') === 'true',
    requireConventionalCommits: getInput('require-conventional-commits') === 'true',
    maxCommitMessageLength: parseInt(getInput('max-commit-message-length') || '200'),
    requireCommitAuthorMatch: getInput('require-commit-author-match') !== 'false',
    blockedSourceBranches: parseCSV(getInput('blocked-source-branches') || 'main,master'),
    allowedTargetBranches: parseCSV(getInput('allowed-target-branches')),
    blockedFilePatterns: parseCSV(getInput('blocked-file-patterns')),
    maxFilesChanged: parseInt(getInput('max-files-changed') || '50'),
    maxAdditions: parseInt(getInput('max-additions') || '2000'),
    minAccountAgeDays: parseInt(getInput('min-account-age-days') || '7'),
    detectSpamUsernames: getInput('detect-spam-usernames') !== 'false',
    detectExcessiveComments: getInput('detect-excessive-comments') !== 'false',
    detectHallucinatedImports: getInput('detect-hallucinated-imports') !== 'false',
    maxEmojiCount: parseInt(getInput('max-emoji-count') || '10'),
    closePr: getInput('close-pr') === 'true',
    addLabel: getInput('add-label') || 'needs-review',
    commentOnPr: getInput('comment-on-pr') !== 'false',
    exemptUsers: parseCSV(getInput('exempt-users')),
    exemptBots: getInput('exempt-bots') !== 'false',
    exemptDraftPrs: getInput('exempt-draft-prs') !== 'false',
    exemptLabels: parseCSV(getInput('exempt-labels')),
  });
}
