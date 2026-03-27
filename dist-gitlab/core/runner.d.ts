/**
 * Core Runner — platform-agnostic PRGuard execution logic
 *
 * Takes a PlatformAdapter and Config, runs all checks,
 * AI analysis, scoring, and reporting.
 */
import { PlatformAdapter } from '../platform/adapter';
import { Config } from '../config/schema';
/**
 * Run all PRGuard checks via the provided platform adapter.
 */
export declare function runPRGuard(adapter: PlatformAdapter, config: Config, options?: {
    verifyImports?: boolean;
    checkCodeStyle?: boolean;
    checkPrHistory?: boolean;
    checkMultiPr?: boolean;
    maxReposPerDay?: number;
    inlineReview?: boolean;
}): Promise<void>;
//# sourceMappingURL=runner.d.ts.map