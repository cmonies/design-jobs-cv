#!/usr/bin/env node
// Scrape job descriptions from each listing's ATS and write src/data/job-details.json.
// Uses public ATS APIs where they exist (Ashby, Greenhouse, Lever) and falls back to
// JSON-LD / embedded JSON extraction for the rest (YC, Gem). Never fabricates content:
// a job with no scrapeable description simply gets no entry.
//
// Usage: node scripts/scrape-job-details.mjs [--only <job-id>]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOBS_PATH = join(root, 'src', 'data', 'jobs.json');
const OUT_PATH = join(root, 'src', 'data', 'job-details.json');
const UA = 'designjobs.cv job-details fetcher (https://designjobs.cv)';
const MAX_HTML = 60_000;

// ---------- HTML cleanup ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };

function decodeEntities(s) {
  // some ATSes double-encode (&amp;nbsp;) — decode until stable, max 3 passes
  for (let i = 0; i < 3; i++) {
    const out = s
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
    if (out === s) break;
    s = out;
  }
  return s;
}

const KEEP_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'a', 'h3', 'h4', 'h5', 'blockquote', 'hr']);
const DEMOTE = { h1: 'h3', h2: 'h3', h6: 'h5' };

// Whitelist-based sanitizer. Keeps structural/text tags, strips everything else
// (attributes included) while preserving inner text. Good enough for ATS output,
// which is editor-generated HTML, not adversarial input — but we still never
// pass through scripts, styles, handlers, or non-http hrefs.
function sanitizeHtml(html) {
  let s = html;
  // Drop whole blocks whose content we don't want
  s = s.replace(/<(script|style|noscript|iframe|svg|form|video|audio|object|embed|head|title)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(img|source|input|picture|figure)\b[^>]*>/gi, ' ');

  s = s.replace(/<\/?([a-zA-Z0-9]+)((?:\s[^<>]*)?)>/g, (m, rawTag, attrs) => {
    const closing = m.startsWith('</');
    let tag = rawTag.toLowerCase();
    if (DEMOTE[tag]) tag = DEMOTE[tag];
    if (!KEEP_TAGS.has(tag)) {
      // block-ish unknown tags become paragraph breaks so text doesn't run together
      return /^(div|section|article|tr|table|tbody|td|th|dd|dt)$/.test(tag) ? (closing ? '</p>' : '<p>') : ' ';
    }
    if (closing) return `</${tag}>`;
    if (tag === 'a') {
      const href = /href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(attrs || '');
      return href ? `<a href="${href[1]}" target="_blank" rel="noopener noreferrer">` : '<a>';
    }
    if (tag === 'br' || tag === 'hr') return `<${tag} />`;
    return `<${tag}>`;
  });

  // Tidy: collapse whitespace, nuke empty paragraphs/headings and stray breaks
  s = s
    .replace(/\u00a0/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/(<br \/>\s*){3,}/gi, '<br /><br />')
    .replace(/<(p|h3|h4|h5|strong|b|em|i|u|li)>(\s|<br \/>)*<\/\1>/gi, '')
    .replace(/<a>\s*<\/a>/gi, '')
    .replace(/\s*(<\/?(?:p|ul|ol|li|h3|h4|h5|blockquote)>)\s*/g, '$1')
    .trim();
  // second pass — removing inner empties can expose newly-empty outer blocks
  s = s.replace(/<(p|h3|h4|h5|strong|b|em|i|u|li)>(\s|<br \/>)*<\/\1>/gi, '').trim();
  // dividers, breaks, and orphaned <p> wrappers (auto-closed by browsers)
  // at the very start or end of the content are noise
  s = s
    .replace(/^(\s|<hr \/>|<br \/>|<p>(?=\s*<(?:hr|p|ul|ol|h3|h4|h5|blockquote)))+/i, '')
    .replace(/(\s|<hr \/>|<br \/>)+$/i, '')
    .trim();

  if (s.length > MAX_HTML) {
    // cut at the last closing block tag before the cap to avoid dangling markup
    const cut = s.slice(0, MAX_HTML);
    const lastClose = cut.lastIndexOf('</');
    const end = cut.indexOf('>', lastClose);
    s = end > 0 ? cut.slice(0, end + 1) : cut;
  }
  return s;
}

function textLength(html) {
  return html.replace(/<[^>]+>/g, '').trim().length;
}

// ---------- fetch helpers ----------

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : 'text/html' }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

// ---------- per-ATS handlers ----------

