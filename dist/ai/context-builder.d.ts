import { FileData } from '../config/types';
export interface ProjectContext {
    directoryTree: string;
    relatedFiles: Array<{
        path: string;
        content: string;
    }>;
    projectInfo: string;
}
export declare function buildProjectContext(files: FileData[], workspace: string, maxRelatedFiles?: number): ProjectContext;
export declare function formatContextForPrompt(ctx: ProjectContext): string;
//# sourceMappingURL=context-builder.d.ts.map