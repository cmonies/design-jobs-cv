export const prerender = false;

import type { APIRoute } from 'astro';

const MAX_SUBMISSIONS_PER_DAY = 5;
const DAY_IN_SECONDS = 86400;

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: ip,
    }),
  });
  const data = await res.json() as { success: boolean };
  return data.success;
}

async function checkRateLimit(kv: KVNamespace, email: string): Promise<{ allowed: boolean; count: number }> {
  const key = `ratelimit:${email.toLowerCase().trim()}`;
  const existing = await kv.get(key);
  const count = existing ? parseInt(existing, 10) : 0;
  return { allowed: count < MAX_SUBMISSIONS_PER_DAY, count };
}

async function incrementRateLimit(kv: KVNamespace, email: string): Promise<void> {
  const key = `ratelimit:${email.toLowerCase().trim()}`;
  const existing = await kv.get(key);
  const count = existing ? parseInt(existing, 10) : 0;
  // TTL of 24h — auto-expires
  await kv.put(key, String(count + 1), { expirationTtl: DAY_IN_SECONDS });
}

// ── Anonymous-survey abuse controls ─────────────────────────────────────────
// The feedback survey has no email to key on, so we gate on the IP instead:
// one report per company per week, and a daily ceiling overall. Neither the
// IP nor the derived key is ever stored in the repo — only in KV, expiring.
const MAX_FEEDBACK_PER_DAY = 3;
const WEEK_IN_SECONDS = 604800;

