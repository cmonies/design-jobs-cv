#!/usr/bin/env node
// Detect (and optionally fix) metadata drift between jobs.json and the live ATS
// posting: title, employment type, salary, and remote/hybrid status can all
// change after we publish — e.g. a contract role converting to full-time.
//
// Sources are the same public ATS APIs the details scraper uses (Ashby,
// Greenhouse, Lever) plus JSON-LD from the posting page as a fallback.
// Job ids are NEVER changed — the detail-page URL stays stable.
//
// Usage: node scripts/check-job-drift.mjs [--fix] [--only <job-id>]
//   default: report drift, exit 0 (exit 2 when drift found, so agents notice)
//   --fix:   apply unambiguous fixes to src/data/jobs.json and report them

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOBS_PATH = join(root, 'src', 'data', 'jobs.json');
const UA = 'designjobs.cv drift checker (https://designjobs.cv)';

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

// ---------- normalizers ----------

// Board enum: 'Full-time' | 'Contract' | 'Part-time' | 'Internship'
function normEmployment(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  if (s.includes('contract') || s === 'contractor' || s === 'temporary') return 'Contract';
  if (s.includes('fulltime')) return 'Full-time';
  if (s.includes('parttime')) return 'Part-time';
  if (s.includes('intern')) return 'Internship';
  return null; // unknown value — never guess
}

// Board enum: 'Remote' | 'Hybrid' | 'On-site'
function normWorkplace(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s === 'remote') return 'Remote';
  if (s === 'hybrid') return 'Hybrid';
  if (s === 'onsite' || s === 'on-site') return 'On-site';
  return null;
}

// "$190K – $240K • Offers Equity" → "$190,000 - $240,000" (board format)
function normSalary(raw) {
  if (!raw) return null;
  const nums = [...String(raw).matchAll(/\$\s?(\d[\d,.]*)\s*([kK])?/g)].map(([, n, k]) => {
    let v = Number(n.replace(/,/g, ''));
    if (k) v *= 1000;
    return v;
  }).filter(v => v >= 1000 && v <= 1_000_000); // ignore hourly rates, stray numbers, and equity-value ranges
  if (nums.length >= 2) return `$${nums[0].toLocaleString('en-US')} - $${nums[1].toLocaleString('en-US')}`;
  if (nums.length === 1) return `$${nums[0].toLocaleString('en-US')}`;
  return null;
}

