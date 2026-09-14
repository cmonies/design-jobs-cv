import type { APIContext } from 'astro';
import jobs from '../data/jobs.json';

export function GET(_context: APIContext) {
  const publicJobs = jobs.map(({ _verifiedAt: _v, _sourceUrl: _s, _verificationNote: _n, ...rest }) => rest);
  return new Response(JSON.stringify(publicJobs, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
