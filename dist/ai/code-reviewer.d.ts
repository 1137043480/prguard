import { Config } from '../config/schema';
import { PRData } from '../config/types';
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
declare function parseDiffPositions(patch: string): Map<number, number>;
export declare function reviewCode(pr: PRData, config: Config, workspacePath?: string): Promise<CodeReviewResult>;
export { parseDiffPositions };
//# sourceMappingURL=code-reviewer.d.ts.map