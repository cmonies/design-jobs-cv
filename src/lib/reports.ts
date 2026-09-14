// Candidate-experience reports: validation, abuse checks, storage, and the
// bits of presentation logic shared by the job page island and company pages.
//
// Structured fields publish the moment they're submitted. Free-text notes are
// stored but stay hidden until a maintainer flips notes_status to 'approved'
// (see docs/process-report-criteria.md for what passes).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedbackReport } from './grades';
import type { CompanyRow, JobRow } from './supabase';
import { slugify } from './slug.js';

// ── Row shapes ──────────────────────────────────────────────────────────────
export interface ReportRow {
  id: string;
  company_id: string;
  job_id: string | null;
  job_title: string | null;
  stage: FeedbackReport['stage'];
  rounds: number | null;
  round_types: string[] | null;
  timeline: string | null;
  has_assessment: boolean | null;
  assessment_type: FeedbackReport['assessmentType'] | null;
  take_home_hours: number | null;
  got_feedback: boolean | null;
  rejection_reason: boolean | null;
  comp_disclosure: FeedbackReport['compDisclosure'] | null;
  interviewer_prep: number | null;
  process_relevance: number | null;
  overall_rating: number | null;
  would_recommend: boolean | null;
  timeline_match: boolean | null;
  application_source: FeedbackReport['applicationSource'] | null;
  did_outreach: boolean | null;
  applied_ago: string | null;
  withdrew_reason: string | null;
  notes: string | null;
  created_at: string;
}

/** Columns the API route writes. Everything optional is null when unanswered. */
export type NewReport = Omit<ReportRow, 'id' | 'company_id' | 'created_at'>;

export function toFeedbackReport(r: ReportRow, submitter?: string | null): FeedbackReport {
  return {
    stage: r.stage,
    rounds: r.rounds,
    roundTypes: r.round_types ?? undefined,
    timeline: r.timeline,
    hasAssessment: r.has_assessment,
    assessmentType: r.assessment_type ?? undefined,
    takeHomeHours: r.take_home_hours,
    gotFeedback: r.got_feedback,
    rejectionReason: r.rejection_reason,
    compDisclosure: r.comp_disclosure ?? undefined,
    interviewerPrep: r.interviewer_prep,
    processRelevance: r.process_relevance,
    overallRating: r.overall_rating,
    wouldRecommend: r.would_recommend,
    timelineMatch: r.timeline_match,
    submitter: submitter ?? null,
    applicationSource: r.application_source ?? undefined,
    didOutreach: r.did_outreach,
    appliedAgo: r.applied_ago,
    withdrewReason: r.withdrew_reason,
    submittedAt: r.created_at.slice(0, 10),
  };
}

// ── Validation & sanitization ───────────────────────────────────────────────
// Same vocab the DB enforces with CHECK constraints; checking here first turns
// a 500 from Postgres into a readable 400 for the form.
const VALID_STAGES = new Set(['applied', 'phone-screen', 'interviews', 'offer', 'rejected', 'withdrew']);
const VALID_TIMELINES = new Set(['under 1 week', '1-2 weeks', '2-4 weeks', '4-6 weeks', '6+ weeks']);
const VALID_ASSESSMENT = new Set(['paid take-home', 'unpaid take-home', 'timed exercise', 'none']);
const VALID_COMP = new Set(['upfront', 'mid-process', 'at-offer', 'never']);
export const VALID_ROUND_TYPES = new Set(['recruiter screen', 'hiring manager', 'portfolio review', 'design exercise', 'take-home assessment', 'panel', 'executive screen', 'reference check']);
const VALID_SOURCES = new Set(['direct', 'referral', 'recruiter-outreach', 'cold-outreach']);
const VALID_APPLIED_AGO = new Set(['this week', '1-2 weeks ago', '3+ weeks ago']);
const VALID_WITHDREW = new Set(['other-offer', 'too-slow', 'compensation', 'red-flags', 'other']);

// Hard block list — zero tolerance, no profanity/slurs of any kind
const BLOCKED_TERMS = ['nigger', 'faggot', 'kike', 'chink', 'wetback', 'spic', 'gook', 'tranny', 'retard'];

