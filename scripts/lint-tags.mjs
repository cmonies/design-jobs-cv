#!/usr/bin/env node
// Tag linter — header pills come from a controlled vocabulary, nothing else.
// Tags are for designers filtering a job board: disciplines, domains, and
// role shape. Never tech stacks (React), company jargon (clearinghouse),
// funding stages, or drug names.
//
// Usage: node scripts/lint-tags.mjs [--fix] [--staging]
//   default: report violations (exit 2 if any)
//   --fix:     normalize aliases, drop unknown tags, cap at 6, write file
//   --staging: operate on jobs-staging.json instead of jobs.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TAGS = 6;

// ── Canonical vocabulary (display form) ─────────────────────────────────────
export const VOCAB = [
  // Disciplines
  'design systems', 'visual design', 'brand', 'motion', 'web', 'mobile',
  'growth design', 'content design', 'information design', 'data visualization',
  'prototyping', 'design ops', 'design engineering', 'UX research', '0-to-1',
  'AI tools', 'accessibility', 'illustration',
  // Role shape
  'founding', 'sole designer', 'first design hire', 'entry level', 'part-time',
  // Domains
  'healthcare', 'mental health', 'behavioral health', 'chronic care',
  'physical therapy', "women's health", "men's health", 'wellness', 'fitness',
  'telehealth', 'insurance', 'benefits',
  'fintech', 'payments', 'banking', 'lending', 'investing',
  'AI', 'AI agents', 'developer tools', 'security', 'analytics',
  'climate', 'energy', 'agriculture',
  'consumer', 'B2B', 'SaaS', 'enterprise', 'marketplace', 'e-commerce',
  'social', 'gaming', 'creative tools', 'productivity', 'collaboration',
  'edtech', 'govtech', 'nonprofit', 'legal',
  'hardware', 'IoT', 'robotics', 'aerospace',
  'real estate', 'construction', 'logistics', 'trades', 'travel',
  'music', 'audio', 'video', 'sports', 'sleep', 'crypto',
  'HR', 'customer support', 'sales', 'e-sign', 'automation',
];

// ── Aliases: junk & synonyms → canonical (null = drop entirely) ─────────────
const ALIASES = {
  // tech stacks & tools — designers don't filter jobs by framework
  'react': null, 'next.js': null, 'nextjs': null, 'swift': null, 'webgl': null,
  'figma': null, 'android': null, 'ios': null, 'email': null,
  // company/internal jargon
  'clearinghouse': null, 'complex systems': null, 'company memory': null,
  'audience intelligence': null, 'relationship intelligence': null,
  'meeting intelligence': null, 'browser infrastructure': null,
  'cloud infrastructure': null, 'product data': null, 'mini apps': null,
  'frontline communication': null, 'connected operations': null,
  // vague or redundant on a design board
  'ux design': null, 'ui-ux': null, 'ui': null, 'design': null,
  'AI fluency': null, 'AI-assisted design': null, 'data-driven': null,
  // synonyms → canonical
  'healthtech': 'healthcare', 'health tech': 'healthcare',
  'clinical software': 'healthcare', 'clinical workflow': 'healthcare',
  'clinical care': 'healthcare', 'health systems': 'healthcare',
  'health admin': 'healthcare', 'healthcare operations': 'healthcare',
  'healthcare paas': 'healthcare', 'mobile health': 'healthcare',
  'public health': 'healthcare', 'community health': 'healthcare',
  'digital health': 'healthcare', 'health benefits': 'benefits',
  'employee benefits': 'benefits', 'enterprise benefits': 'benefits',
  'employer health': 'benefits',
  'online therapy': 'mental health', 'therapy': 'mental health',
  'behavior change': 'behavioral health', 'behavioral psychology': 'behavioral health',
  'b2b enterprise': 'B2B', 'b2b-saas': 'SaaS', 'b2b saas': 'SaaS',
  'business banking': 'banking', 'financial workflows': 'fintech',
  'fintech-adjacent': 'fintech', 'spend management': 'fintech',
  'global payments': 'payments', 'investor tools': 'investing',
  'agents': 'AI agents', 'agentic ux': 'AI agents', 'ai employees': 'AI agents',
  'personal agent': 'AI agents', 'conversational ai': 'AI',
  'ai voice': 'AI', 'ai audio': 'AI', 'ai video': 'AI', 'ai coaching': 'AI',
  'generative audio': 'audio', 'legal ai': 'legal', 'contract review': 'legal',
  'government': 'govtech', 'public sector': 'govtech', 'civic tech': 'govtech',
  'public interest tech': 'govtech', 'climate resilience': 'climate',
  'k-12': 'edtech', 'microschools': 'edtech', 'education': 'edtech',
  'families': 'consumer', 'local business': 'consumer', 'small business': 'B2B',
  'consumer marketplace': 'marketplace', 'consumer social': 'social',
  'consumer hardware': 'hardware', 'active entertainment': 'fitness',
  'personal training': 'fitness', 'self-care': 'wellness',
  'coaching': 'wellness', 'fantasy sports': 'sports',
  'design engineer': 'design engineering', 'design tokens': 'design systems',
  'tokens': 'design systems', 'component architecture': 'design systems',
  'rebrand': 'brand', 'motion graphics': 'motion', 'motion technology': 'motion',
  'website builder': 'creative tools', 'image generation': 'creative tools',
  'mobile app builder': 'developer tools', 'workflow automation': 'automation',
  'first pd hire': 'first design hire', 'associate': 'entry level',
  'collaborative tools': 'collaboration', 'onboarding': null,
  'experimentation': null, 'partnerships': null, 'outcomes': null,
  'mobile app': 'mobile', 'home services': 'trades', 'electrical': 'trades',
  'crm': 'sales', 'enterprise sales': 'sales', 'fundraising': 'nonprofit',
  'giving': 'nonprofit', 'growth': 'growth design',
  'b2c': 'consumer', 'reproductive health': "women's health",
  'wearables': 'hardware', 'startup': null, 'yc': null, 'a16z': null,
  'remote': null, 'contract': null, 'series a': null, 'series b': null,
  'series c': null, 'series d': null,
};

const vocabLower = new Map(VOCAB.map(t => [t.toLowerCase(), t]));

export function lintTags(tags) {
  const kept = [];
  const dropped = [];
  const mapped = [];
  for (const raw of tags || []) {
    const lower = raw.toLowerCase().trim();
    if (vocabLower.has(lower)) {
      kept.push(vocabLower.get(lower));
      continue;
    }
    if (lower in ALIASES) {
      const to = ALIASES[lower];
      if (to === null) dropped.push(raw);
      else { kept.push(to); mapped.push(`${raw} → ${to}`); }
      continue;
    }
    dropped.push(raw); // unknown = garbage until added to the vocabulary
  }
  const deduped = [...new Set(kept)].slice(0, MAX_TAGS);
  return { tags: deduped, dropped, mapped, changed: JSON.stringify(deduped) !== JSON.stringify(tags) };
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
    for (const m of r.mapped) console.log(`    ~ ${m}`);
    for (const d of r.dropped) console.log(`    - dropped: ${d}`);
    if (fix) job.tags = r.tags;
  }
  if (fix && violations) {
    writeFileSync(path, JSON.stringify(jobs, null, 2) + '\n');
  }
  console.log(`\n${violations} of ${jobs.length} jobs ${fix ? 'fixed' : 'with tag violations'} (${file})`);
  if (!fix && violations) process.exit(2);
}