// Salted SHA-256, truncated. Lets the processor spot "same submitter, same
// company, many reports" without anyone's IP ever touching a GitHub issue.
async function fingerprint(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join('|'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkFeedbackLimits(
  kv: KVNamespace, ip: string, company: string, salt: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const who = await fingerprint(ip, salt);
  const dayKey = `fb:day:${who}`;
  const dayCount = parseInt((await kv.get(dayKey)) || '0', 10);
  if (dayCount >= MAX_FEEDBACK_PER_DAY) {
    return { allowed: false, reason: "You've submitted several reports today. Try again tomorrow." };
  }
  const companyKey = `fb:co:${await fingerprint(ip, company.toLowerCase().trim(), salt)}`;
  if (await kv.get(companyKey)) {
    return { allowed: false, reason: 'You already shared an experience for this company recently. Thank you!' };
  }
  return { allowed: true };
}

async function recordFeedback(kv: KVNamespace, ip: string, company: string, salt: string): Promise<void> {
  const who = await fingerprint(ip, salt);
  const dayKey = `fb:day:${who}`;
  const dayCount = parseInt((await kv.get(dayKey)) || '0', 10);
  await kv.put(dayKey, String(dayCount + 1), { expirationTtl: DAY_IN_SECONDS });
  const companyKey = `fb:co:${await fingerprint(ip, company.toLowerCase().trim(), salt)}`;
  await kv.put(companyKey, '1', { expirationTtl: WEEK_IN_SECONDS });
}

async function createGitHubIssue(
  token: string,
  repo: string,
  title: string,
  body: string,
  labels: string[] = ['job-submission']
): Promise<{ ok: boolean; url?: string; error?: string; status?: number }> {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'designjobs.cv',
    },
    body: JSON.stringify({
      title,
      body,
      labels,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: err, status: res.status };
  }

  const data = await res.json() as { html_url: string };
  return { ok: true, url: data.html_url };
}

export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const runtime = (locals as any).runtime?.env || {};
  // NOTE: SUBMISSIONS_KV is a Cloudflare Workers binding (see wrangler.toml).
  // This site deploys to VERCEL, where locals.runtime is undefined — so KV is
  // always undefined here and every rate-limit branch below is inert. Turnstile
  // is the live front-door protection. To get real rate limiting on Vercel,
  // swap these helpers for Upstash Redis (REST, needs only env vars).
  const KV = runtime.SUBMISSIONS_KV as KVNamespace | undefined;
  const TURNSTILE_SECRET = runtime.TURNSTILE_SECRET_KEY || import.meta.env.TURNSTILE_SECRET_KEY || '';
  const GITHUB_TOKEN = runtime.GITHUB_TOKEN || import.meta.env.GITHUB_TOKEN || '';
  const GITHUB_REPO = runtime.GITHUB_REPO || import.meta.env.GITHUB_REPO || 'cmonies/design-jobs-cv';

  try {
    const body = await request.json() as Record<string, string>;

    // 1. Honeypot check
    if (body.website_url) {
      // Silently accept — bot thinks it worked
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isBugReport = body.type === 'bug-report';
    const isProcess = isBugReport && body.issueType === 'process';
    const isFeedback = body.type === 'interview-feedback';

    // 2. Required fields validation
    // Job submissions only require what we can't scrape from the posting URL
    const required = isFeedback
      ? ['company', 'stage']
      : isProcess
      ? ['company']
      : isBugReport
      ? ['issueType', 'description']
      : ['submitterName', 'submitterEmail', 'url'];
    for (const field of required) {
      if (!body[field]?.trim()) {
        return new Response(JSON.stringify({ ok: false, error: `Missing required field: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 3. Email format validation (only required for job submissions —
    // bug reports and feedback surveys are anonymous)
    if (!isBugReport && !isFeedback) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(body.submitterEmail)) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid email address' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 4. URL validation (skip empty optional fields)
    const urlFields = isBugReport
      ? ['pageUrl']
      : ['url', ...(body.contactUrl && !body.contactUrl.includes('@') ? ['contactUrl'] : [])];
    for (const urlField of urlFields) {
      if (!body[urlField]?.trim()) continue;
      try {
        new URL(body[urlField]);
      } catch {
        return new Response(JSON.stringify({ ok: false, error: `Invalid URL: ${urlField}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 5. Turnstile verification
    // A missing token used to skip verification entirely — omit the field and
    // you were waved through. When the secret is configured, the token is now
    // REQUIRED. (Unset secret = local dev, where checks are skipped.)
    if (TURNSTILE_SECRET) {
      if (!body.turnstileToken) {
        return new Response(JSON.stringify({ ok: false, error: 'Bot verification required. Please reload and try again.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const ip = clientAddress || request.headers.get('cf-connecting-ip') || '0.0.0.0';
      const valid = await verifyTurnstile(body.turnstileToken, TURNSTILE_SECRET, ip);
      if (!valid) {
        return new Response(JSON.stringify({ ok: false, error: 'Bot verification failed. Please try again.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 5b. Anonymous survey limits (per-IP; the email limiter can't apply)
    if (KV && isFeedback) {
      const ip = clientAddress || request.headers.get('cf-connecting-ip') || '0.0.0.0';
      const salt = runtime.FEEDBACK_SALT || TURNSTILE_SECRET || 'designjobs';
      const { allowed, reason } = await checkFeedbackLimits(KV, ip, body.company, salt);
      if (!allowed) {
        return new Response(JSON.stringify({ ok: false, error: reason }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 6. Rate limiting (server-side via KV, job submissions only)
    if (KV && !isBugReport && !isFeedback) {
      const { allowed, count } = await checkRateLimit(KV, body.submitterEmail);
      if (!allowed) {
        return new Response(JSON.stringify({
          ok: false,
          error: `Rate limit exceeded. You've submitted ${count} jobs in the last 24 hours (max ${MAX_SUBMISSIONS_PER_DAY}).`,
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 7. Create GitHub issue
    if (GITHUB_TOKEN) {
      let issueTitle: string;
      let issueBody: string;
      let labels: string[];

      if (isProcess) {
        // Structured interview-process report — no free text by design.
        const roundTypes = (body.roundTypes || '').toString().trim();
        const fields: Array<[string, string]> = [
          ['Job', body.jobTitle || 'Unknown role'],
          ['Company', body.company],
          ['Job ID', body.jobId || 'n/a'],
          ['Rounds', body.rounds || 'not reported'],
          ['Round types', roundTypes || 'not reported'],
          ['Timeline', body.timeline || 'not reported'],
          ['Take-home', body.hasAssessment || 'not reported'],
          ['Assessment type', body.assessmentType || 'n/a'],
          ['Heard back after interviewing', body.gotFeedback || 'not reported'],
          ['Reported by', ({ 'interviewed': 'Someone who interviewed here', 'work-here': 'Someone who works here', 'secondhand': 'Secondhand' } as Record<string, string>)[body.relationship] || 'Not stated'],
          ...(body.contactName?.trim() ? [['Recruiter contact', `${body.contactName.trim()}${body.contactUrl?.trim() ? ` — ${body.contactUrl.trim()}` : ''}`] as [string, string]] : []),
          ...(body.notes?.trim() ? [['Notes', body.notes.trim().slice(0, 500)] as [string, string]] : []),
        ];
        const answered = ['rounds', 'roundTypes', 'timeline', 'hasAssessment', 'gotFeedback', 'stage', 'compDisclosure', 'overallRating', 'wouldRecommend', 'notes', 'contactName']
          .some(k => (body[k] || '').toString().trim());
        if (!answered) {
          return new Response(JSON.stringify({ ok: false, error: 'Please fill in at least one field.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        issueTitle = `Process report: ${body.company}${body.jobTitle ? ` — ${body.jobTitle}` : ''}`;
        issueBody = [
          ...fields.map(([k, v]) => `**${k}:** ${v}`),
          '',
          '```json',
          JSON.stringify({
            jobId: body.jobId || null,
            company: body.company,
            ...(body.stage ? { stage: body.stage } : {}),
            interviewProcess: {
              ...(body.rounds ? { rounds: parseInt(body.rounds, 10) || body.rounds } : {}),
              ...(roundTypes ? { roundTypes: roundTypes.split(',').map(s => s.trim()).filter(Boolean) } : {}),
              ...(body.timeline ? { timeline: body.timeline } : {}),
              ...(body.hasAssessment ? { hasAssessment: body.hasAssessment === 'yes' } : {}),
              ...(body.assessmentType ? { assessmentType: body.assessmentType } : {}),
              ...(body.takeHomeHours ? { takeHomeHours: parseFloat(body.takeHomeHours) || null } : {}),
              ...(body.gotFeedback ? { gotFeedback: body.gotFeedback === 'yes' } : {}),
              ...(body.compDisclosure && body.compDisclosure !== '' ? { compDisclosure: body.compDisclosure } : {}),
              ...(body.overallRating ? { overallRating: parseInt(body.overallRating, 10) } : {}),
              ...(body.wouldRecommend ? { wouldRecommend: body.wouldRecommend === 'yes' ? true : body.wouldRecommend === 'no' ? false : null } : {}),
              source: 'community report',
            },
          }, null, 2),
          '```',
          '',
          '---',
          '_Community process report via designjobs.cv — review before merging into jobs.json_',
        ].join('\n');
        labels = ['community-data', 'interview-process'];
      } else if (isFeedback) {
        // Full candidate experience report from /feedback form.
        // These are processed by scripts/process-feedback.mjs into job-feedback.json.
        const roundTypesRaw = (body.roundTypes || '').toString().trim();
        issueTitle = `Candidate experience: ${body.company}${body.jobTitle ? ` — ${body.jobTitle}` : ''}`;
        const report: Record<string, unknown> = {
          stage: body.stage,
          ...(body.rounds ? { rounds: parseInt(body.rounds, 10) || null } : {}),
          ...(roundTypesRaw ? { roundTypes: roundTypesRaw.split(',').map((s: string) => s.trim()).filter(Boolean) } : {}),
          ...(body.timeline ? { timeline: body.timeline } : {}),
          // Must exclude '' too: the applied-only path never asks about a
          // take-home, and an unanswered field was being recorded as a
          // definite "no" — which handed companies free credit on the
          // respect-for-time score.
          ...(body.hasAssessment !== undefined && body.hasAssessment !== '' ? { hasAssessment: body.hasAssessment === 'yes' || body.hasAssessment === true } : {}),
          ...(body.assessmentType ? { assessmentType: body.assessmentType } : {}),
          ...(body.takeHomeHours ? { takeHomeHours: parseFloat(body.takeHomeHours) || null } : {}),
          ...(body.gotFeedback !== undefined && body.gotFeedback !== '' ? { gotFeedback: body.gotFeedback === 'yes' || body.gotFeedback === true } : {}),
          ...(body.rejectionReason !== undefined && body.rejectionReason !== '' ? { rejectionReason: body.rejectionReason === 'yes' || body.rejectionReason === true } : {}),
          ...(body.compDisclosure && body.compDisclosure !== 'na' ? { compDisclosure: body.compDisclosure } : {}),
          ...(body.interviewerPrep ? { interviewerPrep: parseInt(body.interviewerPrep, 10) } : {}),
          ...(body.processRelevance ? { processRelevance: parseInt(body.processRelevance, 10) } : {}),
          ...(body.overallRating ? { overallRating: parseInt(body.overallRating, 10) } : {}),
          ...(body.wouldRecommend !== undefined && body.wouldRecommend !== '' ? { wouldRecommend: body.wouldRecommend === 'yes' ? true : body.wouldRecommend === 'no' ? false : null } : {}),
          ...(body.timelineMatch !== undefined && body.timelineMatch !== '' && body.timelineMatch !== 'na' ? { timelineMatch: body.timelineMatch === 'yes' || body.timelineMatch === true } : {}),
          ...(body.applicationSource ? { applicationSource: body.applicationSource } : {}),
          ...(body.didOutreach ? { didOutreach: body.didOutreach === 'yes' } : {}),
          ...(body.appliedAgo ? { appliedAgo: body.appliedAgo } : {}),
          ...(body.withdrewReason ? { withdrewReason: body.withdrewReason } : {}),
          ...(body.notes?.trim() ? { notes: body.notes.trim().slice(0, 500) } : {}),
          submittedAt: new Date().toISOString().split('T')[0],
        };
        const summaryFields: [string, string][] = [
          ['Company', body.company],
          ...(body.jobTitle ? [['Role', body.jobTitle] as [string, string]] : []),
          ...(body.jobId ? [['Job ID', body.jobId] as [string, string]] : []),
          ['Stage', body.stage],
          ...(body.overallRating ? [['Overall rating', `${body.overallRating}/5`] as [string, string]] : []),
          ...(body.wouldRecommend ? [['Would recommend', body.wouldRecommend] as [string, string]] : []),
        ];
        // Anonymous, non-reversible submitter tag: lets the processor detect
        // one person flooding a company without ever storing an IP.
        const fbIp = clientAddress || request.headers.get('cf-connecting-ip') || '0.0.0.0';
        const submitter = await fingerprint(fbIp, runtime.FEEDBACK_SALT || TURNSTILE_SECRET || 'designjobs');
        issueBody = [
          ...summaryFields.map(([k, v]) => `**${k}:** ${v}`),
          '',
          '```json',
          JSON.stringify({
            type: 'interview-feedback',
            jobId: body.jobId || null,
            company: body.company,
            jobTitle: body.jobTitle || null,
            submitter,
            report,
          }, null, 2),
          '```',
          '',
          '---',
          '_Candidate experience report via designjobs.cv/feedback — review before processing into job-feedback.json_',
        ].join('\n');
        labels = ['community-data', 'interview-feedback'];
      } else if (isBugReport) {
        const issueTypeLabels: Record<string, string> = {
          'dead-link': 'dead-link',
          'wrong-info': 'wrong-info',
          'spam': 'spam-report',
          'site-bug': 'site-bug',
          'other': 'other',
        };
        issueTitle = body.title ? `Feedback: ${body.title}` : `Feedback: ${body.issueType}${body.pageUrl ? ' — ' + body.pageUrl : ''}`;
        issueBody = [
          `**Issue Type:** ${body.issueType}`,
          `**Page URL:** ${body.pageUrl}`,
          `**Description:** ${body.description}`,
          '',
          '---',
          body.reporterName ? `**Reported by:** ${body.reporterName}${body.reporterEmail ? ` (${body.reporterEmail})` : ''}` : '**Reported by:** Anonymous',
          '_Reported via designjobs.cv/report_',
        ].join('\n');
        labels = ['bug-report', issueTypeLabels[body.issueType] || 'other'];
      } else {
        // Minimal submission: URL + title + insider info. Everything else
        // (company, level, location, comp, description) is scraped from the
        // posting by the review pipeline.
        const relationshipLabels: Record<string, string> = {
          'work-here': 'Works at this company',
          'know-team': 'Knows the hiring team',
          'found-it': 'Found it posted',
        };
        const urgencyLabels: Record<string, string> = {
          'asap': 'Actively interviewing — ASAP',
          'within-month': 'Within the next month',
          'few-months': 'Next few months',
          'evergreen': 'Evergreen — always open',
        };
        const roundTypes = (body.roundTypes || '').toString().trim();
        const hasProcess = !!(body.rounds || roundTypes || body.timeline || body.assessmentType);

        const urlHost = (() => {
          try { return new URL(body.url).hostname.replace('www.', ''); }
          catch { return body.url; }
        })();
        issueTitle = `Add: ${body.title || `job at ${urlHost}`}`;
        issueBody = [
          ...(body.title ? [`**Job Title:** ${body.title}`] : []),
          `**Job URL:** ${body.url}`,
          `**Tags:** ${body.tags || 'N/A'}`,
          `**Relationship:** ${relationshipLabels[body.relationship] || 'Not stated'}`,
          `**Hiring urgency:** ${urgencyLabels[body.urgency] || 'Not stated'}`,
          `**Contact:** ${body.contactName || 'n/a'}${body.contactUrl ? ` — ${body.contactUrl}` : ''}`,
          ...(hasProcess ? [
            `**Process rounds:** ${body.rounds || 'not reported'}`,
            `**Process round types:** ${roundTypes || 'not reported'}`,
            `**Process timeline:** ${body.timeline || 'not reported'}`,
            `**Process take-home:** ${body.assessmentType || 'not reported'}`,
          ] : []),
          '',
          '```json',
          JSON.stringify({
            ...(body.title ? { title: body.title } : {}),
            url: body.url,
            tags: (body.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean),
            _needsEnrichment: true,
            ...(body.urgency ? { hiringUrgency: body.urgency } : {}),
            ...(body.relationship ? { submitterRelationship: body.relationship } : {}),
            ...(body.contactName ? { contact: { name: body.contactName, url: body.contactUrl || null } } : {}),
            ...(hasProcess ? {
              interviewProcess: {
                ...(body.rounds ? { rounds: parseInt(body.rounds, 10) || body.rounds } : {}),
                ...(roundTypes ? { roundTypes: roundTypes.split(',').map((s: string) => s.trim()).filter(Boolean) } : {}),
                ...(body.timeline ? { timeline: body.timeline } : {}),
                ...(body.assessmentType ? {
                  hasAssessment: body.assessmentType !== 'none',
                  ...(body.assessmentType !== 'none' ? { assessmentType: body.assessmentType } : {}),
                } : {}),
                source: body.relationship === 'work-here' ? 'recruiter' : 'community report',
              },
            } : {}),
          }, null, 2),
          '```',
          '',
          '---',
          `**Submitted by:** ${body.submitterName} (${body.submitterEmail})`,
          '_Submitted via designjobs.cv — scrape the Job URL for company, level, location, comp, and description._',
        ].join('\n');
        labels = ['job-submission'];
      }

      const result = await createGitHubIssue(GITHUB_TOKEN, GITHUB_REPO, issueTitle, issueBody, labels);
      if (!result.ok) {
        console.error('GitHub issue creation failed:', result.status, result.error);
        // Surface only GitHub's status code — enough to tell a dead token
        // (401) from a permissions gap (403) or a bad label (422) without
        // leaking anything sensitive to the caller.
        return new Response(JSON.stringify({
          ok: false,
          error: 'Failed to create submission. Please try again later.',
          code: result.status ?? 0,
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Record successful submission for rate limiting (job submissions only)
      if (KV && !isBugReport && !isFeedback) {
        await incrementRateLimit(KV, body.submitterEmail);
      }
      if (KV && isFeedback) {
        const ip = clientAddress || request.headers.get('cf-connecting-ip') || '0.0.0.0';
        await recordFeedback(KV, ip, body.company, runtime.FEEDBACK_SALT || TURNSTILE_SECRET || 'designjobs');
      }

      return new Response(JSON.stringify({ ok: true, issueUrl: result.url }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fallback: no GitHub token configured, just acknowledge
    return new Response(JSON.stringify({ ok: true, fallback: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Submit error:', err);
    return new Response(JSON.stringify({ ok: false, error: 'An unexpected error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
