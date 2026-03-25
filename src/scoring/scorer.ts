import { CheckResult, ReviewReport, AIAnalysisResult } from '../config/types';

// Category weights for quality scoring
const CATEGORY_WEIGHTS: Record<string, number> = {
  'title': 0.10,
  'description': 0.15,
  'commits': 0.15,
  'branch': 0.10,
  'files': 0.20,
  'contributor': 0.10,
  'slop-pattern': 0.20,
};

// AI analysis weight (applied when AI results are available)
const AI_WEIGHT = 0.25;

export function calculateScore(
  results: CheckResult[],
  aiAnalysis?: AIAnalysisResult
): ReviewReport {
  if (results.length === 0) {
    return {
      qualityScore: 100,
      passed: true,
      totalChecks: 0,
      failedChecks: 0,
      results: [],
      summary: 'No checks were run.',
    };
  }

  // Group results by category
  const byCategory = new Map<string, CheckResult[]>();
  for (const r of results) {
    const cat = r.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(r);
  }

  // Calculate weighted score per category
  let totalWeight = 0;
  let weightedScore = 0;

  for (const [category, checks] of byCategory) {
    const weight = CATEGORY_WEIGHTS[category] || 0.1;
    totalWeight += weight;

    // Average score within category
    const avgScore = checks.reduce((sum, c) => sum + c.score, 0) / checks.length;
    weightedScore += avgScore * weight;
  }

  // Normalize if total weight isn't 1
  let qualityScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 100;

  // Apply AI analysis adjustment
  if (aiAnalysis) {
    const aiScore = aiAnalysis.confidence * 100;
    // Blend rule score with AI score
    qualityScore = Math.round(qualityScore * (1 - AI_WEIGHT) + aiScore * AI_WEIGHT);
  }

  // Clamp to 0-100
  qualityScore = Math.max(0, Math.min(100, qualityScore));

  const failedChecks = results.filter(r => !r.passed);

  return {
    qualityScore,
    passed: true, // Will be overridden by the caller based on thresholds
    totalChecks: results.length,
    failedChecks: failedChecks.length,
    results,
    aiAnalysis,
    summary: generateSummary(qualityScore, failedChecks, aiAnalysis),
  };
}

function generateSummary(
  score: number,
  failures: CheckResult[],
  aiAnalysis?: AIAnalysisResult
): string {
  const grade = getGrade(score);
  let summary = `**Quality Score: ${score}/100** ${grade}\n\n`;

  if (failures.length === 0) {
    summary += '✅ All checks passed! This PR looks good.\n';
  } else {
    summary += `⚠️ ${failures.length} issue(s) found:\n\n`;

    // Group failures by severity
    const errors = failures.filter(f => f.severity === 'error');
    const warnings = failures.filter(f => f.severity === 'warning');

    if (errors.length > 0) {
      summary += `### 🔴 Errors (${errors.length})\n`;
      for (const e of errors) {
        summary += `- ${e.message}\n`;
      }
      summary += '\n';
    }

    if (warnings.length > 0) {
      summary += `### 🟡 Warnings (${warnings.length})\n`;
      for (const w of warnings) {
        summary += `- ${w.message}\n`;
      }
      summary += '\n';
    }
  }

  if (aiAnalysis) {
    summary += '### 🤖 AI Analysis\n\n';
    summary += `${aiAnalysis.overallAssessment}\n\n`;

    if (aiAnalysis.slopIndicators.length > 0) {
      summary += '**Slop Indicators:**\n';
      for (const s of aiAnalysis.slopIndicators) {
        summary += `- ${s}\n`;
      }
      summary += '\n';
    }

    if (aiAnalysis.suggestions.length > 0) {
      summary += '**Suggestions:**\n';
      for (const s of aiAnalysis.suggestions) {
        summary += `- ${s}\n`;
      }
    }
  }

  return summary;
}

function getGrade(score: number): string {
  if (score >= 90) return '🟢 Excellent';
  if (score >= 70) return '🟢 Good';
  if (score >= 50) return '🟡 Fair';
  if (score >= 30) return '🟠 Poor';
  return '🔴 Critical';
}
