-- Job submissions from /submit. Written the moment someone submits, so the
-- record exists even if the GitHub issue (which the review pipeline still
-- reads) fails or is closed. Contains submitter name + email: locked to the
-- secret key like reports — no public read, no public write.

create table public.job_submissions (
  id                 uuid primary key default gen_random_uuid(),
  url                text not null,
  title              text,
  tags               text[] not null default '{}',
  relationship       text check (relationship in ('work-here', 'know-team', 'found-it')),
  urgency            text check (urgency in ('asap', 'within-month', 'few-months', 'evergreen')),
  contact_name       text,
  contact_url        text,
  interview_process  jsonb,
  submitter_name     text not null,
  submitter_email    text not null,
  submitter_hash     text,
  status             text not null default 'pending'
                     check (status in ('pending', 'staged', 'published', 'duplicate', 'rejected')),
  job_id             text references public.jobs(id) on delete set null,
  github_issue_url   text,
  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz
);

create index job_submissions_status_idx on public.job_submissions (status, created_at desc);
create index job_submissions_url_idx on public.job_submissions (url);

alter table public.job_submissions enable row level security;
revoke all on public.job_submissions from anon, authenticated;
