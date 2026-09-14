#!/usr/bin/env node
// Tag linter — a BLOCKLIST, not an allowlist. Descriptive tags are welcome;
// we only strip the categories that read as garbage in a header pill:
// tech stacks, investor names, redundant-on-a-design-board terms, internal
// company jargon, and requirement trivia.
//
// Usage: node scripts/lint-tags.mjs [--fix] [--staging]
//   default: report violations (exit 2 if any)
//   --fix:     strip denied tags, dedupe, cap at 6, write file
//   --staging: operate on jobs-staging.json instead of jobs.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TAGS = 6;

// ── Denied tags (case-insensitive). Add here when garbage shows up. ─────────
export const DENY = new Set([
  // tech stacks & tools — designers don't filter jobs by framework
  'react', 'next.js', 'nextjs', 'swift', 'webgl', 'figma', 'android', 'ios',
  'typescript', 'tailwind', 'flutter',
  // redundant on a design job board
  'product design', 'ux design', 'ui-ux', 'ui', 'ux', 'design', 'designer',
  'remote', 'startup', 'contract', 'full-time',
  // investor names & funding stages
  'yc', 'yc w24', 'a16z', 'series a', 'series b', 'series c', 'series d',
  // vague filler
  'ai fluency', 'ai-assisted design', 'data-driven', 'experimentation',
  'partnerships', 'outcomes', 'onboarding', 'email',
  // internal company jargon — means nothing outside the company
  'clearinghouse', 'company memory', 'audience intelligence',
  'relationship intelligence', 'meeting intelligence',
  'browser infrastructure', 'frontline communication', 'connected operations',
  'product data', 'mini apps',
  // requirement/perk trivia — belongs in the description
  'mandarin required', 'eu', 'loan forgiveness eligible',
  // drug & condition names (policy since the GLP-1 incident)
  'glp-1', 'diabetes', 'obesity', 'hypertension', 'hormones', 'msk',
]);

// Light normalization for true synonyms — keep this SMALL
const ALIASES = {
  'musculoskeletal': 'physical therapy',
  'wearable': 'wearables',
  'design system': 'design systems',
};

export function lintTags(tags) {
  const kept = [];
  const dropped = [];
  for (const raw of tags || []) {
    const lower = raw.toLowerCase().trim();
    if (DENY.has(lower)) { dropped.push(raw); continue; }
    kept.push(ALIASES[lower] || raw);
  }
  const deduped = [...new Set(kept)].slice(0, MAX_TAGS);
  return { tags: deduped, dropped, changed: JSON.stringify(deduped) !== JSON.stringify(tags) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const fix = process.argv.includes('--fix');
  const file = process.argv.includes('--staging') ? 'jobs-staging.json' : 'jobs.json';
  const path = join(root, 'src', 'data', file);
  const jobs = JSON.parse(readFileSync(path, 'utf8'));
  let violations = 0;
  for (const job of jobs) {
    const r = lintTags(job.tags);
    if (!r.changed) continue;
    violations++;
    console.log(`${fix ? 'FIXED' : 'LINT'} ${job.id}`);
    for (const d of r.dropped) console.log(`    - dropped: ${d}`);
    if (fix) job.tags = r.tags;
  }
  if (fix && violations) {
    writeFileSync(path, JSON.stringify(jobs, null, 2) + '\n');
  }
  console.log(`\n${violations} of ${jobs.length} jobs ${fix ? 'fixed' : 'with tag violations'} (${file})`);
  if (!fix && violations) process.exit(2);
}
