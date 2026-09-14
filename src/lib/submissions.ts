// Job submissions from /submit: validation, duplicate check against live
// jobs, per-submitter rate limit, and storage. The GitHub issue the review
// pipeline reads is still filed by the API route; this is the durable record.

import type { SupabaseClient } from '@supabase/supabase-js';
import { VALID_ROUND_TYPES, readLimit, bumpLimit } from './reports';

export const MAX_SUBMISSIONS_PER_DAY = 5;
const DAY_SECONDS = 86400;

const VALID_RELATIONSHIP = new Set(['work-here', 'know-team', 'found-it']);
const VALID_URGENCY = new Set(['asap', 'within-month', 'few-months', 'evergreen']);
const VALID_ASSESSMENT = new Set(['none', 'paid take-home', 'unpaid take-home', 'timed exercise']);

type Body = Record<string, unknown>;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = (v: unknown, set: Set<string>) => (typeof v === 'string' && set.has(v) ? v : null);

export interface NewSubmission {
  url: string;
  title: string | null;
  tags: string[];
  relationship: string | null;
  urgency: string | null;
  contact_name: string | null;
  contact_url: string | null;
  interview_process: Record<string, unknown> | null;
  submitter_name: string;
  submitter_email: string;
}

/** Same shape the GitHub issue's JSON block uses, so the pipeline reads either. */
export function sanitizeJobSubmission(body: Body): NewSubmission {
  const rounds = parseInt(str(body.rounds, 3), 10);
  const roundTypes = str(body.roundTypes, 400).split(',').map(s => s.trim()).filter(rt => VALID_ROUND_TYPES.has(rt));
  const timeline = str(body.timeline, 50);
  const assessmentType = oneOf(body.assessmentType, VALID_ASSESSMENT);
  const relationship = oneOf(body.relationship, VALID_RELATIONSHIP);
  const hasProcess = Number.isInteger(rounds) || roundTypes.length > 0 || !!timeline || !!assessmentType;

  return {
    url: str(body.url, 2000),
    title: str(body.title, 200) || null,
    tags: str(body.tags, 400).split(',').map(t => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
    relationship,
    urgency: oneOf(body.urgency, VALID_URGENCY),
    contact_name: str(body.contactName, 120) || null,
    contact_url: str(body.contactUrl, 500) || null,
    interview_process: hasProcess ? {
      ...(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20 ? { rounds } : {}),
      ...(roundTypes.length ? { roundTypes } : {}),
      ...(timeline ? { timeline } : {}),
      ...(assessmentType ? {
        hasAssessment: assessmentType !== 'none',
        ...(assessmentType !== 'none' ? { assessmentType } : {}),
      } : {}),
      source: relationship === 'work-here' ? 'recruiter' : 'community report',
    } : null,
    submitter_name: str(body.submitterName, 120),
    submitter_email: str(body.submitterEmail, 200).toLowerCase(),
  };
}

/** Is this URL already a live listing? Returns the job id if so. */
export async function findLiveJobByUrl(db: SupabaseClient, url: string): Promise<string | null> {
  const { data } = await db.from('jobs').select('id').eq('url', url).eq('status', 'active').maybeSingle();
  return data?.id ?? null;
}

export async function checkSubmissionLimit(db: SupabaseClient, emailHash: string): Promise<number> {
  return (await readLimit(db, `sub:day:${emailHash}`)).count;
}

export async function recordSubmission(db: SupabaseClient, emailHash: string): Promise<void> {
  await bumpLimit(db, `sub:day:${emailHash}`, DAY_SECONDS);
}

export async function insertSubmission(
  db: SupabaseClient, row: NewSubmission, submitterHash: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('job_submissions')
    .insert({ ...row, submitter_hash: submitterHash })
    .select('id')
    .single();
  if (error) console.error('job_submissions insert failed:', error.message);
  return data?.id ?? null;
}

export async function attachIssue(db: SupabaseClient, id: string, issueUrl: string): Promise<void> {
  await db.from('job_submissions').update({ github_issue_url: issueUrl }).eq('id', id);
}
