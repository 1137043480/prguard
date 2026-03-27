import { Config } from '../config/schema';
import { PRData, AIAnalysisResult } from '../config/types';
export interface AIProvider {
    analyze(pr: PRData, diff: string): Promise<AIAnalysisResult>;
}
export declare class OpenAICompatibleProvider implements AIProvider {
    private apiKey;
    private baseUrl;
    private model;
    constructor(config: Config);
    analyze(pr: PRData, diff: string): Promise<AIAnalysisResult>;
}
export declare class AnthropicProvider implements AIProvider {
    private apiKey;
    private model;
    constructor(config: Config);
    analyze(pr: PRData, diff: string): Promise<AIAnalysisResult>;
}
export declare function createAIProvider(config: Config): AIProvider;
//# sourceMappingURL=analyzer.d.ts.map