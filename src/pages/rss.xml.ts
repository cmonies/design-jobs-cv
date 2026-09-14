import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import jobs from '../data/jobs.json';

export function GET(context: APIContext) {
  return rss({
    title: 'designjobs.cv — Design Jobs',
    description: 'Verified design roles at startups — full-time and contract, curated by the community. Healthcare, AI, fintech, climate, and more.',
    site: context.site || 'https://designjobs.cv',
    customData: '<language>en-us</language>',
    items: jobs.map(job => {
      const locationStr = job.locationType === 'Remote'
        ? 'Remote'
        : job.location ? `${job.locationType} — ${job.location}` : job.locationType;
      const desc = [
        `${job.level} ${job.title} at ${job.company}.`,
        `${job.employmentType || 'Full-time'}, ${locationStr}.`,
        job.vertical ? `Vertical: ${job.vertical}.` : '',
        job.tags?.length ? `Tags: ${job.tags.join(', ')}.` : '',
      ].filter(Boolean).join(' ');

      return {
        title: `${job.title} at ${job.company}`,
        link: job.id ? `https://designjobs.cv/jobs/${job.id}` : job.url,
        ...(job.postedAt || job.postedDate ? { pubDate: new Date((job.postedAt || job.postedDate) + 'T12:00:00') } : {}),
        description: desc,
        categories: [job.vertical || 'Design', job.employmentType || 'Full-time', job.level].filter(Boolean),
      };
    }),
  });
}
