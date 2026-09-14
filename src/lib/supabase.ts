import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function env(name: string): string | undefined {
  const fromVite = (import.meta.env as Record<string, string | undefined>)[name];
  if (fromVite) return fromVite;
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

/**
 * Server-only Supabase client using the secret key. Never import this from
 * anything that ships to the browser.
 *
 * Returns null when the keys aren't configured (a contributor running
 * `npm run dev` without a Supabase project) so every caller can degrade to
 * the static JSON data instead of crashing.
 */
export function getServerClient(): SupabaseClient | null {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  url: string | null;
  vertical: string | null;
}

export interface JobRow {
  id: string;
  company_id: string;
  title: string;
  url: string;
  level: string | null;
  location_type: string | null;
  location: string | null;
  employment_type: string | null;
  vertical: string | null;
  salary: string | null;
  tags: string[];
  posted_at: string | null;
  status: 'active' | 'dead';
  removed_at: string | null;
}
