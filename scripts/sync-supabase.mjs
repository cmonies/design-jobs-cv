#!/usr/bin/env node
// Mirrors src/data/jobs.json into Supabase so candidate-experience reports
// have a company and job to attach to. jobs.json stays the source of truth
// for listings; this just keeps the DB's copy current.
//
//   * companies: upserted by slug (name/url/vertical refreshed from jobs.json)
//   * jobs:      upserted by id, status='active', last_seen_at=now
//   * jobs in the DB but no longer in jobs.json → status='dead', removed_at=now
//     (never deleted — reports keep pointing at them)
//
// Run after every publish:  npm run sync   (or node scripts/sync-supabase.mjs [--dry-run])
// Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env or the environment.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { slugify } from '../src/lib/slug.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');

// Minimal .env loader — no dotenv dependency, never overrides real env vars.
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required (see .env.example)');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const jobs = JSON.parse(readFileSync(join(ROOT, 'src/data/jobs.json'), 'utf8')).filter(j => j.id && j.company);

// ── Companies ───────────────────────────────────────────────────────────────
const companies = new Map();
for (const j of jobs) {
  const slug = slugify(j.company);
  if (!companies.has(slug)) {
    companies.set(slug, { slug, name: j.company, url: j.companyUrl || null, vertical: j.vertical || null });
  }
}
console.log(`${jobs.length} jobs across ${companies.size} companies`);

if (DRY_RUN) {
  console.log('[dry-run] would upsert companies:', [...companies.keys()].slice(0, 10).join(', '), '…');
}

let companyIds = new Map();
if (!DRY_RUN) {
  const { data, error } = await db
    .from('companies')
    .upsert([...companies.values()], { onConflict: 'slug' })
    .select('id, slug');
  if (error) fail('companies upsert', error);
  companyIds = new Map(data.map(c => [c.slug, c.id]));
}

// ── Jobs ────────────────────────────────────────────────────────────────────
const now = new Date().toISOString();
const rows = jobs.map(j => ({
  id: j.id,
  company_id: companyIds.get(slugify(j.company)) ?? null,
  title: j.title,
  url: j.url,
  level: j.level || null,
  location_type: j.locationType || null,
  location: j.location || null,
  employment_type: j.employmentType || 'Full-time',
  vertical: j.vertical || null,
  salary: j.salary || null,
  tags: Array.isArray(j.tags) ? j.tags : [],
  posted_at: j.postedAt || j.postedDate || null,
  status: 'active',
  last_seen_at: now,
  removed_at: null,
}));

if (!DRY_RUN) {
  // Batches keep each request comfortably under PostgREST's payload limits.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('jobs').upsert(rows.slice(i, i + 200), { onConflict: 'id' });
    if (error) fail('jobs upsert', error);
  }
}
console.log(`${DRY_RUN ? '[dry-run] would upsert' : 'upserted'} ${rows.length} jobs`);

// ── Dead jobs ───────────────────────────────────────────────────────────────
const liveIds = new Set(rows.map(r => r.id));
const { data: active, error: activeErr } = await db.from('jobs').select('id').eq('status', 'active');
if (activeErr) fail('jobs select', activeErr);
const dead = (active ?? []).map(r => r.id).filter(id => !liveIds.has(id));

if (dead.length && !DRY_RUN) {
  const { error } = await db.from('jobs').update({ status: 'dead', removed_at: now }).in('id', dead);
  if (error) fail('jobs mark dead', error);
}
console.log(`${DRY_RUN ? '[dry-run] would mark' : 'marked'} ${dead.length} job(s) dead${dead.length ? ': ' + dead.join(', ') : ''}`);

function fail(step, error) {
  console.error(`${step} failed:`, error.message || error);
  process.exit(1);
}
