/**
 * GitLab Platform Adapter
 * 
 * Uses GitLab REST API (v4) to implement PlatformAdapter.
 * Works with both gitlab.com and self-hosted GitLab instances.
 */

import { PlatformAdapter, AuthorHistory, CrossRepoActivity } from './adapter';
import { PRData, CommitData, FileData, ReviewReport } from '../config/types';
import { InlineComment, parseDiffPositions } from '../ai/code-reviewer';
import { buildCommentBody } from './github';

const COMMENT_MARKER = '<!-- prguard-review -->';

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '🔴',
  warning: '🟡',
  suggestion: '💡',
  nitpick: '🔵',
};

interface GitLabConfig {
  token: string;
  gitlabUrl: string;    // e.g. https://gitlab.com or https://gitlab.mycompany.com
  projectId: string;    // CI_PROJECT_ID
  mrIid: string;        // CI_MERGE_REQUEST_IID
}

export class GitLabAdapter implements PlatformAdapter {
  readonly platformName = 'gitlab' as const;

  private token: string;
  private baseUrl: string;
  private projectId: string;
  private mrIid: string;

  constructor(config: GitLabConfig) {
    this.token = config.token;
    this.baseUrl = `${config.gitlabUrl.replace(/\/$/, '')}/api/v4`;
    this.projectId = config.projectId;
    this.mrIid = config.mrIid;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async api(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitLab API error ${response.status}: ${text}`);
    }

    // Some endpoints return empty body
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  private get mrPath(): string {
    return `/projects/${encodeURIComponent(this.projectId)}/merge_requests/${this.mrIid}`;
  }

  async fetchMRData(): Promise<PRData> {
    // Fetch MR details
    const mr = await this.api(this.mrPath);

    // Fetch commits
    const commits = await this.api(`${this.mrPath}/commits`);

    // Fetch changes (files)
    const changes = await this.api(`${this.mrPath}/changes`);

    // Fetch author details for account age
    let authorCreatedAt = new Date().toISOString();
    try {
      const user = await this.api(`/users?username=${encodeURIComponent(mr.author.username)}`);
      if (user.length > 0) {
        authorCreatedAt = user[0].created_at;
      }
    } catch {
      // Use current time if user fetch fails
    }

    const commitData: CommitData[] = (commits || []).map((c: {
      id: string;
      message: string;
      author_name: string;
      author_email: string;
    }) => ({
      sha: c.id,
      message: c.message,
      author: c.author_name || 'unknown',
      email: c.author_email || '',
    }));

    const fileData: FileData[] = (changes.changes || []).map((f: {
      new_path: string;
      new_file: boolean;
      renamed_file: boolean;
      deleted_file: boolean;
      diff: string;
    }) => {
      // Calculate additions/deletions from diff
      const lines = (f.diff || '').split('\n');
      const additions = lines.filter((l: string) => l.startsWith('+') && !l.startsWith('+++')).length;
      const deletions = lines.filter((l: string) => l.startsWith('-') && !l.startsWith('---')).length;
      const status = f.new_file ? 'added' : f.deleted_file ? 'removed' : f.renamed_file ? 'renamed' : 'modified';

      return {
        filename: f.new_path,
        status,
        additions,
        deletions,
        patch: f.diff,
      };
    });

    // Calculate total additions/deletions
    const totalAdditions = fileData.reduce((sum: number, f: FileData) => sum + f.additions, 0);
    const totalDeletions = fileData.reduce((sum: number, f: FileData) => sum + f.deletions, 0);

    // Map GitLab access level to GitHub-like association
    // GitLab doesn't have the same concept, so we approximate
    let authorAssociation = 'NONE';
    try {
      const members = await this.api(`/projects/${encodeURIComponent(this.projectId)}/members/all?user_ids=${mr.author.id}`);
      if (members.length > 0) {
        const accessLevel = members[0].access_level;
        // GitLab access levels: 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner
        if (accessLevel >= 50) authorAssociation = 'OWNER';
        else if (accessLevel >= 40) authorAssociation = 'MEMBER';
        else if (accessLevel >= 30) authorAssociation = 'COLLABORATOR';
      }
    } catch {
      // Skip if member check fails
    }

    return {
      number: parseInt(this.mrIid),
      title: mr.title,
      body: mr.description,
      author: mr.author.username,
      authorCreatedAt,
      authorAssociation,
      isDraft: mr.draft || mr.work_in_progress || false,
      labels: mr.labels || [],
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      commits: commitData,
      files: fileData,
      additions: totalAdditions,
      deletions: totalDeletions,
      changedFiles: fileData.length,
    };
  }

  async fetchDiff(): Promise<string> {
    // Fetch MR changes and concatenate diffs
    const changes = await this.api(`${this.mrPath}/changes`);
    return (changes.changes || [])
      .map((f: { new_path: string; diff: string }) =>
        `diff --git a/${f.new_path} b/${f.new_path}\n${f.diff || ''}`
      )
      .join('\n');
  }

  async fetchAuthorHistory(author: string): Promise<AuthorHistory | null> {
    try {
      // Fetch MRs by this author in this project
      const mrs = await this.api(
        `/projects/${encodeURIComponent(this.projectId)}/merge_requests?author_username=${encodeURIComponent(author)}&state=all&per_page=100`
      );

      const myMRs = (mrs || []).filter(
        (m: { iid: number }) => m.iid !== parseInt(this.mrIid)
      );

      if (myMRs.length === 0) {
        return { totalPRs: 0, mergedPRs: 0, rejectedPRs: 0, isFirstTime: true };
      }

      const merged = myMRs.filter((m: { state: string }) => m.state === 'merged');
      const closed = myMRs.filter((m: { state: string }) => m.state === 'closed');

      return {
        totalPRs: myMRs.length,
        mergedPRs: merged.length,
        rejectedPRs: closed.length,
        isFirstTime: false,
      };
    } catch {
      return null;
    }
  }

  async fetchCrossRepoActivity(_author: string, _maxReposPerDay: number): Promise<CrossRepoActivity | null> {
    // GitLab API doesn't support cross-project search the same way GitHub does.
    // On self-hosted instances, we can't search globally.
    // Return null to indicate this feature is not available.
    this.info('ℹ️ Cross-repo activity detection is not available on GitLab');
    return null;
  }

  async postComment(report: ReviewReport): Promise<void> {
    const body = buildCommentBody(report);

    // Check for existing PRGuard comment
    const notes = await this.api(`${this.mrPath}/notes?per_page=100&sort=desc`);
    const existingNote = (notes || []).find(
      (n: { body: string; system: boolean }) => !n.system && n.body?.includes(COMMENT_MARKER)
    );

    if (existingNote) {
      // Update existing note
      await this.api(`${this.mrPath}/notes/${existingNote.id}`, {
        method: 'PUT',
        body: JSON.stringify({ body }),
      });
    } else {
      // Create new note
      await this.api(`${this.mrPath}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    }
  }

