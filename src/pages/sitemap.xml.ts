import type { APIContext } from 'astro';
import jobs from '../data/jobs.json';
import { slugify } from '../lib/slug.js';

export function GET(context: APIContext) {
  const site = context.site || new URL('https://designjobs.cv');

  const latestDate = jobs.length > 0
    ? jobs.reduce((latest, job) => {
        const d = job.postedAt || job.postedDate;
        return d && d > latest ? d : latest;
      }, jobs[0].postedAt || jobs[0].postedDate || '')
    : new Date().toISOString().split('T')[0];

  const staticPages = [
    { path: '',        changefreq: 'daily',   priority: '1.0', lastmod: latestDate },
    { path: '/jobs',   changefreq: 'daily',   priority: '0.9', lastmod: latestDate },
    { path: '/submit', changefreq: 'monthly', priority: '0.5', lastmod: '2026-02-14' },
    { path: '/report', changefreq: 'monthly', priority: '0.3', lastmod: '2026-02-14' },
  ];

  const jobPages = jobs
    .filter(j => j.id)
    .map(j => ({
      path: `/jobs/${j.id}`,
      changefreq: 'weekly',
      priority: '0.7',
      lastmod: j.postedAt || j.postedDate || latestDate,
    }));

  const companyPages = [...new Set(jobs.map(j => slugify(j.company)))].map(slug => ({
    path: `/companies/${slug}`,
    changefreq: 'weekly',
    priority: '0.6',
    lastmod: latestDate,
  }));

  const pages = [...staticPages, ...jobPages, ...companyPages];

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
