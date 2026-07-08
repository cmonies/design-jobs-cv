import type { APIContext } from 'astro';
import jobs from '../data/jobs.json';

export function GET(context: APIContext) {
  const site = context.site || new URL('https://designjobs.cv');

  // Use most recent job's posted date as lastmod for dynamic pages
  const latestDate = jobs.length > 0
    ? jobs.reduce((latest, job) => (job.postedAt || job.postedDate) > latest ? (job.postedAt || job.postedDate) : latest, (jobs[0].postedAt || jobs[0].postedDate))
    : new Date().toISOString().split('T')[0];

  const pages = [
    { path: '', changefreq: 'daily', priority: '1.0', lastmod: latestDate },
    { path: '/jobs', changefreq: 'daily', priority: '0.9', lastmod: latestDate },
    { path: '/submit', changefreq: 'monthly', priority: '0.5', lastmod: '2026-02-14' },
    { path: '/report', changefreq: 'monthly', priority: '0.3', lastmod: '2026-02-14' },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${new URL(p.path, site).href}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
