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

async function createGitHubIssue(
  token: string,
  repo: string,
  title: string,
  body: string,
  labels: string[] = ['job-submission']
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'health.designjobs.cv',
    },
    body: JSON.stringify({
      title,
      body,
      labels,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: err };
  }

  const data = await res.json() as { html_url: string };
  return { ok: true, url: data.html_url };
}

export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const runtime = (locals as any).runtime?.env || {};
  const KV = runtime.SUBMISSIONS_KV as KVNamespace | undefined;
  const TURNSTILE_SECRET = runtime.TURNSTILE_SECRET_KEY || import.meta.env.TURNSTILE_SECRET_KEY || '';
  const GITHUB_TOKEN = runtime.GITHUB_TOKEN || import.meta.env.GITHUB_TOKEN || '';
  const GITHUB_REPO = runtime.GITHUB_REPO || import.meta.env.GITHUB_REPO || 'cmonies/healthcare-jobs';

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

    // 2. Required fields validation
    const required = isBugReport
      ? ['issueType', 'description']
      : ['submitterName', 'submitterEmail', 'title', 'company', 'companyUrl', 'url', 'level', 'locationType', 'location'];
    for (const field of required) {
      if (!body[field]?.trim()) {
        return new Response(JSON.stringify({ ok: false, error: `Missing required field: ${field}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 3. Email format validation (only required for job submissions)
    if (!isBugReport) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(body.submitterEmail)) {
        return new Response(JSON.stringify({ ok: false, error: 'Invalid email address' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 4. URL validation (skip empty optional fields)
    const urlFields = isBugReport ? ['pageUrl'] : ['companyUrl', 'url'];
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
    if (TURNSTILE_SECRET && body.turnstileToken) {
      const ip = clientAddress || request.headers.get('cf-connecting-ip') || '0.0.0.0';
      const valid = await verifyTurnstile(body.turnstileToken, TURNSTILE_SECRET, ip);
      if (!valid) {
        return new Response(JSON.stringify({ ok: false, error: 'Bot verification failed. Please try again.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 6. Rate limiting (server-side via KV, job submissions only)
    if (KV && !isBugReport) {
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

      if (isBugReport) {
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
          '_Reported via health.designjobs.cv/report_',
        ].join('\n');
        labels = ['bug-report', issueTypeLabels[body.issueType] || 'other'];
      } else {
        issueTitle = `Add: ${body.title} at ${body.company}`;
        issueBody = [
          `**Job Title:** ${body.title}`,
          `**Company:** ${body.company}`,
          `**Company URL:** ${body.companyUrl}`,
          `**Job URL:** ${body.url}`,
          `**Level:** ${body.level}`,
          `**Location Type:** ${body.locationType}`,
          `**Employment Type:** ${body.employmentType || 'Full-time'}`,
          `**Vertical:** ${body.vertical || 'Other'}`,
          `**Location:** ${body.location}`,
          `**Tags:** ${body.tags || 'N/A'}`,
          '',
          '---',
          `**Submitted by:** ${body.submitterName} (${body.submitterEmail})`,
          '_Submitted via designjobs.cv_',
        ].join('\n');
        labels = ['job-submission'];
      }

      const result = await createGitHubIssue(GITHUB_TOKEN, GITHUB_REPO, issueTitle, issueBody, labels);
      if (!result.ok) {
        console.error('GitHub issue creation failed:', result.error);
        return new Response(JSON.stringify({ ok: false, error: 'Failed to create submission. Please try again later.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Record successful submission for rate limiting (job submissions only)
      if (KV && !isBugReport) {
        await incrementRateLimit(KV, body.submitterEmail);
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
