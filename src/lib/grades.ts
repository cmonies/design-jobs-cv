export type AssessmentType = 'paid take-home' | 'unpaid take-home' | 'timed exercise' | 'none' | null;
export type CompDisclosure = 'upfront' | 'mid-process' | 'at-offer' | 'never' | null;
export type Stage = 'applied' | 'phone-screen' | 'interviews' | 'offer' | 'rejected' | 'withdrew';

export interface FeedbackReport {
  stage: Stage;
  rounds?: number | null;
  roundTypes?: string[];
  timeline?: string | null;
  hasAssessment?: boolean | null;
  assessmentType?: AssessmentType;
  takeHomeHours?: number | null;
  gotFeedback?: boolean | null;
  rejectionReason?: boolean | null;
  compDisclosure?: CompDisclosure;
  interviewerPrep?: number | null;
  processRelevance?: number | null;
  overallRating?: number | null;
  wouldRecommend?: boolean | null;
  timelineMatch?: boolean | null;
  applicationSource?: 'direct' | 'referral' | 'recruiter-outreach' | 'cold-outreach' | null;
  didOutreach?: boolean | null;
  appliedAgo?: string | null;
  withdrewReason?: string | null;
  submittedAt: string;
}

export interface GradeBreakdown {
  communication: number;
  respectForTime: number;
  transparency: number;
  interviewerQuality: number;
  overall: number;
}

export interface GradeResult {
  grade: string;
  score: number;
  breakdown: GradeBreakdown;
  reportCount: number;
  hasEnoughData: boolean;
  ghostingCount: number;
}

export const MIN_REPORTS_FOR_GRADE = 3;

function numAvg(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v): v is number => typeof v === 'number' && isFinite(v));
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function boolRate(values: (boolean | null | undefined)[], target: boolean): number | null {
  const answered = values.filter((v): v is boolean => typeof v === 'boolean');
  if (answered.length === 0) return null;
  return answered.filter(v => v === target).length / answered.length;
}

export function gradeColorKey(grade: string): 'a' | 'b' | 'c' | 'd' | 'f' {
  if (grade === 'A+' || grade === 'A') return 'a';
  if (grade === 'B+' || grade === 'B') return 'b';
  if (grade === 'C+' || grade === 'C') return 'c';
  if (grade === 'D') return 'd';
  return 'f';
}

function scoreToGrade(score: number): string {
  if (score >= 93) return 'A+';
  if (score >= 83) return 'A';
  if (score >= 77) return 'B+';
  if (score >= 67) return 'B';
  if (score >= 60) return 'C+';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

export function computeGrade(reports: FeedbackReport[]): GradeResult {
  const reportCount = reports.length;
  // Ghosting = silence at a stage where a response was owed. Mid-process
  // reporters answering "no — long silences" hurt the communication score
  // but don't trigger the ghosting grade cap. An unanswered application only
  // counts once enough time has clearly passed.
  const ghostingCount = reports.filter(r =>
    r.gotFeedback === false && (
      r.stage === 'rejected' || r.stage === 'withdrew' ||
      (r.stage === 'applied' && r.appliedAgo === '3+ weeks ago')
    )
  ).length;

  if (reportCount < MIN_REPORTS_FOR_GRADE) {
    return {
      grade: '?', score: 0,
      breakdown: { communication: 0, respectForTime: 0, transparency: 0, interviewerQuality: 0, overall: 0 },
      reportCount, hasEnoughData: false, ghostingCount,
    };
  }

  // === Communication (30 pts) ===
  // Feedback rate: 18 pts max. Neutral (9) when no data.
  const feedbackRate = boolRate(reports.map(r => r.gotFeedback), true);
  const commFeedback = feedbackRate !== null ? feedbackRate * 18 : 9;

  // Rejection reason: 12 pts max. Neutral (6) when no rejected reporters.
  const rejectedReports = reports.filter(r => r.stage === 'rejected');
  const rejectionRate = boolRate(rejectedReports.map(r => r.rejectionReason), true);
  const commRejection = rejectedReports.length === 0 ? 6 : (rejectionRate !== null ? rejectionRate * 12 : 6);

  const communication = commFeedback + commRejection;

  // === Respect for Time (25 pts) ===
  // Assessment quality: 15 pts max
  const assessScores = reports.map(r => {
    if (r.assessmentType === 'none' || r.hasAssessment === false) return 15;
    if (r.assessmentType === 'paid take-home') return 12;
    if (r.assessmentType === 'timed exercise') return 8;
    if (r.assessmentType === 'unpaid take-home') return 3;
    return null;
  });
  const assessAvg = numAvg(assessScores) ?? 7.5;

  // Take-home hours: 10 pts max. No take-home = full 10 pts. Unknown hours = 5 pts.
  const takeHomeReports = reports.filter(r => r.hasAssessment === true && r.takeHomeHours != null);
  let takeHomeScore: number;
  if (takeHomeReports.length === 0) {
    takeHomeScore = reports.some(r => r.hasAssessment === true) ? 5 : 10;
  } else {
    const hoursScores = takeHomeReports.map(r => {
      const h = r.takeHomeHours!;
      return h <= 2 ? 10 : h <= 4 ? 5 : 0;
    });
    takeHomeScore = numAvg(hoursScores) ?? 5;
  }

  const respectForTime = (assessAvg / 15) * 15 + (takeHomeScore / 10) * 10;

  // === Transparency (20 pts) ===
  // Comp disclosure: 12 pts max. Neutral (6) when no data.
  const compMap: Record<string, number> = { upfront: 12, 'mid-process': 8, 'at-offer': 4, never: 0 };
  const compScores = reports.filter(r => r.compDisclosure != null).map(r => compMap[r.compDisclosure!] ?? 4);
  const compScore = numAvg(compScores) ?? 6;

  // Timeline match: 8 pts max. Neutral (4) when no data.
  const timelineMatchRate = boolRate(reports.map(r => r.timelineMatch), true);
  const timelineScore = timelineMatchRate !== null ? timelineMatchRate * 8 : 4;

  const transparency = compScore + timelineScore;

  // === Interviewer Quality (15 pts) ===
  const prepScores = reports.map(r => r.interviewerPrep).filter((v): v is number => v != null);
  const interviewerQuality = prepScores.length > 0 ? (numAvg(prepScores)! / 5) * 15 : 7.5;

  // === Overall Community Rating (10 pts) ===
  const ratingScores = reports.map(r => r.overallRating).filter((v): v is number => v != null);
  const overall = ratingScores.length > 0 ? (numAvg(ratingScores)! / 5) * 10 : 5;

  let score = Math.round(communication + respectForTime + transparency + interviewerQuality + overall);
  score = Math.max(0, Math.min(100, score));

  // Automatic grade caps for confirmed ghosting patterns
  if (ghostingCount >= 4) score = Math.min(score, 45);
  else if (ghostingCount >= 2) score = Math.min(score, 65);

  return {
    grade: scoreToGrade(score),
    score,
    breakdown: {
      communication: Math.round(communication),
      respectForTime: Math.round(respectForTime),
      transparency: Math.round(transparency),
      interviewerQuality: Math.round(interviewerQuality),
      overall: Math.round(overall),
    },
    reportCount,
    hasEnoughData: true,
    ghostingCount,
  };
}
