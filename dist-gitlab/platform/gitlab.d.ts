/**
 * GitLab Platform Adapter
 *
 * Uses GitLab REST API (v4) to implement PlatformAdapter.
 * Works with both gitlab.com and self-hosted GitLab instances.
 */
import { PlatformAdapter, AuthorHistory, CrossRepoActivity } from './adapter';
import { PRData, ReviewReport } from '../config/types';
import { InlineComment } from '../ai/code-reviewer';
interface GitLabConfig {
    token: string;
    gitlabUrl: string;
    projectId: string;
    mrIid: string;
}
export declare class GitLabAdapter implements PlatformAdapter {
    readonly platformName: "gitlab";
    private token;
    private baseUrl;
    private projectId;
    private mrIid;
    constructor(config: GitLabConfig);
    private api;
    private get mrPath();
    fetchMRData(): Promise<PRData>;
    fetchDiff(): Promise<string>;
    fetchAuthorHistory(author: string): Promise<AuthorHistory | null>;
    fetchCrossRepoActivity(_author: string, _maxReposPerDay: number): Promise<CrossRepoActivity | null>;
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
export {};
//# sourceMappingURL=gitlab.d.ts.map