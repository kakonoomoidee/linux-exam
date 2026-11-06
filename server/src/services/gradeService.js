/**
 * The one place final grades are computed. The review pages, the session
 * list averages and every export call these functions, so what an asisten
 * sees on screen is exactly what lands in the spreadsheet.
 */

const ALLOWED_PERCENTS = Object.freeze([0, 25, 50, 75, 100]);
const GRADE_SCALE = 100; // nilai akhir is reported 0-100
const DECIMALS = 2;

const REVIEW_STATUS = Object.freeze({ DONE: 'done', PARTIAL: 'partial', PENDING: 'pending' });

const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;
const isReviewed = (sub) => sub != null && sub.final_score !== null && sub.final_score !== undefined;

/** Score that counts: the manual correction when present, else the auto-grade, else 0. */
function effectiveScore(sub) {
  if (!sub) return 0;
  if (isReviewed(sub)) return Number(sub.final_score);
  return Number(sub.auto_score ?? 0);
}

function isAllowedPercent(percent) {
  return typeof percent === 'number' && ALLOWED_PERCENTS.includes(percent);
}

/** final_score stored for a correction: percent of the question's point value. */
function scoreForPercent(percent, point) {
  return round((percent / GRADE_SCALE) * Number(point));
}

/** Inverse of scoreForPercent, snapped to the nearest allowed step (for highlighting the UI button). */
function percentForScore(score, point) {
  if (!Number(point)) return 0;
  const raw = (Number(score) / Number(point)) * GRADE_SCALE;
  return ALLOWED_PERCENTS.reduce((best, p) => (Math.abs(p - raw) < Math.abs(best - raw) ? p : best), 0);
}

/**
 * A question "needs review" when the auto-grade didn't pass it. A participant
 * is done when every such question has a manual correction.
 */
function reviewStatus(rows) {
  const needing = rows.filter((r) => r.submission?.auto_result !== 'pass');
  const reviewed = needing.filter((r) => isReviewed(r.submission));
  if (reviewed.length === needing.length) return REVIEW_STATUS.DONE;
  return reviewed.length ? REVIEW_STATUS.PARTIAL : REVIEW_STATUS.PENDING;
}

/**
 * @param {Array<{question: {point}, submission?: object}>} rows one per question of the participant's variant
 * @returns {{autoTotal, finalTotal, maxTotal, finalGrade, reviewedCount, status}}
 */
function summarizeScores(rows) {
  const autoTotal = rows.reduce((sum, r) => sum + Number(r.submission?.auto_score ?? 0), 0);
  const finalTotal = rows.reduce((sum, r) => sum + effectiveScore(r.submission), 0);
  const maxTotal = rows.reduce((sum, r) => sum + Number(r.question.point), 0);
  return {
    autoTotal: round(autoTotal),
    finalTotal: round(finalTotal),
    maxTotal: round(maxTotal),
    finalGrade: maxTotal ? round((finalTotal / maxTotal) * GRADE_SCALE) : 0,
    reviewedCount: rows.filter((r) => isReviewed(r.submission)).length,
    status: reviewStatus(rows),
  };
}

module.exports = {
  ALLOWED_PERCENTS,
  REVIEW_STATUS,
  effectiveScore,
  isReviewed,
  isAllowedPercent,
  scoreForPercent,
  percentForScore,
  summarizeScores,
};
