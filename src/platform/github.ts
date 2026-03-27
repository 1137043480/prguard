/**
 * GitHub Platform Adapter
 * 
 * Wraps @actions/core, @actions/github, and octokit
 * to implement PlatformAdapter for GitHub Actions.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { PlatformAdapter, AuthorHistory, CrossRepoActivity } from './adapter';
import { PRData, CommitData, FileData, ReviewReport } from '../config/types';
import { InlineComment, parseDiffPositions } from '../ai/code-reviewer';

const COMMENT_MARKER = '<!-- prguard-review -->';

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  suggestion: '💡',
  nitpick: '🔵',
};

export class GitHubAdapter implements PlatformAdapter {
  readonly platformName = 'github' as const;

  private octokit: ReturnType<typeof github.getOctokit>;
  private owner: string;
  private repo: string;
  private prNumber: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private prPayload: any;

  constructor(token: string) {
    const context = github.context;
    if (!context.payload.pull_request) {
      throw new Error('This action can only be run on pull_request events');
    }

    this.octokit = github.getOctokit(token);
    this.owner = context.repo.owner;
    this.repo = context.repo.repo;
    this.prNumber = context.payload.pull_request.number;
    this.prPayload = context.payload.pull_request;
  }

  /** Check if this PR should be skipped (draft, bot, exempt, etc.) */
  shouldSkip(config: {
    exemptDraftPrs: boolean;
    exemptBots: boolean;
    exemptUsers: string[];
    exemptLabels: string[];
    disableAutoExempt: boolean;
  }): { skip: boolean; reason?: string } {
    const pr = this.prPayload;

    if (config.exemptDraftPrs && pr.draft) {
      return { skip: true, reason: 'PR is a draft' };
    }

    if (config.exemptBots && pr.user.type === 'Bot') {
      return { skip: true, reason: 'PR author is a bot' };
    }

    if (config.exemptUsers.includes(pr.user.login)) {
      return { skip: true, reason: `user "${pr.user.login}" is exempt` };
    }

    const prLabels: string[] = (pr.labels || []).map((l: { name: string }) => l.name);
    if (config.exemptLabels.some(el => prLabels.includes(el))) {
      return { skip: true, reason: 'PR has exempt label' };
    }

    if (!config.disableAutoExempt) {
      const trustedAssociations = ['OWNER', 'MEMBER', 'COLLABORATOR'];
      if (trustedAssociations.includes(pr.author_association)) {
        return { skip: true, reason: `PR author is ${pr.author_association}` };
      }
    }

    return { skip: false };
  }

  async fetchMRData(): Promise<PRData> {
    const { data: commits } = await this.octokit.rest.pulls.listCommits({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
      per_page: 100,
    });

    const { data: files } = await this.octokit.rest.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
      per_page: 100,
    });

    // Fetch author details for account age check
    let authorCreatedAt = this.prPayload.user.created_at || new Date().toISOString();
    try {
      const { data: user } = await this.octokit.rest.users.getByUsername({
        username: this.prPayload.user.login,
      });
      authorCreatedAt = user.created_at;
    } catch {
      // Use payload data if user fetch fails
    }

    const commitData: CommitData[] = commits.map(c => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author?.login || c.commit.author?.name || 'unknown',
      email: c.commit.author?.email || '',
    }));

    const fileData: FileData[] = files.map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));

    return {
      number: this.prNumber,
      title: this.prPayload.title,
      body: this.prPayload.body,
      author: this.prPayload.user.login,
      authorCreatedAt,
      authorAssociation: this.prPayload.author_association,
      isDraft: this.prPayload.draft || false,
      labels: (this.prPayload.labels || []).map((l: { name: string }) => l.name),
      sourceBranch: this.prPayload.head.ref,
      targetBranch: this.prPayload.base.ref,
      commits: commitData,
      files: fileData,
      additions: this.prPayload.additions || 0,
      deletions: this.prPayload.deletions || 0,
      changedFiles: this.prPayload.changed_files || files.length,
    };
  }

  async fetchDiff(): Promise<string> {
    const { data } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
      mediaType: { format: 'diff' },
    });
    return data as unknown as string;
  }

  async fetchAuthorHistory(author: string): Promise<AuthorHistory | null> {
    try {
      const { data: authorPRs } = await this.octokit.rest.pulls.list({
        owner: this.owner,
        repo: this.repo,
        state: 'all',
        per_page: 100,
        sort: 'created',
        direction: 'desc',
      });

      const myPRs = authorPRs.filter(
        p => p.user?.login === author && p.number !== this.prNumber
      );

      if (myPRs.length === 0) {
        return { totalPRs: 0, mergedPRs: 0, rejectedPRs: 0, isFirstTime: true };
      }

      const merged = myPRs.filter(p => p.merged_at !== null);
      const closed = myPRs.filter(p => p.state === 'closed' && p.merged_at === null);

      return {
        totalPRs: myPRs.length,
        mergedPRs: merged.length,
        rejectedPRs: closed.length,
        isFirstTime: false,
      };
    } catch {
      return null;
    }
  }

  async fetchCrossRepoActivity(author: string, maxReposPerDay: number): Promise<CrossRepoActivity | null> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { data } = await this.octokit.rest.search.issuesAndPullRequests({
        q: `author:${author} type:pr created:>=${since}`,
        per_page: 100,
        sort: 'created',
      });

      const uniqueRepos = new Set<string>();
      for (const item of data.items) {
        const repoUrl = item.repository_url || '';
        uniqueRepos.add(repoUrl);
      }

      return {
        totalPRs: data.total_count,
        uniqueRepos: uniqueRepos.size,
      };
    } catch {
      return null;
    }
  }

  async postComment(report: ReviewReport): Promise<void> {
    const body = buildCommentBody(report);

    // Check for existing PRGuard comment (update instead of creating new)
    const { data: comments } = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.prNumber,
    });

    const existingComment = comments.find(c => c.body?.includes(COMMENT_MARKER));

    if (existingComment) {
      await this.octokit.rest.issues.updateComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: existingComment.id,
        body,
      });
    } else {
      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber,
        body,
      });
    }
  }

  async postInlineReview(pr: PRData, comments: InlineComment[]): Promise<void> {
    if (comments.length === 0) {
      this.info('No inline comments to post.');
      return;
    }

    // Build review comments with diff positions
    const reviewComments: Array<{ path: string; position: number; body: string }> = [];

    for (const comment of comments) {
      const file = pr.files.find(f => f.filename === comment.path);
      if (!file?.patch) continue;

      const positions = parseDiffPositions(file.patch);
      const position = positions.get(comment.line);

      if (!position) {
        this.debug(`Skipping comment on ${comment.path}:${comment.line} — line not in diff`);
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
      this.info('No valid inline comments to post (lines not in diff).');
      return;
    }

    try {
      // Delete previous PRGuard reviews to avoid duplicates
      const { data: existingReviews } = await this.octokit.rest.pulls.listReviews({
        owner: this.owner,
        repo: this.repo,
        pull_number: pr.number,
      });

      for (const review of existingReviews) {
        if (review.body?.includes('PRGuard Code Review')) {
          try {
            await this.octokit.rest.pulls.dismissReview({
              owner: this.owner,
              repo: this.repo,
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

      await this.octokit.rest.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
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

      this.info(`✅ Posted inline review with ${reviewComments.length} comments (${event})`);
    } catch (error) {
      this.warning(`Failed to post inline review: ${error}`);
    }
  }

  async addLabel(label: string): Promise<void> {
    try {
      await this.octokit.rest.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber,
        labels: [label],
      });
    } catch {
      // Label might not exist, that's okay
    }
  }

  async closeMR(): Promise<void> {
    await this.octokit.rest.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
      state: 'closed',
    });
  }

  getWorkspacePath(): string | undefined {
    return process.env.GITHUB_WORKSPACE;
  }

  // Logging — delegates to @actions/core
  info(message: string): void { core.info(message); }
  warning(message: string): void { core.warning(message); }
  debug(message: string): void { core.debug(message); }
  setFailed(message: string): void { core.setFailed(message); }
  setOutput(name: string, value: string): void { core.setOutput(name, value); }
}

// Shared comment body builder (used by both GitHub and GitLab)
export function buildCommentBody(report: ReviewReport): string {
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
