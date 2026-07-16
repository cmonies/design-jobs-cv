# designjobs.cv

Design jobs with real links, by the community. Open source and free forever.

🌐 **[designjobs.cv](https://designjobs.cv/jobs)**

## What is this?

A free, open-source job board for **designers** — product design, UX, research, content design, design engineering — at startups across healthcare, AI, fintech, climate, consumer, and more, with special attention to **contract roles**. No recruiter spam, no paid listings, no LinkedIn link rot — every listing points at the company's own ATS and is re-verified continuously.

## Features

- 🔗 **Real links only** — every job links to the company's own ATS/careers page and is audited for dead links
- 🕐 **Freshness signals** — posted dates, stale-listing warnings, dead jobs removed automatically
- 🧭 **Know before you apply** — community-reported interview processes (rounds, timeline, take-home, ghosting) in structured form, not free-text reviews
- 👋 **Who to contact** — a likely recruiter or hiring contact per job, sourced from public profiles
- 🌍 **Community-sourced** — anyone can submit a job or share process details
- 🔓 **Open source** — built in the open, maintained by the community
- 🛡️ **Spam-protected** — Cloudflare Turnstile, server-side rate limiting, honeypot fields, manual review queue
- ⚡ **Fast** — static site with server endpoints, loads instantly
- ♿ **Accessible** — semantic HTML, proper contrast, keyboard navigable
- 🌙 **Dark mode** — automatic based on system preference, with manual toggle

## Tech Stack

- [Astro](https://astro.build) 5 — static site framework with server endpoints
- [Tailwind CSS](https://tailwindcss.com) — utility-first styling
- [Vercel](https://vercel.com) — hosting
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) — bot protection
- Jobs stored as JSON (`src/data/jobs.json`), enriched by scraper scripts

## Getting Started

```bash
# Clone the repo
git clone https://github.com/cmonies/healthcare-jobs.git
cd healthcare-jobs

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:4321](http://localhost:4321) to see the site.

## Project Structure

```
src/
├── components/         # Reusable UI components
│   ├── Header.astro
│   ├── Footer.astro
│   ├── JobCard.astro
│   ├── ProcessModal.astro   # structured interview-process reports
│   └── DarkModeToggle.astro
├── data/
│   ├── jobs.json            # job listings (source of truth)
│   ├── job-details.json     # scraped descriptions (generated)
│   └── job-contacts.json    # hiring contacts (generated)
├── layouts/
│   └── Layout.astro
├── pages/
│   ├── index.astro          # homepage
│   ├── jobs.astro           # all jobs with search + filters
│   ├── jobs/[id].astro      # job detail pages
│   ├── submit.astro         # job submission form
│   ├── report.astro         # feedback form
│   └── api/submit.ts        # server-side submission endpoint
scripts/
├── validate-jobs.js             # link validator (publish gate)
├── scrape-job-details.mjs       # descriptions via ATS APIs
├── scrape-yc-contacts.mjs       # founder contacts from YC pages
└── scrape-linkedin-contacts.mjs # recruiter contacts via LinkedIn search
docs/
└── job-vetting-criteria.md      # what gets listed and why
```

## Adding a Job

The easiest way: use the **Submit a Job** button on the website. Submissions are reviewed before publishing.

You can also submit a PR — add your job to `src/data/jobs.json` following the schema in [CONTRIBUTING.md](CONTRIBUTING.md).

**Levels:** Entry, Junior, Mid, Senior, Staff, Lead, Principal, Director
**Location types:** Remote, Hybrid, On-site
**Employment types:** Full-time, Contract, Freelance

## Environment Variables

For the submission API to work, set these in your hosting provider:

| Variable | Description |
|----------|-------------|
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key |
| `GITHUB_TOKEN` | GitHub fine-grained token (Issues read/write) |
| `GITHUB_REPO` | Repository for issue creation (e.g. `cmonies/healthcare-jobs`) |

## License

[AGPL-3.0](LICENSE) — you can use, modify, and contribute freely. If you deploy a modified version, you must open source your changes too.

---

Made with care by [carmen.cv](https://carmen.cv) for the design community 💙
