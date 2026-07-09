# designjobs.cv — Scraping & Vetting Criteria

Successor to `~/.openclaw/workspace/designwithcare-job-vetting-criteria.md`. The board
is no longer healthcare-only: it covers **design roles at startups across verticals**,
with special emphasis on **contract/freelance work** and **non-traditional verticals**.

## Scope — what belongs on the board

**Roles:** product design, UX design, UX research, design engineering, brand/visual
design at product companies, design leadership. No pure marketing/graphic-production
roles at agencies.

**Verticals** (use these exact values in the `vertical` field):
`Healthcare`, `AI`, `Fintech`, `Climate`, `Consumer`, `Enterprise/SaaS`,
`Trades`, `Gov/Civic`, `Education`, `Other`

Priority targets:
1. **Contract / freelance / contract-to-hire roles** — anywhere, any vertical. These are
   rare on ATS boards and most valuable to our audience.
2. **AI-native startups** hiring designers (AI vertical)
3. **Non-traditional verticals** — companies doing design work where tech isn't the
   default career path: logistics, agriculture, construction, manufacturing, legal,
   maritime, energy, defense-adjacent civic tech. **Trades tech** (software for
   electricians, plumbers, HVAC, home services, construction — ServiceTitan, Jobber,
   Housecall Pro, Procore, BuildOps and their peers) gets the `Trades` vertical.
4. **Healthcare** — keep sourcing; it's our deepest vertical and existing audience.

**Employment type** (use these exact values in `employmentType`):
`Full-time`, `Contract`, `Freelance`. Contract-to-hire counts as `Contract`.

## Sourcing

Prefer **direct ATS links** (company career pages, Greenhouse, Lever, Ashby, Workday)
over aggregators. Aggregator links go stale faster.

### Preferred URL patterns (most reliable)
- `boards.greenhouse.io/{company}/jobs/{id}`
- `jobs.lever.co/{company}/{uuid}`
- `jobs.ashbyhq.com/{company}/jobs/{id}`
- `{company}.wd5.myworkdayjobs.com/...`
- `careers.{company}.com/jobs/...`

### LinkedIn — DISCOVERY ONLY
LinkedIn may be used to **discover** that a company is hiring (company + role title +
location), via the logged-in CDP browser (`python3 ~/clippy-bot/browse.py <url>`).
But:
- **NEVER store a `linkedin.com` URL** in `url` or any published field
- After discovering a lead, find the company's own ATS/careers posting via web search
  and verify it — that URL is what gets published
- **Skip "Easy Apply" jobs** — they have no external posting to link to
- If no ATS/careers posting can be found and verified, drop the lead

### Avoid
- BuiltIn (builtin.com, builtinnyc.com) — listings removed without redirect
- LinkedIn job posts as published URLs — see above
- Indeed — redirects frequently break
- Wellfound — blocked for browser scraping, skip entirely

## Validation (REQUIRED before staging)

### Step 1: HTTP check
- Fetch the URL. Must return 200.
- 404, 410, or connection failure = dead, skip it.

### Step 2: Page content check
Fetch the page body and search (case-insensitive) for these dead-link signals:

```
this job was removed
this job has been closed
this position has been filled
no longer accepting applications
this job is no longer available
this listing has expired
job not found
page not found
position is no longer open
this role has been filled
job has expired
no longer active
posting has been removed
this opportunity is closed
application deadline has passed
we are no longer hiring
sorry, this job was removed
```

If ANY of these appear → skip the job.

### Step 3: Freshness check
- Job posting should be less than 30 days old if a date is visible
- If no date visible, verify the role still appears on the company's careers page

## Data Schema

Each staged job in `jobs-staging.json` — ALL of these fields are required
(missing any = do not stage it):

```json
{
  "id": "acme-senior-product-designer",
  "title": "Senior Product Designer",
  "company": "Acme",
  "companyUrl": "https://acme.com",
  "url": "https://jobs.ashbyhq.com/acme/...",
  "level": "Senior",
  "locationType": "Remote",
  "location": "Remote (US)",
  "postedAt": "2026-07-01",
  "vertical": "AI",
  "employmentType": "Contract",
  "tags": ["design systems", "B2B", "0-to-1"],
  "_sourceUrl": "https://... (where the lead was found)"
}
```

- `level`: Entry, Junior, Mid, Senior, Staff, Lead, Principal, Manager, Director.
  **Associate / entry-level / new-grad roles get `Entry`** — actively hunt for these;
  they're underrepresented on the board and valuable to early-career designers.
- `locationType`: `Remote`, `Hybrid`, or `On-site` (with the hyphen)
- `postedAt`: YYYY-MM-DD; extract from the page, else today. The site sorts by it.
- `_verifiedAt` is set by the validator at promotion — never set it manually.

## Golden rules
- NEVER fabricate URLs — only use URLs from actual search results or pages actually
  fetched and confirmed to contain a live listing (2026-02-14: 13 of 18 were fake).
- 3 real verified jobs beat 10 questionable ones.
- Do not modify `jobs.json` directly — stage to `jobs-staging.json`; the validator
  promotes.
