#!/usr/bin/env node
// Find a likely recruiter / design-hiring contact per company via LinkedIn people
// search, using the already-logged-in CDP Chrome (port 9222). Merges into
// src/data/job-contacts.json keyed by job id.
//
// Rules: profile URLs are taken only from the live search-results DOM (never
// constructed), searches are paced with jittered delays, results are written
// incrementally so the run is resumable (companies already in the file are skipped).
//
// Usage: node scripts/scrape-linkedin-contacts.mjs [--limit N] [--company "Name"]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOBS_PATH = join(root, 'src', 'data', 'jobs.json');
const OUT_PATH = join(root, 'src', 'data', 'job-contacts.json');

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;
const onlyCompany = args.includes('--company') ? args[args.indexOf('--company') + 1] : null;

const RECRUITER_RE = /\b(recruit|talent|people ops|people operations|sourcer|head of people)\w*/i;
const DESIGN_LEAD_RE = /\b(head of design|design director|director of design|vp,? design|vp of design|design lead|lead (product )?designer|design manager|manager,? (product )?design|chief design)\b/i;

const jobs = JSON.parse(readFileSync(JOBS_PATH, 'utf8')).filter(j => j.id && j.url);
let out = {};
try { out = JSON.parse(readFileSync(OUT_PATH, 'utf8')); } catch { /* first run */ }

// company -> jobs, skipping companies whose jobs all have contacts already
const byCompany = new Map();
for (const j of jobs) {
  if (!byCompany.has(j.company)) byCompany.set(j.company, []);
  byCompany.get(j.company).push(j);
}
let pending = [...byCompany.entries()].filter(([, js]) => js.some(j => !out[j.id]));
if (onlyCompany) pending = pending.filter(([c]) => c.toLowerCase() === onlyCompany.toLowerCase());
pending = pending.slice(0, limit);

console.log(`${pending.length} companies to search`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = () => 8000 + Math.floor(Math.random() * 6000);
const today = new Date().toISOString().slice(0, 10);

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.bringToFront(); // background tabs are throttled and never hydrate results

// login check
await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
await sleep(2500);
if (/\/(login|authwall|checkpoint)/.test(page.url())) {
  console.error('NOT LOGGED IN — aborting. Re-login via CDP Chrome first.');
  await page.close();
  process.exit(1);
}
console.log('LinkedIn session OK');

async function searchPeople(query) {
  const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`;
  await page.goto(url, { waitUntil: 'load', timeout: 45_000 }).catch(() => {});
  await page.waitForSelector('a[href*="/in/"]', { timeout: 15_000 }).catch(() => {});
  await sleep(2000 + Math.random() * 1500);
  // Cards: any list item containing a profile link ([role=listitem] in the 2026
  // DOM, li in older variants). URLs read from the DOM only.
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="listitem"], li')].filter(li => li.querySelector('a[href*="/in/"]'));
    return items.slice(0, 10).map(li => {
      const a = li.querySelector('a[href*="/in/"]');
      let href = a.href.split('?')[0];
      const lines = li.innerText.split('\n').map(s => s.trim()).filter(Boolean)
        .filter(s => !/^(•|·)?\s*(1st|2nd|3rd|3rd\+)\s*(degree)?/i.test(s) && !/^(Connect|Message|Follow|View)/.test(s));
      return { href, lines: lines.slice(0, 6) };
    });
  });
}

// The card must mention the company as a discrete token — "at ElevenLabs",
// "@Figma", "Hinge Health |" — with no further word after it, so "Nex" can't
// match "PT. Nex Media Indonesia". Mentions prefixed with Ex-/former are
// rejected (past employees). Brand short-forms drop a generic trailing word:
// "Garner Health" also matches "Recruiting @ Garner".
function companyVariants(company) {
  const variants = [company];
  const words = company.split(/\s+/);
  if (words.length > 1 && /^(Health|Labs?|Care|App|AI|Inc\.?|Technologies|HQ)$/i.test(words[words.length - 1])) {
    const short = words.slice(0, -1).join(' ');
    if (short.length >= 4) variants.push(short);
  }
  return variants;
}

function mentionsCompany(blob, company) {
  return companyVariants(company).some(v => {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[\\s@|•·(,:;/-])(?<!\\b(?:ex|fmr)[-\\s])(?<!\\bformer(?:ly)?\\s)${esc}(?=\\s*$|\\s*[^\\sA-Za-z0-9])`, 'im');
    return re.test(blob);
  });
}

function pickContacts(results, company) {
  const seen = new Set();
  const scored = [];
  for (const r of results) {
    if (!r.href || seen.has(r.href)) continue;
    seen.add(r.href);
    const name = (r.lines[0] || '')
      .replace(/,?\s*(he\/him|she\/her|they\/them).*$/i, '')
      .replace(/\s*[•·]\s*(1st|2nd|3rd\+?)\s*$/i, '')
      .trim();
    if (!name || name.length > 60) continue;
    // One line must tie the person to BOTH the role and the company — the
    // headline (first two lines after the name) or a "Current:" line. That
    // line is what we display, so every shown title is self-evidencing.
    // Surnames like "Dana Sleeper" can't match (name line excluded), and
    // company mentions in "Past:" roles or activity snippets don't count.
    const line = r.lines
      .map((l, i) => ({ text: l.replace(/^Current:\s*/i, ''), i, isCurrent: /^Current:/i.test(l) }))
      .filter(x => x.i > 0 && !/^Past:/i.test(r.lines[x.i]) && (x.i <= 2 || x.isCurrent))
      .filter(x => mentionsCompany(x.text, company))
      .find(x => RECRUITER_RE.test(x.text) || DESIGN_LEAD_RE.test(x.text));
    if (!line) continue;
    if (RECRUITER_RE.test(line.text)) {
      scored.push({ score: /design|product|creative|ux/i.test(line.text) ? 3 : 2, role: 'recruiter', name, headline: line.text, href: r.href });
    } else {
      scored.push({ score: 2.5, role: 'design-leader', name, headline: line.text, href: r.href });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const picks = [];
  const recruiter = scored.find(s => s.role === 'recruiter');
  const leader = scored.find(s => s.role === 'design-leader');
  if (recruiter) picks.push(recruiter);
  if (leader) picks.push(leader);
  return picks.slice(0, 2).map(p => ({
    name: p.name,
    title: p.headline.slice(0, 120),
    linkedinUrl: p.href,
    role: p.role,
    source: 'LinkedIn people search',
    verifiedAt: today,
  }));
}

let done = 0, found = 0;
for (const [company, companyJobs] of pending) {
  done++;
  try {
    let contacts = pickContacts(await searchPeople(`${company} recruiter`), company);
    if (!contacts.length) {
      await sleep(jitter());
      contacts = pickContacts(await searchPeople(`${company} head of design`), company);
    }
    if (contacts.length) {
      found++;
      for (const j of companyJobs) if (!out[j.id]) out[j.id] = contacts;
      writeFileSync(OUT_PATH, JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
      console.log(`  ok   [${done}/${pending.length}] ${company} — ${contacts.map(c => `${c.name} (${c.role})`).join(', ')}`);
    } else {
      console.log(`  none [${done}/${pending.length}] ${company}`);
    }
  } catch (err) {
    console.log(`  err  [${done}/${pending.length}] ${company} — ${err.message}`);
  }
  await sleep(jitter());
}

await page.close();
console.log(`\n${found}/${pending.length} companies matched; ${Object.keys(out).length} jobs now have contacts`);