export const NOTES_MAX = 280;

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const yesNo = (v: unknown): boolean | null => (v === 'yes' || v === true ? true : v === 'no' || v === false ? false : null);
const oneOf = (v: unknown, set: Set<string>) => (typeof v === 'string' && set.has(v) ? v : null);
const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : parseInt(str(v), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export type SanitizeResult = { ok: true; row: NewReport } | { ok: false; error: string };

export function sanitizeSubmission(body: Body): SanitizeResult {
  const stage = oneOf(body.stage, VALID_STAGES) as FeedbackReport['stage'] | null;
  if (!stage) return { ok: false, error: 'Please pick where you are in the process.' };

  const roundTypesRaw = str(body.roundTypes);
  const roundTypes = roundTypesRaw
    ? roundTypesRaw.split(',').map(s => s.trim()).filter(rt => VALID_ROUND_TYPES.has(rt))
    : [];

  const takeHome = parseFloat(str(body.takeHomeHours));
  const notes = str(body.notes).slice(0, NOTES_MAX);
  if (notes && BLOCKED_TERMS.some(t => notes.toLowerCase().includes(t))) {
    return { ok: false, error: "Your note contains language we don't publish. Please rephrase it." };
  }

  const row: NewReport = {
    job_id: null,
    job_title: str(body.jobTitle).slice(0, 120) || null,
    stage,
    rounds: int(body.rounds, 1, 20),
    round_types: roundTypes.length ? roundTypes : null,
    timeline: oneOf(body.timeline, VALID_TIMELINES),
    has_assessment: yesNo(body.hasAssessment),
    assessment_type: oneOf(body.assessmentType, VALID_ASSESSMENT) as NewReport['assessment_type'],
    take_home_hours: Number.isFinite(takeHome) && takeHome > 0 && takeHome <= 100 ? Math.round(takeHome * 10) / 10 : null,
    got_feedback: yesNo(body.gotFeedback),
    rejection_reason: yesNo(body.rejectionReason),
    comp_disclosure: oneOf(body.compDisclosure, VALID_COMP) as NewReport['comp_disclosure'],
    interviewer_prep: int(body.interviewerPrep, 1, 5),
    process_relevance: int(body.processRelevance, 1, 5),
    overall_rating: int(body.overallRating, 1, 5),
    would_recommend: yesNo(body.wouldRecommend),
    timeline_match: yesNo(body.timelineMatch),           // 'na' → null
    application_source: oneOf(body.applicationSource, VALID_SOURCES) as NewReport['application_source'],
    did_outreach: yesNo(body.didOutreach),
    applied_ago: oneOf(body.appliedAgo, VALID_APPLIED_AGO),
    withdrew_reason: oneOf(body.withdrewReason, VALID_WITHDREW),
    notes: notes || null,
  };
  return { ok: true, row };
}

// ── Abuse detection ─────────────────────────────────────────────────────────
// Three ways someone games this: resubmitting for the same company, flooding
// from many IPs (brigading), or a company astroturfing praise. We can't stop
// a determined attacker with fresh IPs, but we can make it expensive, cap the
// damage, and hold anything that looks coordinated for human review.
const MAX_PER_SUBMITTER_PER_COMPANY = 1;   // one voice, one report
const BRIGADE_WINDOW_DAYS = 3;
const BRIGADE_THRESHOLD = 4;               // 4+ reports in 3 days on one company
const RECENT_DUPE_DAYS = 30;

type ExistingRow = Pick<ReportRow, 'stage' | 'rounds' | 'timeline' | 'assessment_type' | 'take_home_hours' | 'got_feedback' | 'comp_disclosure' | 'interviewer_prep' | 'process_relevance' | 'overall_rating' | 'would_recommend' | 'notes' | 'created_at'> & { submitter_hash: string | null };

const daysBetween = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

// Do the substantive answers match an existing report? Two people genuinely
// having the same experience differ somewhere; a copy-paste resubmit won't.
function contentMatches(a: NewReport, b: ExistingRow): boolean {
  const fields = ['stage', 'rounds', 'timeline', 'assessment_type', 'take_home_hours', 'got_feedback',
                  'comp_disclosure', 'interviewer_prep', 'process_relevance', 'overall_rating',
                  'would_recommend', 'notes'] as const;
  const present = fields.filter(f => a[f] != null || b[f] != null);
  if (present.length < 3) return false; // too sparse to call
  return present.every(f => JSON.stringify(a[f] ?? null) === JSON.stringify(b[f] ?? null));
}

/** Returns a reason when the report should be held for a human instead of published. */
export function abuseCheck(existing: ExistingRow[], report: NewReport, submitter: string | null): string | null {
  const now = new Date().toISOString();
  if (submitter) {
    const mine = existing.filter(r => r.submitter_hash === submitter);
    if (mine.length >= MAX_PER_SUBMITTER_PER_COMPANY) {
      return `same submitter already has ${mine.length} report(s) for this company`;
    }
  }
  const dupe = existing.find(r => daysBetween(r.created_at, now) <= RECENT_DUPE_DAYS && contentMatches(report, r));
  if (dupe) return 'near-identical to an existing recent report';

  const recent = existing.filter(r => daysBetween(r.created_at, now) <= BRIGADE_WINDOW_DAYS);
  if (recent.length + 1 >= BRIGADE_THRESHOLD) {
    return `burst: ${recent.length + 1} reports for this company within ${BRIGADE_WINDOW_DAYS} days`;
  }
  return null;
}

// ── Rate limiting (per anonymous fingerprint) ───────────────────────────────
export const MAX_FEEDBACK_PER_DAY = 3;
const DAY_SECONDS = 86400;
const WEEK_SECONDS = 604800;

/** Current count for a rate-limit key (0 once expired). */
export async function readLimit(db: SupabaseClient, key: string): Promise<{ count: number; expires_at: string | null }> {
  const { data } = await db.from('rate_limits').select('count, expires_at').eq('key', key).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) return { count: 0, expires_at: null };
  return data;
}