// canonicalize for comparison only: unify dash variants, strip emoji/decoration,
// collapse whitespace — so punctuation churn doesn't register as drift
const normTitle = s => (s || '')
  .replace(/[‐-―]/g, '-')
  .replace(/[^\p{L}\p{N}\s\-–—/@&(),.+']/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

// ---------- per-ATS live-posting fetchers ----------
// Each returns {title, employmentType, locationType, salaryText, location} with
// nulls for anything the source doesn't state. null return = posting not found
// there (NOT proof the job is dead — the audit's Playwright pass owns that).

const ashbyBoards = new Map();
async function ashby(url) {
  const m = /jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/i.exec(url);
  if (!m) return null;
  const [, org, uuid] = m;
  if (!ashbyBoards.has(org)) {
    ashbyBoards.set(org, get(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`).catch(() => null));
  }
  const posting = (await ashbyBoards.get(org))?.jobs?.find(j => j.id === uuid);
  if (!posting) return null;
  return {
    title: posting.title || null,
    employmentType: normEmployment(posting.employmentType),
    locationType: posting.isRemote === true ? 'Remote' : null, // false ≠ on-site (could be hybrid)
    salaryText: normSalary(posting.compensation?.scrapeableCompensationSalarySummary || posting.compensation?.compensationTierSummary),
    location: posting.location || null,
  };
}

async function greenhouse(url) {
  const m = /greenhouse\.io\/(?:embed\/job_app\?[^ ]*token=)?([^/?]+)\/jobs\/(\d+)/i.exec(url);
  if (!m) return null;
  const data = await get(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`).catch(() => null);
  if (!data?.title) return null;
  // Greenhouse's board API has no employment type — JSON-LD fallback covers it
  return { title: data.title, employmentType: null, locationType: null, salaryText: null, location: data.location?.name || null };
}

async function lever(url) {
  const m = /jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{36})/i.exec(url);
  if (!m) return null;
  const data = await get(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`).catch(() => null);
  if (!data?.text) return null;
  return {
    title: data.text,
    employmentType: normEmployment(data.categories?.commitment),
    locationType: normWorkplace(data.workplaceType),
    salaryText: data.salaryRange ? normSalary(`$${data.salaryRange.min} $${data.salaryRange.max}`) : null,
    location: data.categories?.location || null,
  };
}

async function jsonLd(url) {
  const html = await get(url, 'text').catch(() => null);
  if (!html) return null;
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
      const p = nodes.find(n => n && n['@type'] === 'JobPosting');
      if (!p) continue;
      const et = Array.isArray(p.employmentType) ? p.employmentType[0] : p.employmentType;
      const sal = p.baseSalary?.value;
      return {
        title: p.title || null,
        employmentType: normEmployment(et),
        locationType: /telecommute/i.test(p.jobLocationType || '') ? 'Remote' : null,
        salaryText: sal ? normSalary(`$${sal.minValue ?? sal.value ?? ''} $${sal.maxValue ?? ''}`) : null,
        location: null,
      };
    } catch { /* keep looking */ }
  }
  return null;
}

async function fetchLive(url) {
  const host = new URL(url).hostname;
  let live = null;
  if (host.endsWith('ashbyhq.com')) live = await ashby(url);
  else if (host.includes('greenhouse.io')) live = await greenhouse(url);
  else if (host.endsWith('lever.co')) live = await lever(url);
  if (!live) live = await jsonLd(url);
  else if (live.employmentType === null) {
    // API found the posting but doesn't state employment type — JSON-LD may
    const ld = await jsonLd(url);
    if (ld?.employmentType) live.employmentType = ld.employmentType;
  }
  return live;
}

// ---------- main ----------

const fix = process.argv.includes('--fix');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const jobs = JSON.parse(readFileSync(JOBS_PATH, 'utf8'));
const targets = jobs.filter(j => j.id && j.url && (!only || j.id === only));

const drifted = [];
const errors = [];
const pool = 6;
let cursor = 0;

async function worker() {
  while (cursor < targets.length) {
    const job = targets[cursor++];
    let live;
    try {
      live = await fetchLive(job.url);
    } catch (err) {
      errors.push(`${job.id} — ${err.message}`);
      continue;
    }
    if (!live) continue; // unreachable posting — the Playwright audit owns dead-link calls

    const changes = [];
    if (live.employmentType && job.employmentType && live.employmentType !== job.employmentType) {
      // a part-time contract is still a contract — trust the posting title over
      // the ATS commitment field, so the board's Contract filter keeps working
      const stillContract = job.employmentType === 'Contract' && /contract/i.test(live.title || '');
      if (!stillContract) {
        changes.push({ field: 'employmentType', from: job.employmentType, to: live.employmentType });
      }
    }
    if (live.title && normTitle(live.title) !== normTitle(job.title)) {
      changes.push({ field: 'title', from: job.title, to: normTitle(live.title) });
    }
    if (live.locationType && job.locationType && live.locationType !== job.locationType) {
      changes.push({ field: 'locationType', from: job.locationType, to: live.locationType });
    }
    if (live.salaryText && job.salary && normSalary(job.salary) && live.salaryText !== normSalary(job.salary)) {
      changes.push({ field: 'salary', from: job.salary, to: live.salaryText });
    } else if (live.salaryText && !job.salary) {
      changes.push({ field: 'salary', from: '(none)', to: live.salaryText });
    }
    // location string formats vary too much across ATSes to compare reliably —
    // locationType (Remote/Hybrid/On-site) is the signal that matters.

    if (changes.length) {
      drifted.push({ job, changes });
      if (fix) {
        for (const c of changes) job[c.field === 'salary' ? 'salary' : c.field] = c.to;
      }
    }
  }
}

await Promise.all(Array.from({ length: pool }, worker));

for (const { job, changes } of drifted) {
  for (const c of changes) {
    console.log(`${fix ? 'FIXED' : 'DRIFT'} ${job.id} | ${c.field}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
  }
}
if (errors.length) {
  console.log(`\nCould not check ${errors.length}:`);
  for (const e of errors) console.log(`  -    ${e}`);
}
console.log(`\n${drifted.length} of ${targets.length} jobs drifted${fix ? ' (fixed in jobs.json)' : ''}; ${errors.length} unreachable`);

if (fix && drifted.length) {
  writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2) + '\n');
}
if (!fix && drifted.length) process.exit(2);
