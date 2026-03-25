import { Config } from '../config/schema';
import { PRData, FileData } from '../config/types';

export interface InlineComment {
  path: string;
  line: number;
  body: string;
  severity: 'critical' | 'warning' | 'suggestion' | 'nitpick';
}

export interface CodeReviewResult {
  comments: InlineComment[];
  summary: string;
}

const CODE_REVIEW_PROMPT = `You are PRGuard, an expert code reviewer. Review the following code diff and provide specific, actionable line-level feedback.

For each issue you find, provide:
- The exact filename
- The exact line number in the NEW file (from the diff header @@ ... +LINE,COUNT @@)
- A concise, helpful comment
- Severity: "critical" (bugs, security), "warning" (potential issues), "suggestion" (improvements), "nitpick" (style/minor)

Focus on:
1. Bugs and logic errors
2. Security vulnerabilities (SQL injection, XSS, hardcoded secrets)
3. Unused imports or variables
4. Non-existent imports or API calls
5. Poor error handling
6. Performance issues
7. Naming and style inconsistencies with the project
8. Missing edge case handling

Rules:
- Be specific, not generic. Reference actual code.
- Maximum 10 comments per file to avoid noise.
- Don't comment on things that are correct and obvious.
- Be constructive, not dismissive.

Respond in JSON:
{
  "comments": [
    {"path": "src/file.ts", "line": 15, "body": "Description of issue", "severity": "warning"}
  ],
  "summary": "Brief 1-sentence overall assessment"
}`;

// Parse diff to extract line mappings (we need "position" for GitHub API)
function parseDiffPositions(patch: string): Map<number, number> {
  const lineToPosition = new Map<number, number>();
  const lines = patch.split('\n');
  let newLine = 0;
  let position = 0;

  for (const line of lines) {
    position++;

    // Parse hunk header: @@ -old,count +new,count @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }

    if (line.startsWith('+')) {
      newLine++;
      lineToPosition.set(newLine, position);
    } else if (line.startsWith('-')) {
      // Deleted line — don't increment newLine
    } else {
      // Context line
      newLine++;
      lineToPosition.set(newLine, position);
    }
  }

  return lineToPosition;
}

// Build prompt for a single file's diff
function buildFileReviewPrompt(file: FileData, prTitle: string): string {
  const truncatedPatch = file.patch && file.patch.length > 6000
    ? file.patch.slice(0, 6000) + '\n... (truncated)'
    : file.patch || '';

  return `## Reviewing: ${file.filename}
**PR Title:** ${prTitle}
**Changes:** +${file.additions} -${file.deletions}

\`\`\`diff
${truncatedPatch}
\`\`\`

Review this diff and provide line-level comments.`;
}

// Call AI to review a single file
async function reviewFile(
  file: FileData,
  prTitle: string,
  config: Config,
): Promise<InlineComment[]> {
  if (!file.patch || file.additions === 0) return [];

  // Skip binary/generated files
  if (/\.(lock|min\.|bundle\.|map|woff|ttf|png|jpg|svg)/.test(file.filename)) return [];

  const baseUrl = config.ai.baseUrl || 'https://api.openai.com/v1';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages: [
        { role: 'system', content: CODE_REVIEW_PROMPT },
        { role: 'user', content: buildFileReviewPrompt(file, prTitle) },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    return []; // Silently skip on API error
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as { comments?: InlineComment[] };
    return (parsed.comments || []).map(c => ({
      ...c,
      path: file.filename, // Ensure correct path
    }));
  } catch {
    return [];
  }
}

// Main: review all files in a PR
export async function reviewCode(
  pr: PRData,
  config: Config,
): Promise<CodeReviewResult> {
  // Filter to reviewable files (code files with patches)
  const reviewableFiles = pr.files.filter(f =>
    f.patch &&
    f.additions > 0 &&
    /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|cpp|cs|swift|kt)$/.test(f.filename)
  );

  if (reviewableFiles.length === 0) {
    return { comments: [], summary: 'No code files to review.' };
  }

  // Limit to 5 files to avoid excessive API calls
  const filesToReview = reviewableFiles.slice(0, 5);
  const allComments: InlineComment[] = [];

  // Review files (sequential to respect rate limits)
  for (const file of filesToReview) {
    const comments = await reviewFile(file, pr.title, config);
    allComments.push(...comments);
  }

  // Validate line numbers exist in diff
  const validComments = allComments.filter(c => {
    const file = pr.files.find(f => f.filename === c.path);
    if (!file?.patch) return false;
    const positions = parseDiffPositions(file.patch);
    return positions.has(c.line);
  });

  const summary = validComments.length > 0
    ? `Found ${validComments.length} issue(s) across ${filesToReview.length} file(s).`
    : 'No issues found in code review.';

  return { comments: validComments, summary };
}

// Export for use in reporter
export { parseDiffPositions };