/** Increment a rate-limit key; the window starts on the first hit. */
export async function bumpLimit(db: SupabaseClient, key: string, ttlSeconds: number): Promise<void> {
  const cur = await readLimit(db, key);
  await db.from('rate_limits').upsert({
    key,
    count: cur.count + 1,
    expires_at: cur.expires_at ?? new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}

/** `who` = fingerprint(ip), `whoCompany` = fingerprint(ip, company) — both salted hashes. */
export async function checkFeedbackLimits(db: SupabaseClient, who: string, whoCompany: string): Promise<string | null> {
  if ((await readLimit(db, `fb:day:${who}`)).count >= MAX_FEEDBACK_PER_DAY) {
    return "You've submitted several reports today. Try again tomorrow.";
  }
  if ((await readLimit(db, `fb:co:${whoCompany}`)).count > 0) {
    return 'You already shared an experience for this company recently. Thank you!';
  }
  return null;
}

export async function recordFeedback(db: SupabaseClient, who: string, whoCompany: string): Promise<void> {
  await bumpLimit(db, `fb:day:${who}`, DAY_SECONDS);
  await bumpLimit(db, `fb:co:${whoCompany}`, WEEK_SECONDS);
}

// ── Storage ─────────────────────────────────────────────────────────────────
export interface SubmitInput {
  row: NewReport;
  /** Company name as typed or prefilled; used to create the company if unknown. */
  company: string;
  jobId: string | null;
  submitter: string | null;
}

export type SubmitResult =
  | { ok: true; id: string; companySlug: string; published: boolean }
  | { ok: false; error: string; status: number };

export async function submitReport(db: SupabaseClient, input: SubmitInput): Promise<SubmitResult> {
  // 1. Resolve the company — by job first (strong link), else by slug, else create.
  let company: Pick<CompanyRow, 'id' | 'slug'> | null = null;
  let jobId: string | null = null;

  if (input.jobId) {
    const { data: job } = await db.from('jobs').select('id, company_id, companies(id, slug)').eq('id', input.jobId).maybeSingle();
    if (job) {
      jobId = job.id;
      const c = (job as unknown as { companies: Pick<CompanyRow, 'id' | 'slug'> | null }).companies;
      if (c) company = c;
    }
  }
  if (!company) {
    const name = input.company.trim().slice(0, 120);
    if (!name) return { ok: false, error: 'Please tell us which company this is about.', status: 400 };
    const slug = slugify(name);
    const { data: found } = await db.from('companies').select('id, slug').eq('slug', slug).maybeSingle();
    if (found) company = found;
    else {
      const { data: created, error } = await db.from('companies').insert({ slug, name }).select('id, slug').single();
      if (error || !created) return { ok: false, error: 'Could not save your report. Please try again.', status: 500 };
      company = created;
    }
  }

  // 2. Abuse gate against everything already filed for this company.
  const { data: existing } = await db
    .from('reports')
    .select('stage, rounds, timeline, assessment_type, take_home_hours, got_feedback, comp_disclosure, interviewer_prep, process_relevance, overall_rating, would_recommend, notes, created_at, submitter_hash')
    .eq('company_id', company.id)
    .in('status', ['published', 'held']);
  const heldReason = abuseCheck((existing ?? []) as ExistingRow[], input.row, input.submitter);

  // 3. Insert.
  const { data: inserted, error } = await db
    .from('reports')
    .insert({
      ...input.row,
      job_id: jobId,
      company_id: company.id,
      submitter_hash: input.submitter,
      status: heldReason ? 'held' : 'published',
      held_reason: heldReason,
    })
    .select('id')
    .single();
  if (error || !inserted) {
    console.error('report insert failed:', error?.message);
    return { ok: false, error: 'Could not save your report. Please try again.', status: 500 };
  }
  return { ok: true, id: inserted.id, companySlug: company.slug, published: !heldReason };
}

// ── Reads ───────────────────────────────────────────────────────────────────
export interface CompanyExperience {
  company: CompanyRow;
  reports: ReportRow[];
}

/** Published reports for a company, newest first. Null when the company isn't in the DB. */
export async function fetchCompanyExperience(db: SupabaseClient, slug: string): Promise<CompanyExperience | null> {
  const { data: company } = await db.from('companies').select('id, slug, name, url, vertical').eq('slug', slug).maybeSingle();
  if (!company) return null;
  const { data: reports } = await db
    .from('public_reports')
    .select('*')
    .eq('company_id', company.id)
    .order('created_at', { ascending: false });
  return { company, reports: (reports ?? []) as ReportRow[] };
}

export async function fetchCompanyJobs(db: SupabaseClient, companyId: string): Promise<JobRow[]> {
  const { data } = await db
    .from('jobs')
    .select('id, company_id, title, url, level, location_type, location, employment_type, vertical, salary, tags, posted_at, status, removed_at')
    .eq('company_id', companyId)
    .order('status', { ascending: true })      // 'active' sorts before 'dead'
    .order('posted_at', { ascending: false, nullsFirst: false });
  return (data ?? []) as JobRow[];
}

// ── Presentation ────────────────────────────────────────────────────────────
export const STAGE_LABEL: Record<string, string> = {
  applied: 'Applied',
  'phone-screen': 'Phone screen',
  interviews: 'Interviewed',
  offer: 'Got an offer',
  rejected: 'Rejected',
  withdrew: 'Withdrew',
};

const COMP_LABEL: Record<string, string> = {
  upfront: 'Comp shared upfront',
  'mid-process': 'Comp shared mid-process',
  'at-offer': 'Comp shared at offer',
  never: 'Comp never shared',
};

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Short factual chips for one report — process events, never verdicts. */
export function reportFacts(r: ReportRow): string[] {
  const facts: string[] = [];
  if (r.rounds) facts.push(`${r.rounds} round${r.rounds === 1 ? '' : 's'}`);
  if (r.timeline) facts.push(sentence(r.timeline).replace('-', '–'));
  if (r.assessment_type && r.assessment_type !== 'none') {
    facts.push(sentence(r.assessment_type) + (r.take_home_hours ? ` · ${r.take_home_hours}h` : ''));
  } else if (r.assessment_type === 'none' || r.has_assessment === false) {
    facts.push('No take-home');
  }
  if (r.comp_disclosure) facts.push(COMP_LABEL[r.comp_disclosure]);
  if (r.got_feedback === true) facts.push('Heard back');
  if (r.got_feedback === false) facts.push(r.stage === 'applied' ? 'No response yet' : 'No response');
  if (r.stage === 'rejected' && r.rejection_reason === true) facts.push('Got a reason');
  if (r.would_recommend === true) facts.push('Would recommend');
  if (r.would_recommend === false) facts.push('Would not recommend');
  return facts;
}

export function reportMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
