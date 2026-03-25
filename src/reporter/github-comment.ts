import * as github from '@actions/github';
import { ReviewReport } from '../config/types';

const COMMENT_MARKER = '<!-- prguard-review -->';

export async function postReviewComment(
  token: string,
  report: ReviewReport,
  closePr: boolean,
  addLabel: string,
): Promise<void> {
  const octokit = github.getOctokit(token);
  const context = github.context;

  if (!context.payload.pull_request) {
    throw new Error('No pull request found in context');
  }

  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request.number;

  // Build comment body
  const body = buildCommentBody(report);

  // Check for existing PRGuard comment (update instead of creating new)
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existingComment = comments.find(c => c.body?.includes(COMMENT_MARKER));

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }

  // Add label on failure
  if (!report.passed && addLabel) {
    try {
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: prNumber,
        labels: [addLabel],
      });
    } catch {
      // Label might not exist, that's okay
    }
  }

  // Close PR if configured
  if (!report.passed && closePr) {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: prNumber,
      state: 'closed',
    });
  }
}

function buildCommentBody(report: ReviewReport): string {
  const statusIcon = report.passed ? '✅' : '❌';
  const statusText = report.passed ? 'Passed' : 'Failed';

  return `${COMMENT_MARKER}
## ${statusIcon} PRGuard Review — ${statusText}

${report.summary}

---

<details>
<summary>📊 Detailed Results (${report.totalChecks} checks, ${report.failedChecks} failed)</summary>

| Check | Status | Category | Details |
|-------|--------|----------|---------|
${report.results.map(r => {
  const icon = r.passed ? '✅' : r.severity === 'error' ? '❌' : '⚠️';
  return `| ${r.name} | ${icon} | ${r.category} | ${r.message.split('\n')[0]} |`;
}).join('\n')}

</details>

---
<sub>🛡️ <a href="https://github.com/1137043480/prguard">PRGuard</a> — AI-powered PR quality guardian | <a href="https://github.com/1137043480/prguard/issues">Report Issue</a></sub>
`;
}
