// Browser-only account client: magic-link sign-in, saved jobs, application
// tracking. Uses the publishable key, so everything it can do is bounded by
// Row Level Security (see supabase/migrations/*_accounts.sql).
//
// Loaded lazily — only when a session exists, a magic link just landed, or
// someone clicks "Sign in" — so anonymous visitors never download it.

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';

const URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const accountsEnabled = !!(URL && KEY);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(URL!, KEY!, {
      // Implicit flow: the magic link carries the session in the URL hash, so
      // it works even when the email is opened in a different browser.
      auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

/** Cheap pre-check so pages can skip loading the client for anonymous visitors. */
export function hasStoredSession(): boolean {
  try {
    return Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  } catch { return false; }
}
export function hasSessionInUrl(): boolean {
  return /access_token=|error_description=/.test(location.hash);
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: Session | null) => void): void {
  supabase().auth.onAuthStateChange((_event, session) => cb(session));
}

export async function signInWithEmail(email: string): Promise<string | null> {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}/saved` },
  });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

// ── Saved jobs ──────────────────────────────────────────────────────────────
// localStorage stays the working copy (the tile bookmark buttons read it);
// when signed in we keep the DB in step with it.
export const BOOKMARK_KEY = 'dj-bookmarks';

export function localSaved(): string[] {
  try { return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]'); } catch { return []; }
}
export function setLocalSaved(ids: string[]): void {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(ids));
  document.dispatchEvent(new CustomEvent('dj-bookmarks-synced'));
}

let remoteSaved = new Set<string>();

/** Merge local ↔ remote once after sign-in. Local-only saves go up; remote-only come down. */
export async function syncSaved(session: Session): Promise<string[]> {
  const db = supabase();
  const { data } = await db.from('saved_jobs').select('job_id').eq('user_id', session.user.id);
  remoteSaved = new Set((data ?? []).map(r => r.job_id as string));
  const local = localSaved();
  const missing = local.filter(id => !remoteSaved.has(id));
  if (missing.length) {
    await db.from('saved_jobs').upsert(missing.map(job_id => ({ user_id: session.user.id, job_id })));
    missing.forEach(id => remoteSaved.add(id));
  }
  const merged = [...new Set([...local, ...remoteSaved])];
  setLocalSaved(merged);
  return merged;
}

/** Push whatever changed in localStorage since the last sync. */
export async function reconcileSaved(session: Session): Promise<void> {
  const db = supabase();
  const local = new Set(localSaved());
  const add = [...local].filter(id => !remoteSaved.has(id));
  const remove = [...remoteSaved].filter(id => !local.has(id));
  if (add.length) {
    await db.from('saved_jobs').upsert(add.map(job_id => ({ user_id: session.user.id, job_id })));
    add.forEach(id => remoteSaved.add(id));
  }
  if (remove.length) {
    await db.from('saved_jobs').delete().eq('user_id', session.user.id).in('job_id', remove);
    remove.forEach(id => remoteSaved.delete(id));
  }
}

// ── Applications ────────────────────────────────────────────────────────────
export type AppStatus = 'applied' | 'interviewing' | 'offer' | 'rejected' | 'withdrawn';
export const APP_STATUS_LABEL: Record<AppStatus, string> = {
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrew',
};

export interface ApplicationRow { job_id: string; status: AppStatus; applied_on: string; updated_at: string }

export async function getApplication(session: Session, jobId: string): Promise<ApplicationRow | null> {
  const { data } = await supabase().from('applications').select('job_id, status, applied_on, updated_at')
    .eq('user_id', session.user.id).eq('job_id', jobId).maybeSingle();
  return (data as ApplicationRow | null) ?? null;
}

export async function setApplication(session: Session, jobId: string, status: AppStatus | null, appliedOn?: string): Promise<void> {
  const db = supabase();
  if (!status) {
    await db.from('applications').delete().eq('user_id', session.user.id).eq('job_id', jobId);
    return;
  }
  await db.from('applications').upsert({
    user_id: session.user.id, job_id: jobId, status,
    ...(appliedOn ? { applied_on: appliedOn } : {}),
  });
}

/** First Apply click while signed in → tracked as "applied", unless already tracked. */
export async function trackApplyClick(session: Session, jobId: string): Promise<void> {
  const existing = await getApplication(session, jobId);
  if (!existing) await setApplication(session, jobId, 'applied');
}

// ── Account page data ───────────────────────────────────────────────────────
export interface AccountData {
  saved: { job_id: string; created_at: string }[];
  applications: ApplicationRow[];
}

export async function loadAccount(session: Session): Promise<AccountData> {
  const db = supabase();
  const [s, a] = await Promise.all([
    db.from('saved_jobs').select('job_id, created_at').eq('user_id', session.user.id).order('created_at', { ascending: false }),
    db.from('applications').select('job_id, status, applied_on, updated_at').eq('user_id', session.user.id).order('updated_at', { ascending: false }),
  ]);
  return { saved: (s.data ?? []) as AccountData['saved'], applications: (a.data ?? []) as ApplicationRow[] };
}

export interface JobSummary {
  id: string; title: string; company: string; level: string | null;
  location_type: string | null; location: string | null; employment_type: string | null;
  status: 'active' | 'dead'; posted_at: string | null;
}

/** Job details for a set of ids — includes closed jobs so saved lists don't silently lose entries. */
export async function fetchJobs(ids: string[]): Promise<Map<string, JobSummary>> {
  if (!ids.length) return new Map();
  const { data } = await supabase()
    .from('jobs')
    .select('id, title, level, location_type, location, employment_type, status, posted_at, companies(name)')
    .in('id', ids);
  const map = new Map<string, JobSummary>();
  for (const row of (data ?? []) as any[]) {
    map.set(row.id, { ...row, company: row.companies?.name ?? '' });
  }
  return map;
}
