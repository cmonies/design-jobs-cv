-- designjobs.cv — initial schema
--
-- Companies are the durable anchor. Jobs come and go; candidate-experience
-- reports stay attached to the company. Jobs mirror src/data/jobs.json (the
-- scrapers' source of truth, synced by scripts/sync-supabase.mjs) and are
-- never deleted — only marked dead — so a report filed against a job keeps
-- its context after the posting closes.
--
-- Security model (this repo is public, so the schema is too):
--   * Row Level Security is on for every table.
--   * anon/authenticated may only SELECT companies and jobs. The reports and
--     rate_limits tables grant them nothing at all.
--   * Every write goes through src/pages/api/submit.ts using the secret key
--     (server-only, never committed) after Turnstile, validation and abuse
--     checks.
--   * Public reads of reports go through the `public_reports` view, which
--     hides submitter_hash, held_reason, unpublished rows, and any notes
--     that a maintainer hasn't approved yet.

create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (char_length(name) between 1 and 120),
  url         text,
  vertical    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create table public.jobs (
  id               text primary key,                    -- jobs.json id, used in /jobs/{id}
  company_id       uuid not null references public.companies(id) on delete restrict,
  title            text not null,
  url              text not null,
  level            text,
  location_type    text,
  location         text,
  employment_type  text,
  vertical         text,
  salary           text,
  tags             text[] not null default '{}',
  posted_at        date,
  status           text not null default 'active' check (status in ('active', 'dead')),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  removed_at       timestamptz
);

create index jobs_company_id_idx on public.jobs (company_id, status);

create table public.reports (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete restrict,
  job_id              text references public.jobs(id) on delete set null,
  job_title           text,                              -- as reported; survives job_id going null
  submitter_hash      text,                              -- salted, truncated SHA-256 of the IP; never exposed
  stage               text not null check (stage in ('applied', 'phone-screen', 'interviews', 'offer', 'rejected', 'withdrew')),
  rounds              smallint check (rounds between 1 and 20),
  round_types         text[],
  timeline            text check (timeline in ('under 1 week', '1-2 weeks', '2-4 weeks', '4-6 weeks', '6+ weeks')),
  has_assessment      boolean,
  assessment_type     text check (assessment_type in ('paid take-home', 'unpaid take-home', 'timed exercise', 'none')),
  take_home_hours     numeric(5, 1) check (take_home_hours > 0 and take_home_hours <= 100),
  got_feedback        boolean,
  rejection_reason    boolean,
  comp_disclosure     text check (comp_disclosure in ('upfront', 'mid-process', 'at-offer', 'never')),
  interviewer_prep    smallint check (interviewer_prep between 1 and 5),
  process_relevance   smallint check (process_relevance between 1 and 5),
  overall_rating      smallint check (overall_rating between 1 and 5),
  would_recommend     boolean,
  timeline_match      boolean,
  application_source  text check (application_source in ('direct', 'referral', 'recruiter-outreach', 'cold-outreach')),
  did_outreach        boolean,
  applied_ago         text check (applied_ago in ('this week', '1-2 weeks ago', '3+ weeks ago')),
  withdrew_reason     text check (withdrew_reason in ('other-offer', 'too-slow', 'compensation', 'red-flags', 'other')),
  notes               text check (char_length(notes) <= 280),
  -- Structured fields publish immediately; free text waits for a human.
  notes_status        text not null default 'pending' check (notes_status in ('pending', 'approved', 'rejected')),
  status              text not null default 'published' check (status in ('published', 'held', 'removed')),
  held_reason         text,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz
);

create index reports_company_id_idx on public.reports (company_id, status, created_at desc);
create index reports_job_id_idx on public.reports (job_id);

-- Server-side rate limiting (replaces the Cloudflare KV code that never ran
-- on Vercel). Keys are salted hashes, never raw IPs or emails.
create table public.rate_limits (
  key         text primary key,
  count       integer not null default 0,
  expires_at  timestamptz not null
);

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table public.companies   enable row level security;
alter table public.jobs        enable row level security;
alter table public.reports     enable row level security;
alter table public.rate_limits enable row level security;

-- Supabase grants anon/authenticated broad default privileges on new tables.
-- Take them all back, then hand out exactly what the public may do.
revoke all on public.companies, public.jobs, public.reports, public.rate_limits from anon, authenticated;
revoke all on function public.set_updated_at() from anon, authenticated;

grant select on public.companies, public.jobs to anon, authenticated;

create policy "companies are public"
  on public.companies for select to anon, authenticated using (true);

create policy "jobs are public"
  on public.jobs for select to anon, authenticated using (true);

-- reports and rate_limits: no policies, no grants. Only the secret key
-- (which bypasses RLS) can read or write them.

-- ── Public view of reports ─────────────────────────────────────────────────
-- Runs as its owner (postgres), so it can read the RLS-locked base table and
-- expose only the safe columns of published rows.
create view public.public_reports with (security_invoker = off) as
  select
    id, company_id, job_id, job_title, stage, rounds, round_types, timeline,
    has_assessment, assessment_type, take_home_hours, got_feedback,
    rejection_reason, comp_disclosure, interviewer_prep, process_relevance,
    overall_rating, would_recommend, timeline_match, application_source,
    did_outreach, applied_ago, withdrew_reason,
    case when notes_status = 'approved' then notes end as notes,
    created_at
  from public.reports
  where status = 'published';

grant select on public.public_reports to anon, authenticated;