  async postInlineReview(pr: PRData, comments: InlineComment[]): Promise<void> {
    if (comments.length === 0) {
      this.info('No inline comments to post.');
      return;
    }

    // Fetch MR version info for position
    let baseSha = '';
    let headSha = '';
    let startSha = '';
    try {
      const versions = await this.api(`${this.mrPath}/versions`);
      if (versions.length > 0) {
        baseSha = versions[0].base_commit_sha;
        headSha = versions[0].head_commit_sha;
        startSha = versions[0].start_commit_sha;
      }
    } catch {
      this.warning('Failed to fetch MR versions for inline comments');
      return;
    }

    let postedCount = 0;
    for (const comment of comments) {
      const file = pr.files.find(f => f.filename === comment.path);
      if (!file?.patch) continue;

      // Verify line is in the diff
      const positions = parseDiffPositions(file.patch);
      if (!positions.has(comment.line)) {
        this.debug(`Skipping comment on ${comment.path}:${comment.line} — line not in diff`);
        continue;
      }

      const emoji = SEVERITY_EMOJI[comment.severity] || '💬';
      const body = `${emoji} **${comment.severity.toUpperCase()}**: ${comment.body}`;

      try {
        await this.api(`${this.mrPath}/discussions`, {
          method: 'POST',
          body: JSON.stringify({
            body,
            position: {
              base_sha: baseSha,
              start_sha: startSha,
              head_sha: headSha,
              position_type: 'text',
              new_path: comment.path,
              new_line: comment.line,
            },
          }),
        });
        postedCount++;
      } catch (error) {
        this.debug(`Failed to post inline comment on ${comment.path}:${comment.line}: ${error}`);
      }
    }

    if (postedCount > 0) {
      this.info(`✅ Posted ${postedCount} inline discussion comment(s)`);
    }
  }

  async addLabel(label: string): Promise<void> {
    try {
      // GitLab: update MR labels (append to existing)
      const mr = await this.api(this.mrPath);
      const currentLabels: string[] = mr.labels || [];
      if (!currentLabels.includes(label)) {
        await this.api(this.mrPath, {
          method: 'PUT',
          body: JSON.stringify({ labels: [...currentLabels, label].join(',') }),
        });
      }
    } catch {
      // Label operation failed, skip
    }
  }

  async closeMR(): Promise<void> {
    await this.api(this.mrPath, {
      method: 'PUT',
      body: JSON.stringify({ state_event: 'close' }),
    });
  }

  getWorkspacePath(): string | undefined {
    return process.env.CI_PROJECT_DIR;
  }

  // Logging — uses console since @actions/core is not available in GitLab CI
  info(message: string): void { console.log(`[PRGuard] ${message}`); }
  warning(message: string): void { console.warn(`[PRGuard] ⚠️ ${message}`); }
  debug(message: string): void {
    if (process.env.PRGUARD_DEBUG === 'true') {
      console.log(`[PRGuard:debug] ${message}`);
    }
  }
  setFailed(message: string): void {
    console.error(`[PRGuard] ❌ ${message}`);
    process.exitCode = 1;
  }
  setOutput(name: string, value: string): void {
    // GitLab CI: write outputs to dotenv file for downstream jobs
    const outputFile = process.env.PRGUARD_OUTPUT_FILE;
    if (outputFile) {
      const fs = require('fs');
      fs.appendFileSync(outputFile, `PRGUARD_${name.toUpperCase().replace(/-/g, '_')}=${value}\n`);
    }
    console.log(`[PRGuard:output] ${name}=${value}`);
  }
}
