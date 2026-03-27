/**
 * GitHub Platform Adapter
 *
 * Wraps @actions/core, @actions/github, and octokit
 * to implement PlatformAdapter for GitHub Actions.
 */
import { PlatformAdapter, AuthorHistory, CrossRepoActivity } from './adapter';
import { PRData, ReviewReport } from '../config/types';
import { InlineComment } from '../ai/code-reviewer';
export declare class GitHubAdapter implements PlatformAdapter {
    readonly platformName: "github";
    private octokit;
    private owner;
    private repo;
    private prNumber;
    private prPayload;
    constructor(token: string);
    /** Check if this PR should be skipped (draft, bot, exempt, etc.) */
    shouldSkip(config: {
        exemptDraftPrs: boolean;
        exemptBots: boolean;
        exemptUsers: string[];
        exemptLabels: string[];
        disableAutoExempt: boolean;
    }): {
        skip: boolean;
        reason?: string;
    };
    fetchMRData(): Promise<PRData>;
    fetchDiff(): Promise<string>;
    fetchAuthorHistory(author: string): Promise<AuthorHistory | null>;
    fetchCrossRepoActivity(author: string, maxReposPerDay: number): Promise<CrossRepoActivity | null>;
    postComment(report: ReviewReport): Promise<void>;
    postInlineReview(pr: PRData, comments: InlineComment[]): Promise<void>;
    addLabel(label: string): Promise<void>;
    closeMR(): Promise<void>;
    getWorkspacePath(): string | undefined;
    info(message: string): void;
    warning(message: string): void;
    debug(message: string): void;
    setFailed(message: string): void;
    setOutput(name: string, value: string): void;
}
export declare function buildCommentBody(report: ReviewReport): string;
//# sourceMappingURL=github.d.ts.map