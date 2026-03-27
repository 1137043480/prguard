/**
 * Platform Adapter Interface
 *
 * Abstracts away GitHub/GitLab differences so core logic
 * (rule checks, AI analysis, scoring) stays platform-agnostic.
 */
import { PRData, ReviewReport } from '../config/types';
import { InlineComment } from '../ai/code-reviewer';
export interface AuthorHistory {
    totalPRs: number;
    mergedPRs: number;
    rejectedPRs: number;
    isFirstTime: boolean;
}
export interface CrossRepoActivity {
    totalPRs: number;
    uniqueRepos: number;
}
/**
 * PlatformAdapter — unified interface for GitHub and GitLab
 */
export interface PlatformAdapter {
    /** Platform name for logging */
    readonly platformName: 'github' | 'gitlab';
    /** Fetch full MR/PR data (title, body, commits, files, etc.) */
    fetchMRData(): Promise<PRData>;
    /** Fetch raw diff for AI analysis */
    fetchDiff(): Promise<string>;
    /** Fetch author's PR history on this repo */
    fetchAuthorHistory(author: string): Promise<AuthorHistory | null>;
    /** Fetch cross-repo PR activity (may return null if unsupported) */
    fetchCrossRepoActivity(author: string, maxReposPerDay: number): Promise<CrossRepoActivity | null>;
    /** Post or update a review comment on the MR/PR */
    postComment(report: ReviewReport): Promise<void>;
    /** Post inline (line-level) review comments */
    postInlineReview(pr: PRData, comments: InlineComment[]): Promise<void>;
    /** Add a label to the MR/PR */
    addLabel(label: string): Promise<void>;
    /** Close the MR/PR */
    closeMR(): Promise<void>;
    /** Get workspace/checkout path (GITHUB_WORKSPACE or CI_PROJECT_DIR) */
    getWorkspacePath(): string | undefined;
    info(message: string): void;
    warning(message: string): void;
    debug(message: string): void;
    setFailed(message: string): void;
    setOutput(name: string, value: string): void;
}
//# sourceMappingURL=adapter.d.ts.map