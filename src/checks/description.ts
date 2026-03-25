import { Config } from '../config/schema';
import { CheckResult, PRData } from '../config/types';

// Count emoji in text
function countEmoji(text: string): number {
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

// Detect AI-typical description patterns
function detectAISlopDescription(body: string): string[] {
  const signals: string[] = [];

  // Overly structured with ## headers
  const headerCount = (body.match(/^#{1,3}\s/gm) || []).length;
  if (headerCount > 6) {
    signals.push(`Excessive markdown headers (${headerCount}) — typical of AI-generated descriptions`);
  }

  // Bullet point overload
  const bulletCount = (body.match(/^[\s]*[-*]\s/gm) || []).length;
  if (bulletCount > 15) {
    signals.push(`Excessive bullet points (${bulletCount}) — typical of AI-generated descriptions`);
  }

  // Generic filler phrases
  const fillerPhrases = [
    'this pr aims to',
    'this pull request introduces',
    'this change enhances',
    'improve overall',
    'ensure consistency',
    'best practices',
    'maintainability and readability',
    'comprehensive solution',
    'seamless integration',
    'robust implementation',
    'leverages the power',
    'state-of-the-art',
  ];
  const lowerBody = body.toLowerCase();
  const matchedFillers = fillerPhrases.filter(p => lowerBody.includes(p));
  if (matchedFillers.length >= 3) {
    signals.push(`Multiple AI-typical filler phrases detected: ${matchedFillers.map(f => `"${f}"`).join(', ')}`);
  }

  return signals;
}

export function checkDescription(pr: PRData, config: Config): CheckResult[] {
  const results: CheckResult[] = [];
  const body = pr.body || '';

  // Check: description exists
  if (config.requireDescription) {
    const hasDescription = body.trim().length > 0;
    results.push({
      name: 'description-exists',
      passed: hasDescription,
      message: hasDescription
        ? 'PR has a description'
        : 'PR is missing a description',
      severity: 'error',
      category: 'description',
      score: hasDescription ? 100 : 0,
    });
  }

  // Check: minimum description length
  if (body.trim().length > 0 && body.trim().length < config.minDescriptionLength) {
    results.push({
      name: 'description-too-short',
      passed: false,
      message: `PR description is too short (${body.trim().length} chars, minimum ${config.minDescriptionLength})`,
      severity: 'warning',
      category: 'description',
      score: 30,
    });
  }

  // Check: description not too long (slop signal)
  if (body.length > config.maxDescriptionLength) {
    results.push({
      name: 'description-too-long',
      passed: false,
      message: `PR description is suspiciously long (${body.length} chars, maximum ${config.maxDescriptionLength}) — this is often an AI slop indicator`,
      severity: 'warning',
      category: 'description',
      score: 20,
    });
  }

  // Check: emoji count
  const emojiCount = countEmoji(body);
  if (emojiCount > config.maxEmojiCount) {
    results.push({
      name: 'description-emoji-overload',
      passed: false,
      message: `PR description has too many emoji (${emojiCount}, max ${config.maxEmojiCount})`,
      severity: 'warning',
      category: 'slop-pattern',
      score: 20,
    });
  }

  // Check: AI slop description patterns
  const slopSignals = detectAISlopDescription(body);
  if (slopSignals.length > 0) {
    results.push({
      name: 'description-ai-slop-patterns',
      passed: false,
      message: `AI slop patterns detected in description:\n${slopSignals.map(s => `  • ${s}`).join('\n')}`,
      severity: 'warning',
      category: 'slop-pattern',
      score: 15,
    });
  }

  // Check: description is not just the PR template with no content
  if (body.trim().length > 0) {
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    const headerLines = lines.filter(l => l.startsWith('#'));
    const contentLines = lines.filter(l => !l.startsWith('#') && !l.startsWith('<!--'));
    if (headerLines.length > 0 && contentLines.length === 0) {
      results.push({
        name: 'description-empty-template',
        passed: false,
        message: 'PR description contains only template headers with no actual content',
        severity: 'warning',
        category: 'description',
        score: 10,
      });
    }
  }

  return results;
}
