import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import jobs from '../data/jobs.json';

export function GET(context: APIContext) {
  return rss({
    title: 'designjobs.cv — Design Jobs',
    description: 'Verified design roles at startups — full-time and contract, curated by the community.',
    site: context.site || 'https://designjobs.cv',
    items: jobs.map(job => ({
      title: `${job.title} at ${job.company}`,
      link: job.url,
      ...(job.postedAt || job.postedDate ? { pubDate: new Date(job.postedAt || job.postedDate) } : {}),
      description: `${job.level} · ${job.employmentType || 'Full-time'} · ${job.locationType}${job.location !== 'USA' ? ` · ${job.location}` : ''} — ${job.tags.join(', ')}`,
    })),
  });
}
