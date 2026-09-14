-- Accounts: saved jobs and application tracking, per user.
-- Auth itself is Supabase Auth (magic link). These tables reference
-- auth.users and are readable/writable only by their owner. job_id is the
-- jobs.json id; no FK so a save never fails because the sync hasn't run yet.

create table public.saved_jobs (
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, job_id)
);

create table public.applications (
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      text not null,
  status      text not null default 'applied'
              check (status in ('applied', 'interviewing', 'offer', 'rejected', 'withdrawn')),
  applied_on  date not null default current_date,
  updated_at  timestamptz not null default now(),
  primary key (user_id, job_id)
);

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

alter table public.saved_jobs   enable row level security;
alter table public.applications enable row level security;

revoke all on public.saved_jobs, public.applications from anon, authenticated;
grant select, insert, update, delete on public.saved_jobs, public.applications to authenticated;

create policy "own saved jobs"
  on public.saved_jobs for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own applications"
  on public.applications for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
