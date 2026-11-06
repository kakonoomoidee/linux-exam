/**
 * Session-level review summary: correct rate per question, which questions
 * collect the most near-misses, and which patterns look too strict (several
 * students missed with the SAME kind of variation, or the pattern can never
 * match after the grader's normalization).
 */
const { LABEL, EXTRA_REASON, needsAttention } = require('./nearMissService');
const { REASON } = require('../lib/commandVariants');
const { normalizationConflict, parseList } = require('./answerKeyService');

const TOP_NEAR_MISS_LIMIT = 5;
const SUSPICIOUS_MIN_STUDENTS = 2;
const SAMPLE_COMMANDS_LIMIT = 3;
// Reasons that point at the pattern, not at the student (typos / failed
// commands / wrong final state are the student's mistake).
const STRICTNESS_REASONS = new Set([
  EXTRA_REASON.QUOTES,
  EXTRA_REASON.COSMETIC,
  REASON.SPACING,
  REASON.TRAILING_SLASH,
  REASON.FLAG_STYLE,
  REASON.HOME_PATH,
  REASON.EQUIVALENT,
]);

function questionStats(analyses) {
  const byQuestion = new Map();
  for (const a of analyses) {
    for (const { question, submission, detection } of a.rows) {
      if (!byQuestion.has(question.id)) {
        byQuestion.set(question.id, { question, participants: 0, correct: 0, nearMiss: 0, inHistory: 0, detections: [] });
      }
      const s = byQuestion.get(question.id);
      s.participants++;
      if (submission?.auto_result === 'pass') s.correct++;
      if (detection.label === LABEL.NEAR_MISS) s.nearMiss++;
      if (detection.label === LABEL.IN_HISTORY) s.inHistory++;
      if (needsAttention(detection.label)) s.detections.push(detection);
    }
  }
  return [...byQuestion.values()];
}

const questionRef = (q) => ({
  questionId: q.id,
  variantIndex: q.variant_index,
  orderIndex: q.order_index,
  storyText: q.story_text,
  storyTextEn: q.story_text_en,
});

function strictPatternFindings(stat) {
  const byReason = new Map();
  for (const d of stat.detections) {
    for (const reason of d.reasons.filter((r) => STRICTNESS_REASONS.has(r))) {
      if (!byReason.has(reason)) byReason.set(reason, { count: 0, samples: new Set() });
      const entry = byReason.get(reason);
      entry.count++;
      if (d.candidateCommand && entry.samples.size < SAMPLE_COMMANDS_LIMIT) entry.samples.add(d.candidateCommand);
    }
  }
  return [...byReason.entries()]
    .filter(([, e]) => e.count >= SUSPICIOUS_MIN_STUDENTS)
    .map(([reason, e]) => ({ ...questionRef(stat.question), kind: 'variation', reason, students: e.count, samples: [...e.samples] }));
}

function conflictFindings(stat) {
  return parseList(stat.question.accepted_patterns)
    .map((pattern) => ({ pattern, example: normalizationConflict(pattern) }))
    .filter((c) => c.example)
    .map((c) => ({ ...questionRef(stat.question), kind: 'normalization', pattern: c.pattern, example: c.example }));
}

/**
 * @param {Array} analyses reviewService analyzeParticipant() results
 * @returns {{perQuestion, topNearMiss, suspiciousPatterns}}
 */
function summarizeSession(analyses) {
  const stats = questionStats(analyses);
  const perQuestion = stats
    .map((s) => ({
      ...questionRef(s.question),
      participants: s.participants,
      correct: s.correct,
      correctRate: s.participants ? Math.round((s.correct / s.participants) * 100) : 0,
      nearMiss: s.nearMiss,
      inHistory: s.inHistory,
    }))
    .sort((a, b) => a.variantIndex - b.variantIndex || a.orderIndex - b.orderIndex);
  const topNearMiss = perQuestion
    .filter((q) => q.nearMiss + q.inHistory > 0)
    .sort((a, b) => b.nearMiss + b.inHistory - (a.nearMiss + a.inHistory))
    .slice(0, TOP_NEAR_MISS_LIMIT);
  const suspiciousPatterns = stats.flatMap((s) => [...conflictFindings(s), ...strictPatternFindings(s)]);
  return { perQuestion, topNearMiss, suspiciousPatterns };
}

module.exports = { summarizeSession, SUSPICIOUS_MIN_STUDENTS };
