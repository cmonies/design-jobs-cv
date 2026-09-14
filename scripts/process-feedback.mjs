#!/usr/bin/env node
// Processes GitHub issues labeled 'interview-feedback' into src/data/job-feedback.json.
// Run nightly after the main pipeline. Validates, sanitizes, dedupes, and closes issues.
// Usage: GITHUB_TOKEN=... node scripts/process-feedback.mjs [--dry-run]

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'cmonies/design-jobs-cv';
const DRY_RUN = process.argv.includes('--dry-run');

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

// ── Data ────────────────────────────────────────────────────────────────────
const jobs = JSON.parse(readFileSync(join(ROOT, 'src/data/jobs.json'), 'utf8'));
const feedbackData = JSON.parse(readFileSync(join(ROOT, 'src/data/job-feedback.json'), 'utf8'));

// Company → jobId(s) index for matching
const companyIndex = {};
for (const job of jobs) {
  if (!job.id || !job.company) continue;
  const key = job.company.toLowerCase().trim();
  (companyIndex[key] ??= []).push(job.id);
}

// ── GitHub helpers ──────────────────────────────────────────────────────────
async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'designjobs.cv',
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

async function fetchOpenIssues(label) {
  const all = [];
  let page = 1;
  while (true) {
    const batch = await gh(`/issues?labels=${label}&state=open&per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function closeIssue(number, comment) {
  if (DRY_RUN) { console.log(`  [dry] close #${number}`); return; }
  await gh(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) });
  await gh(`/issues/${number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
}

// ── JSON block extraction ───────────────────────────────────────────────────
function extractJson(body) {
  const m = /```json\n([\s\S]+?)\n```/.exec(body || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ── Matching ────────────────────────────────────────────────────────────────
function resolveKey(jobId, company) {
  // Prefer exact job ID match from the issue
  if (jobId && jobs.some(j => j.id === jobId)) return { key: jobId, jobId };
  // Company-level match (one job at that company)
  if (company) {
    const matches = companyIndex[company.toLowerCase().trim()] ?? [];
    if (matches.length === 1) return { key: matches[0], jobId: matches[0] };
  }
  // Group under sanitized company slug
  const slug = `company:${(company || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  return { key: slug, jobId: null };
}

// ── Validation & sanitization ───────────────────────────────────────────────
const VALID_STAGES = new Set(['applied', 'phone-screen', 'interviews', 'offer', 'rejected', 'withdrew']);
const VALID_ASSESSMENT = new Set(['paid take-home', 'unpaid take-home', 'timed exercise', 'none', null]);
const VALID_COMP = new Set(['upfront', 'mid-process', 'at-offer', 'never', null]);
const VALID_ROUND_TYPES = new Set(['recruiter screen', 'hiring manager', 'portfolio review', 'design exercise', 'take-home assessment', 'panel', 'executive screen', 'reference check']);

// Hard block list — zero tolerance, no profanity/slurs of any kind
const BLOCKED_TERMS = ['nigger', 'faggot', 'kike', 'chink', 'wetback', 'spic', 'gook', 'tranny', 'retard'];

function validate(report) {
  if (!report || typeof report !== 'object') return false;
  if (!VALID_STAGES.has(report.stage)) return false;
  if (!report.submittedAt || !/^\d{4}-\d{2}-\d{2}$/.test(report.submittedAt)) return false;
  const text = [report.notes].filter(Boolean).join(' ').toLowerCase();
  if (BLOCKED_TERMS.some(t => text.includes(t))) return false;
  return true;
}

// ── Abuse detection ─────────────────────────────────────────────────────────
// Three ways someone games this: resubmitting for the same company, flooding
// from many IPs (brigading), or a company astroturfing praise. We can't stop
// a determined attacker with fresh IPs, but we can make it expensive, cap the
// damage, and quarantine anything that looks coordinated for human review.
const MAX_PER_SUBMITTER_PER_COMPANY = 1;   // one voice, one report
const BRIGADE_WINDOW_DAYS = 3;
const BRIGADE_THRESHOLD = 4;               // 4+ reports in 3 days on one company
const RECENT_DUPE_DAYS = 30;

const daysBetween = (a, b) =>
  Math.abs((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);

// Do the substantive answers match an existing report? Two people genuinely
// having the same experience differ somewhere; a copy-paste resubmit won't.
function contentMatches(a, b) {
  const fields = ['stage', 'rounds', 'timeline', 'assessmentType', 'takeHomeHours',
                  'gotFeedback', 'compDisclosure', 'interviewerPrep',
                  'processRelevance', 'overallRating', 'wouldRecommend', 'notes'];
  const present = fields.filter(f => a[f] !== undefined || b[f] !== undefined);
  if (present.length < 3) return false; // too sparse to call
  return present.every(f => JSON.stringify(a[f]) === JSON.stringify(b[f]));
}

// Returns a reason string when the report should NOT be auto-published.
function abuseCheck(entry, report, submitter) {
  const existing = entry.reports || [];

  if (submitter) {
    const mine = existing.filter(r => r.submitter === submitter);
    if (mine.length >= MAX_PER_SUBMITTER_PER_COMPANY) {
      return `same submitter already has ${mine.length} report(s) for this company`;
    }
  }

  const dupe = existing.find(r =>
    daysBetween(r.submittedAt, report.submittedAt) <= RECENT_DUPE_DAYS && contentMatches(r, report)
  );
  if (dupe) return 'near-identical to an existing recent report';

  const recent = existing.filter(r => daysBetween(r.submittedAt, report.submittedAt) <= BRIGADE_WINDOW_DAYS);
  if (recent.length + 1 >= BRIGADE_THRESHOLD) {
    return `burst: ${recent.length + 1} reports for this company within ${BRIGADE_WINDOW_DAYS} days`;
  }

  return null;
}

function sanitize(raw) {
  const out = { stage: raw.stage, submittedAt: raw.submittedAt };
  if (typeof raw.rounds === 'number' && raw.rounds >= 1 && raw.rounds <= 20) out.rounds = Math.round(raw.rounds);
  if (Array.isArray(raw.roundTypes)) out.roundTypes = raw.roundTypes.filter(rt => VALID_ROUND_TYPES.has(rt));
  if (typeof raw.timeline === 'string') out.timeline = raw.timeline.slice(0, 50);
  if (typeof raw.hasAssessment === 'boolean') out.hasAssessment = raw.hasAssessment;
  if (VALID_ASSESSMENT.has(raw.assessmentType)) out.assessmentType = raw.assessmentType;
  if (typeof raw.takeHomeHours === 'number' && raw.takeHomeHours > 0 && raw.takeHomeHours <= 100) out.takeHomeHours = raw.takeHomeHours;
  if (typeof raw.gotFeedback === 'boolean') out.gotFeedback = raw.gotFeedback;
  if (typeof raw.rejectionReason === 'boolean') out.rejectionReason = raw.rejectionReason;
  if (VALID_COMP.has(raw.compDisclosure)) out.compDisclosure = raw.compDisclosure;
  for (const field of ['interviewerPrep', 'processRelevance', 'overallRating']) {
    if (typeof raw[field] === 'number' && raw[field] >= 1 && raw[field] <= 5) out[field] = Math.round(raw[field]);
  }
  if (typeof raw.wouldRecommend === 'boolean') out.wouldRecommend = raw.wouldRecommend;
  if (typeof raw.timelineMatch === 'boolean') out.timelineMatch = raw.timelineMatch;
  if (typeof raw.notes === 'string' && raw.notes.trim()) out.notes = raw.notes.trim().slice(0, 280);
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Fetching interview-feedback issues from ${GITHUB_REPO}...`);
  const issues = await fetchOpenIssues('interview-feedback');
  console.log(`Found ${issues.length} open issue(s)\n`);

  let processed = 0;
  let skipped = 0;
  let quarantined = 0;

  for (const issue of issues) {
    // already flagged for a human — leave it alone
    if ((issue.labels || []).some(l => (l.name || l) === 'needs-review')) continue;
    console.log(`Issue #${issue.number}: ${issue.title}`);
    const parsed = extractJson(issue.body);

    if (!parsed || parsed.type !== 'interview-feedback' || !parsed.company || !parsed.report) {
      console.log('  → skip: malformed\n');
      skipped++;
      continue;
    }

    const { jobId, company, jobTitle, submitter, report: rawReport } = parsed;

    if (!validate(rawReport)) {
      console.log('  → skip: validation failed\n');
      skipped++;
      continue;
    }

    const report = sanitize(rawReport);
    const { key, jobId: resolvedId } = resolveKey(jobId, company);
    console.log(`  → key: ${key}`);

    if (!feedbackData[key]) {
      feedbackData[key] = { company, jobId: resolvedId ?? null, jobTitle: jobTitle ?? null, reportCount: 0, lastUpdated: '', reports: [] };
    }

    // Abuse gate: repeats, copy-paste resubmits, and coordinated bursts get
    // labeled for a human instead of silently published or silently dropped.
    const abuse = abuseCheck(feedbackData[key], report, submitter);
    if (abuse) {
      console.log(`  → QUARANTINE: ${abuse}\n`);
      if (!DRY_RUN) {
        await gh(`/issues/${issue.number}/labels`, {
          method: 'POST', body: JSON.stringify({ labels: ['needs-review'] }),
        }).catch(() => {});
        await gh(`/issues/${issue.number}/comments`, {
          method: 'POST',
          body: JSON.stringify({
            body: `Held for review — ${abuse}.\n\nNot published. A maintainer can publish it by removing the \`needs-review\` label after checking, or close it.\n\n_designjobs.cv automated review_`,
          }),
        }).catch(() => {});
      }
      quarantined++;
      continue;
    }

    if (submitter) report.submitter = submitter;
    feedbackData[key].reports.push(report);
    feedbackData[key].reportCount = feedbackData[key].reports.length;
    feedbackData[key].lastUpdated = new Date().toISOString().split('T')[0];

    await closeIssue(issue.number,
      `Processed ✓ — added to \`job-feedback.json\` under \`${key}\` (${feedbackData[key].reportCount} total report${feedbackData[key].reportCount !== 1 ? 's' : ''}).\n\n_designjobs.cv automated review_`
    );

    processed++;
    console.log(`  → added (total: ${feedbackData[key].reportCount})\n`);
  }

  if (processed > 0 && !DRY_RUN) {
    writeFileSync(join(ROOT, 'src/data/job-feedback.json'), JSON.stringify(feedbackData, null, 2) + '\n');
    execSync('git add src/data/job-feedback.json', { cwd: ROOT, stdio: 'inherit' });
    const diff = execSync('git diff --cached --stat', { cwd: ROOT }).toString().trim();
    if (diff) {
      execSync(`git commit -m "Feedback: add ${processed} candidate experience report(s)"`, { cwd: ROOT, stdio: 'inherit' });
      execSync('git push', { cwd: ROOT, stdio: 'inherit' });
      console.log('Committed and pushed.');
    }
  } else if (processed > 0 && DRY_RUN) {
    console.log(`[dry-run] Would write ${processed} report(s) to job-feedback.json`);
  }

  console.log(`Done — processed: ${processed}, skipped: ${skipped}, quarantined: ${quarantined}`);
}

main().catch(err => { console.error(err); process.exit(1); });
