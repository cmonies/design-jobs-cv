# designjobs.cv

Design jobs with real links, by the community. Open source and free forever.

🌐 **[designjobs.cv](https://designjobs.cv/jobs)**

## What is this?

A free, open-source job board for **designers** — product design, UX, research, content design, design engineering — at startups across healthcare, AI, fintech, climate, consumer, and more, with special attention to **contract roles**. No recruiter spam, no paid listings, no LinkedIn link rot — every listing points at the company's own ATS and is re-verified continuously.

## Features

- 🔗 **Real links only** — every job links to the company's own ATS/careers page and is audited for dead links
- 🕐 **Freshness signals** — posted dates, stale-listing warnings, dead jobs removed automatically
- 🧭 **Know before you apply** — community-reported interview processes (rounds, timeline, take-home, ghosting) in structured form, not free-text reviews. Reports publish the moment they're submitted and live on a company page that outlasts the posting
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
- **Crumb** — our design system: colors, typography, components, and motion
  tokens, documented live at [designjobs.cv/design](https://designjobs.cv/design)
- [Vercel](https://vercel.com) — hosting
- [Supabase](https://supabase.com) (Postgres) — companies, jobs, and candidate-experience reports
- [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) — bot protection
- Jobs stored as JSON (`src/data/jobs.json`), enriched by scraper scripts, mirrored into Supabase

## Crumb (design system)

Every surface is built from one vocabulary — white gallery ground, warm ink,
a single amber accent reserved for the bread mark and contract roles, and a
warm-char dark mode. The library at `/design` (`src/pages/design.astro`) is
the reference: per-theme color breakdowns with OKLCH values, the type scale,
buttons, form controls, chips, grade tiles, progress meters, and motion
tokens. Colors are derived in OKLCH and shipped as hex.

**When adding UI:** use the tokens in `tailwind.config.mjs` and the patterns
on `/design` rather than inventing new ones. Never introduce cool grays —
`slate-*` and `gray-*` are both remapped to the warm ramp on purpose.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/cmonies/design-jobs-cv.git
cd design-jobs-cv

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
├── lib/
│   ├── grades.ts            # candidate-experience scoring
│   ├── reports.ts           # report validation, abuse checks, storage
│   ├── supabase.ts          # server-only Supabase client
│   └── slug.js              # company slug (shared with scripts)
├── pages/
│   ├── index.astro          # homepage
│   ├── jobs.astro           # all jobs with search + filters
│   ├── jobs/[id].astro      # job detail pages (static + live reports island)
│   ├── companies/[slug].astro # company pages (server-rendered from Supabase)
│   ├── submit.astro         # job submission form
│   ├── feedback.astro       # candidate experience survey
│   ├── report.astro         # bug/feedback form
│   └── api/submit.ts        # server-side submission endpoint
supabase/
└── migrations/              # schema + Row Level Security (see below)
scripts/
├── sync-supabase.mjs            # mirror jobs.json → Supabase (run after each publish)
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

## Candidate experience data

Interview reports live in Supabase, not in the repo. Companies are the durable
anchor: `jobs` mirror `jobs.json` and are only ever marked dead, never deleted,
and every `report` points at a company (and, when known, the job that was live).
So a report filed against a role stays on the company page after the posting closes.

- Structured fields (stage, rounds, take-home, whether they heard back…) publish
  immediately after automated checks — blocklist, one report per person per company,
  duplicate and burst detection. Anything that trips a check is stored as `held`.
- The free-text `notes` field is stored but hidden until a maintainer sets
  `notes_status = 'approved'` (criteria in `docs/process-report-criteria.md`).
- After publishing new jobs, run `npm run sync` so the DB knows about them.

**Open source + secrets.** The schema and policies are public in
`supabase/migrations`; that's the point. What keeps it safe: Row Level Security on
every table, the public key can only *read* companies, jobs, and a `public_reports`
view that omits submitter hashes, held rows, and unapproved notes. All writes go
through the API route with the secret key, which only ever lives in `.env` (gitignored)
and the host's environment. Copy `.env.example` to get started.

## Environment Variables

Everything is optional locally — without keys the site builds from the JSON data
and forms fall back to GitHub issues. For production, set these in your hosting provider:

| Variable | Description |
|----------|-------------|
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key |
| `GITHUB_TOKEN` | GitHub fine-grained token (Issues read/write) — job submissions and bug reports |
| `GITHUB_REPO` | Repository for issue creation (e.g. `cmonies/design-jobs-cv`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Supabase secret / service-role key — server only, never exposed |
| `FEEDBACK_SALT` | Salt for the anonymous submitter fingerprint (optional) |

## License

[AGPL-3.0](LICENSE) — you can use, modify, and contribute freely. If you deploy a modified version, you must open source your changes too.

---

Made with care by [carmen.cv](https://carmen.cv) for the design community 💙
