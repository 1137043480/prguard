import * as github from '@actions/github';
import * as core from '@actions/core';
import { InlineComment, parseDiffPositions } from '../ai/code-reviewer';
import { PRData } from '../config/types';

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  suggestion: '💡',
  nitpick: '🔵',
};

// Post inline review comments using GitHub Pull Request Review API
export async function postInlineReview(
  token: string,
  pr: PRData,
  comments: InlineComment[],
): Promise<void> {
  if (comments.length === 0) {
    core.info('No inline comments to post.');
    return;
  }

  const context = github.context;
  const octokit = github.getOctokit(token);
  const { owner, repo } = context.repo;

  // Build review comments with diff positions
  const reviewComments: Array<{
    path: string;
    position: number;
    body: string;
  }> = [];

  for (const comment of comments) {
    // Find the file's patch to get position mapping
    const file = pr.files.find(f => f.filename === comment.path);
    if (!file?.patch) continue;

    const positions = parseDiffPositions(file.patch);
    const position = positions.get(comment.line);

    if (!position) {
      core.debug(`Skipping comment on ${comment.path}:${comment.line} — line not in diff`);
      continue;
    }

    const emoji = SEVERITY_EMOJI[comment.severity] || '💬';
    reviewComments.push({
      path: comment.path,
      position,
      body: `${emoji} **${comment.severity.toUpperCase()}**: ${comment.body}`,
    });
  }

  if (reviewComments.length === 0) {
    core.info('No valid inline comments to post (lines not in diff).');
    return;
  }

  try {
    // Delete previous PRGuard reviews to avoid duplicates
    const { data: existingReviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pr.number,
    });

    // Find and dismiss old PRGuard reviews
    for (const review of existingReviews) {
      if (review.body?.includes('PRGuard Code Review')) {
        try {
          await octokit.rest.pulls.dismissReview({
            owner,
            repo,
            pull_number: pr.number,
            review_id: review.id,
            message: 'Superseded by new PRGuard review',
          });
        } catch {
          // Can't dismiss — might not have permission, skip
        }
      }
    }

    // Create the review with inline comments
    const criticalCount = comments.filter(c => c.severity === 'critical').length;
    const event = criticalCount > 0 ? 'REQUEST_CHANGES' : 'COMMENT';

    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pr.number,
      event: event as 'COMMENT' | 'REQUEST_CHANGES',
      body: `## 🛡️ PRGuard Code Review\n\n` +
        `Found **${reviewComments.length}** issue(s) across the changed files.\n\n` +
        `| Severity | Count |\n|----------|-------|\n` +
        `| 🔴 Critical | ${comments.filter(c => c.severity === 'critical').length} |\n` +
        `| 🟡 Warning | ${comments.filter(c => c.severity === 'warning').length} |\n` +
        `| 💡 Suggestion | ${comments.filter(c => c.severity === 'suggestion').length} |\n` +
        `| 🔵 Nitpick | ${comments.filter(c => c.severity === 'nitpick').length} |\n\n` +
        `---\n<sub>🛡️ <a href="https://github.com/1137043480/prguard">PRGuard</a> — AI-powered code review</sub>`,
      comments: reviewComments,
    });

    core.info(`✅ Posted inline review with ${reviewComments.length} comments (${event})`);
  } catch (error) {
    core.warning(`Failed to post inline review: ${error}`);
  }
}
