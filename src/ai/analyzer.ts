import { Config } from '../config/schema';
import { PRData, AIAnalysisResult } from '../config/types';

export interface AIProvider {
  analyze(pr: PRData, diff: string): Promise<AIAnalysisResult>;
}

// System prompt for AI analysis
const SYSTEM_PROMPT = `You are PRGuard, an AI code review assistant specialized in detecting AI-generated "slop" pull requests and assessing PR quality.

Your job is to analyze a pull request and provide:
1. An overall assessment of the PR quality
2. Indicators of AI-generated slop (if any)
3. Code quality notes
4. Convention violations
5. Actionable suggestions

AI Slop Indicators to look for:
- Hallucinated API calls (calling functions/methods that don't exist in the project)
- Over-engineering (unnecessary abstractions, design patterns for simple problems)
- Context blindness (ignoring existing project patterns and conventions)
- Excessive comments that merely restate what code does
- Generic variable/function names that don't match project style
- Boilerplate code that adds no real value
- "Slopsquatting" - importing non-existent packages

Be fair and objective. Not all AI-assisted code is bad. Focus on genuine quality issues.

Respond in JSON format:
{
  "overallAssessment": "Brief 1-2 sentence assessment",
  "slopIndicators": ["list of specific slop indicators found, empty if none"],
  "codeQualityNotes": ["list of code quality observations"],
  "conventionViolations": ["list of project convention violations"],
  "suggestions": ["actionable improvement suggestions"],
  "confidence": 0.0-1.0 (how confident you are that this is a quality PR, 1.0 = definitely good, 0.0 = definitely slop)
}`;

// Build user prompt from PR data
function buildUserPrompt(pr: PRData, diff: string): string {
  const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n... (truncated)' : diff;

  return `## Pull Request #${pr.number}

**Title:** ${pr.title}
**Author:** ${pr.author} (association: ${pr.authorAssociation})
**Branch:** ${pr.sourceBranch} → ${pr.targetBranch}
**Changes:** +${pr.additions} -${pr.deletions} across ${pr.changedFiles} files

**Description:**
${pr.body || '(no description)'}

**Commits:**
${pr.commits.map(c => `- ${c.message}`).join('\n')}

**Files Changed:**
${pr.files.map(f => `- ${f.filename} (+${f.additions} -${f.deletions})`).join('\n')}

**Diff:**
\`\`\`
${truncatedDiff}
\`\`\`

Analyze this PR for quality and AI slop indicators.`;
}

// OpenAI-compatible provider (works with OpenAI, Ollama, and compatible APIs)
export class OpenAICompatibleProvider implements AIProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: Config) {
    this.apiKey = config.ai.apiKey || '';
    this.baseUrl = config.ai.baseUrl || 'https://api.openai.com/v1';
    this.model = config.ai.model;
  }

  async analyze(pr: PRData, diff: string): Promise<AIAnalysisResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(pr, diff) },
        ],
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AI provider API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('AI provider returned empty response');
    }

    try {
      const result = JSON.parse(content) as AIAnalysisResult;
      return {
        overallAssessment: result.overallAssessment || 'Unable to assess',
        slopIndicators: result.slopIndicators || [],
        codeQualityNotes: result.codeQualityNotes || [],
        conventionViolations: result.conventionViolations || [],
        suggestions: result.suggestions || [],
        confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
      };
    } catch {
      throw new Error(`Failed to parse AI response as JSON: ${content.slice(0, 200)}`);
    }
  }
}

// Anthropic provider
export class AnthropicProvider implements AIProvider {
  private apiKey: string;
  private model: string;

  constructor(config: Config) {
    this.apiKey = config.ai.apiKey || '';
    this.model = config.ai.model || 'claude-sonnet-4-20250514';
  }

  async analyze(pr: PRData, diff: string): Promise<AIAnalysisResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: buildUserPrompt(pr, diff) },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ text: string }>;
    };
    const content = data.content?.[0]?.text;

    if (!content) {
      throw new Error('Anthropic returned empty response');
    }

    // Extract JSON from response (Anthropic may wrap it in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from Anthropic response');
    }

    const result = JSON.parse(jsonMatch[0]) as AIAnalysisResult;
    return {
      overallAssessment: result.overallAssessment || 'Unable to assess',
      slopIndicators: result.slopIndicators || [],
      codeQualityNotes: result.codeQualityNotes || [],
      conventionViolations: result.conventionViolations || [],
      suggestions: result.suggestions || [],
      confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
    };
  }
}

// Factory to create the appropriate AI provider
export function createAIProvider(config: Config): AIProvider {
  switch (config.ai.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
    case 'ollama':
    default:
      return new OpenAICompatibleProvider(config);
  }
}
