#!/usr/bin/env node
/**
 * validate-jobs.js
 * Playwright-based URL validator for healthcare design job listings.
 *
 * Usage:
 *   node scripts/validate-jobs.js [--staging] [--all] [--url <url>]
 *
 * Flags:
 *   --staging   Validate jobs-staging.json only (default if staging file non-empty)
 *   --all       Validate jobs.json + jobs-staging.json together
 *   --url <u>   Validate a single URL inline
 *
 * Exit codes:
 *   0  All jobs valid
 *   1  One or more jobs failed validation
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../src/data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const STAGING_FILE = path.join(DATA_DIR, 'jobs-staging.json');

// Phrases that indicate a job is no longer available
const DEAD_SIGNALS = [
  // Ashby closed-job signals
  'job not found',
  'the job you requested was not found',
  'this role is no longer available',
  // Generic ATS dead signals
  'no longer accepting applications',
  'this job is no longer available',
  'this job was removed',
  'sorry, this job was removed',
  'position has been filled',
  'this role has been filled',
  'job has expired',
  'job has been closed',
  'this position is no longer open',
  'this listing has expired',
  'listing has been removed',
  'posting has been removed',
  'posting has expired',
  'job posting is no longer active',
  'application closed',
  'application deadline has passed',
  'this opportunity is closed',
  'we are no longer hiring',
  'no longer available',
  'no longer active',
];

// Phrases that confirm a live job posting
const LIVE_SIGNALS = [
  'apply',
  'apply now',
  'submit application',
  'job description',
  'responsibilities',
  'requirements',
  'qualifications',
  'about the role',
  'about this role',
  'what you\'ll do',
  'what you will do',
  'who you are',
];

async function validateUrl(page, url, jobId) {
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    const status = response ? response.status() : 0;

    // Hard fail on 4xx/5xx
    if (status >= 400) {
      return { pass: false, reason: `HTTP ${status}`, status };
    }

    // Check for redirect to error page — e.g. Greenhouse redirects dead job IDs
    // to /?error=true which still returns HTTP 200
    const finalUrl = page.url();
    if (finalUrl !== url) {
      const finalUrlObj = new URL(finalUrl);
      const origUrlObj = new URL(url);
      // Flag if redirected to a different path entirely (e.g. job page → company board root)
      // or if the final URL contains error indicators
      if (finalUrlObj.searchParams.get('error') || finalUrl.includes('error=true')) {
        return { pass: false, reason: `Redirected to error page: ${finalUrl}`, status };
      }
      // Flag if redirected away from the original job path (e.g. /jobs/123 → /)
      if (origUrlObj.pathname.length > 1 && finalUrlObj.pathname !== origUrlObj.pathname) {
        return { pass: false, reason: `Redirect mismatch: ${url} → ${finalUrl}`, status };
      }
    }

    // Wait a beat for JS-heavy pages
    if (url.includes('ashbyhq.com') || url.includes('jobs.gem.com')) {
      await page.waitForTimeout(4000);
    } else if (url.includes('myworkdayjobs.com') || url.includes('workday.com')) {
      // Workday is very JS-heavy — wait for the job title heading to appear
      try {
        await page.waitForSelector('h2, h1, [data-automation-id="jobPostingTitle"]', {
          timeout: 10000,
        });
      } catch (_) {
        // Fall through — we'll still check body text
      }
      await page.waitForTimeout(2000);
    }

    const bodyText = (await page.innerText('body')).toLowerCase();

    // Check dead signals
    for (const signal of DEAD_SIGNALS) {
      if (bodyText.includes(signal)) {
        return { pass: false, reason: `Dead signal: "${signal}"`, status };
      }
    }

    // Check live signals — at least one must be present
    const foundLive = LIVE_SIGNALS.some(s => bodyText.includes(s));
    if (!foundLive) {
      return { pass: false, reason: 'No live job signals found on page', status };
    }

    return { pass: true, reason: 'OK', status };
  } catch (err) {
    return { pass: false, reason: err.message.split('\n')[0], status: 0 };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flagAll = args.includes('--all');
  const flagStaging = args.includes('--staging');
  const urlIdx = args.indexOf('--url');
  const singleUrl = urlIdx !== -1 ? args[urlIdx + 1] : null;

  let jobs = [];

  if (singleUrl) {
    jobs = [{ id: 'inline', title: 'inline', company: 'inline', url: singleUrl }];
  } else {
    const staging = JSON.parse(fs.readFileSync(STAGING_FILE, 'utf8'));
    const live = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));

    if (flagAll) {
      jobs = [...staging, ...live];
    } else if (flagStaging || staging.length > 0) {
      jobs = staging;
      if (!flagStaging && staging.length > 0 && !flagAll) {
        // Default: staging only when it has content
        console.log(`ℹ️  Validating ${staging.length} staging jobs (use --all to include live jobs)\n`);
      }
    } else {
      jobs = live;
    }
  }

  if (jobs.length === 0) {
    console.log('No jobs to validate.');
    process.exit(0);
  }

  console.log(`🎭 Playwright URL Validator — checking ${jobs.length} job(s)\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const job of jobs) {
    process.stdout.write(`  Checking ${job.company} — ${job.title}... `);
    const result = await validateUrl(page, job.url, job.id);
    result.job = job;
    results.push(result);

    if (result.pass) {
      passed++;
      console.log(`✅ ${result.reason} (${result.status})`);
    } else {
      failed++;
      console.log(`❌ FAIL — ${result.reason} (${result.status})`);
    }
  }

  await browser.close();

  console.log(`\n─────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed (${jobs.length} total)`);

  if (failed > 0) {
    console.log('\n❌ Failed jobs:');
    results.filter(r => !r.pass).forEach(r => {
      console.log(`   ${r.job.id} — ${r.job.url}`);
      console.log(`   Reason: ${r.reason}`);
    });
  }

  // Write JSON report
  const reportPath = path.join(__dirname, '../src/data/jobs-audit.json');
  const existing = fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    : {};
  const report = {
    ...existing,
    lastRun: new Date().toISOString(),
    summary: { passed, failed, total: jobs.length },
    results: results.map(r => ({
      id: r.job.id,
      company: r.job.company,
      title: r.job.title,
      url: r.job.url,
      pass: r.pass,
      reason: r.reason,
      status: r.status,
      checkedAt: new Date().toISOString(),
    })),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report written to src/data/jobs-audit.json`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
