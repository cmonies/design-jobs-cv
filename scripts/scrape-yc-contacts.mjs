#!/usr/bin/env node
// Extract founder contacts for YC-listed jobs from YC company pages.
// Writes/merges into src/data/job-contacts.json keyed by job id.
// Every LinkedIn URL comes straight from YC's embedded page data — never constructed.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOBS_PATH = join(root, 'src', 'data', 'jobs.json');
const OUT_PATH = join(root, 'src', 'data', 'job-contacts.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const jobs = JSON.parse(readFileSync(JOBS_PATH, 'utf8')).filter(j => j.id && j.url);
const ycJobs = jobs.filter(j => /ycombinator\.com\/companies\/([^/]+)/.test(j.url));

let out = {};
try { out = JSON.parse(readFileSync(OUT_PATH, 'utf8')); } catch { /* first run */ }

const decodeEntities = s => s
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const bySlug = new Map();
for (const job of ycJobs) {
  const slug = /ycombinator\.com\/companies\/([^/]+)/.exec(job.url)[1];
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug).push(job);
}

const today = new Date().toISOString().slice(0, 10);

for (const [slug, slugJobs] of bySlug) {
  try {
    const res = await fetch(`https://www.ycombinator.com/companies/${slug}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) { console.log(`  skip ${slug} — HTTP ${res.status}`); continue; }
    const html = await res.text();
    const m = /data-page="([^"]+)"/.exec(html);
    if (!m) { console.log(`  skip ${slug} — no page data`); continue; }
    const page = JSON.parse(decodeEntities(m[1]));
    const founders = (page?.props?.company?.founders || [])
      .filter(f => f.is_active !== false && f.full_name && f.linkedin_url && /^https:\/\/(www\.)?linkedin\.com\//.test(f.linkedin_url))
      .slice(0, 3)
      .map(f => ({
        name: f.full_name,
        title: f.title || 'Founder',
        linkedinUrl: f.linkedin_url,
        role: 'founder',
        source: 'YC company page',
        verifiedAt: today,
      }));
    if (!founders.length) { console.log(`  none ${slug} — no founders with LinkedIn`); continue; }
    for (const job of slugJobs) out[job.id] = founders;
    console.log(`  ok   ${slug} — ${founders.map(f => f.name).join(', ')} (${slugJobs.length} job${slugJobs.length > 1 ? 's' : ''})`);
  } catch (err) {
    console.log(`  err  ${slug} — ${err.message}`);
  }
}

writeFileSync(OUT_PATH, JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
console.log(`\n${Object.keys(out).length} jobs with contacts → ${OUT_PATH}`);
