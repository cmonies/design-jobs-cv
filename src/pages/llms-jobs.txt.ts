import type { APIContext } from 'astro';
import jobs from '../data/jobs.json';

export function GET(_context: APIContext) {
  const lines: string[] = [
    '# designjobs.cv — Full Machine-Readable Job Listing',
    '# Community-sourced design jobs board: verified listings, real ATS links',
    `# ${jobs.length} verified roles | https://designjobs.cv`,
    '# Format: structured text for LLM agents and crawlers',
    '',
    '## About',
    'designjobs.cv covers product design, UX design, UX research, design engineering,',
    'and design leadership roles at startups across healthcare, AI, fintech, climate,',
    'consumer, enterprise/SaaS, trades tech, gov/civic, and education verticals.',
    'Every listing is browser-verified against the company\'s official ATS before publication.',
    '',
    '## Endpoints',
    '- JSON API: https://designjobs.cv/jobs.json',
    '- Sitemap: https://designjobs.cv/sitemap.xml',
    '- RSS: https://designjobs.cv/rss.xml',
    '',
    `## Job Listings (${jobs.length} total)`,
    '',
  ];

  for (const job of jobs) {
    const locationStr = job.locationType === 'Remote'
      ? 'Remote'
      : job.location ? `${job.locationType} — ${job.location}` : job.locationType;

    lines.push(`### ${job.title} at ${job.company}`);
    if (job.id) lines.push(`- Listing: https://designjobs.cv/jobs/${job.id}`);
    lines.push(`- Level: ${job.level}`);
    lines.push(`- Type: ${job.employmentType || 'Full-time'}`);
    lines.push(`- Location: ${locationStr}`);
    if (job.vertical) lines.push(`- Vertical: ${job.vertical}`);
    if (job.tags?.length) lines.push(`- Tags: ${job.tags.join(', ')}`);
    if (job.postedAt) lines.push(`- Posted: ${job.postedAt}`);
    if ((job as Record<string, unknown>).salary) lines.push(`- Salary: ${(job as Record<string, unknown>).salary}`);
    lines.push(`- Apply: ${job.url}`);
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