const ashbyBoards = new Map();
async function ashby(url) {
  const m = /jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/i.exec(url);
  if (!m) return null;
  const [, org, uuid] = m;
  if (!ashbyBoards.has(org)) {
    ashbyBoards.set(org, get(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`).catch(() => null));
  }
  const board = await ashbyBoards.get(org);
  const posting = board?.jobs?.find(j => j.id === uuid);
  if (!posting?.descriptionHtml) return null;
  return {
    descriptionHtml: sanitizeHtml(posting.descriptionHtml),
    salaryText: posting.compensation?.compensationTierSummary || null,
    source: 'ashby',
  };
}

async function greenhouse(url) {
  const m = /greenhouse\.io\/(?:embed\/job_app\?[^ ]*token=)?([^/?]+)\/jobs\/(\d+)/i.exec(url);
  if (!m) return null;
  const [, board, id] = m;
  const data = await get(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`).catch(() => null);
  if (!data?.content) return null;
  return {
    descriptionHtml: sanitizeHtml(decodeEntities(data.content)),
    salaryText: null,
    source: 'greenhouse',
  };
}

async function lever(url) {
  const m = /jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{36})/i.exec(url);
  if (!m) return null;
  const [, org, uuid] = m;
  const data = await get(`https://api.lever.co/v0/postings/${org}/${uuid}`).catch(() => null);
  if (!data) return null;
  const parts = [];
  if (data.description) parts.push(data.description);
  for (const list of data.lists || []) {
    if (list.text) parts.push(`<h3>${list.text}</h3>`);
    if (list.content) parts.push(`<ul>${list.content}</ul>`);
  }
  if (data.additional) parts.push(data.additional);
  const html = parts.join('\n');
  if (!html.trim()) return null;
  return {
    descriptionHtml: sanitizeHtml(html),
    salaryText: data.salaryRange ? `$${Number(data.salaryRange.min).toLocaleString()}–$${Number(data.salaryRange.max).toLocaleString()}${data.salaryRange.interval ? ` ${data.salaryRange.interval.replaceAll('-', ' ').toLowerCase()}` : ''}` : null,
    source: 'lever',
  };
}

// Generic: look for schema.org JobPosting JSON-LD, or YC's embedded page JSON.
async function generic(url) {
  const html = await get(url, 'text').catch(() => null);
  if (!html) return null;

  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
      const posting = nodes.find(n => n && n['@type'] === 'JobPosting' && n.description);
      if (posting) {
        let desc = posting.description;
        if (!/[<>]/.test(desc)) desc = `<p>${desc.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br />')}</p>`;
        else if (/&lt;/.test(desc) && !/</.test(desc.replace(/&lt;/g, ''))) desc = decodeEntities(desc);
        const cleaned = sanitizeHtml(desc);
        if (textLength(cleaned) > 100) return { descriptionHtml: cleaned, salaryText: null, source: 'json-ld' };
      }
    } catch { /* malformed JSON-LD — keep looking */ }
  }

  // YC embeds page props as a data-page attribute (HTML-escaped JSON)
  const dp = /data-page="([^"]+)"/.exec(html);
  if (dp) {
    try {
      const page = JSON.parse(decodeEntities(dp[1]));
      const stack = [page];
      while (stack.length) {
        const node = stack.pop();
        if (node && typeof node === 'object') {
          for (const key of ['description', 'descriptionHtml', 'jobDescription']) {
            const v = node[key];
            if (typeof v === 'string' && textLength(v) > 200) {
              const htmlish = /[<>]/.test(v) ? v : `<p>${v.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br />')}</p>`;
              return { descriptionHtml: sanitizeHtml(htmlish), salaryText: node.salaryRange || node.compensation || null, source: 'yc-embedded' };
            }
          }
          stack.push(...Object.values(node));
        }
      }
    } catch { /* not parseable — fall through */ }
  }
  return null;
}

function handlerFor(url) {
  const host = new URL(url).hostname;
  if (host.endsWith('ashbyhq.com')) return ashby;
  if (host.includes('greenhouse.io')) return greenhouse;
  if (host.endsWith('lever.co')) return lever;
  return generic;
}

// ---------- main ----------

// --only takes one id or a comma-separated list. Pass ALL ids in one invocation —
// concurrent --only processes race on the read-merge-write of job-details.json.
const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null;
const jobs = JSON.parse(readFileSync(JOBS_PATH, 'utf8')).filter(j => j.id && j.url && (!only || only.has(j.id)));

let existing = {};
try { existing = JSON.parse(readFileSync(OUT_PATH, 'utf8')); } catch { /* first run */ }

const results = {};
const failures = [];
const pool = 6;
let cursor = 0;

async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    try {
      const handler = handlerFor(job.url);
      let detail = await handler(job.url);
      // ATS API said no (removed posting, blocked API) but the public page may
      // still carry JSON-LD — fall back to the generic extractor.
      if ((!detail || textLength(detail.descriptionHtml) <= 100) && handler !== generic) {
        detail = await generic(job.url);
      }
      if (detail && textLength(detail.descriptionHtml) > 100) {
        results[job.id] = { ...detail, fetchedAt: new Date().toISOString().slice(0, 10) };
        process.stdout.write(`  ok   ${job.id} (${detail.source}, ${textLength(detail.descriptionHtml)} chars)\n`);
      } else {
        failures.push(`${job.id} — no description found`);
      }
    } catch (err) {
      failures.push(`${job.id} — ${err.message}`);
    }
  }
}

await Promise.all(Array.from({ length: pool }, worker));

// --only runs merge into the existing file. Full runs rebuild it (entries for
// jobs removed from jobs.json drop out) but keep the previous entry for any job
// whose fetch failed this run — a stale description beats the no-preview fallback.
let out;
if (only) {
  out = { ...existing, ...results };
} else {
  out = { ...results };
  for (const job of jobs) {
    if (!out[job.id] && existing[job.id]) {
      out[job.id] = existing[job.id];
      process.stdout.write(`  kept ${job.id} (previous ${existing[job.id].source} entry; fetch failed this run)\n`);
    }
  }
}
writeFileSync(OUT_PATH, JSON.stringify(Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');

console.log(`\n${Object.keys(results).length}/${jobs.length} scraped → ${OUT_PATH}`);
if (failures.length) {
  console.log(`\nNo description for ${failures.length}:`);
  for (const f of failures) console.log(`  -    ${f}`);
}
