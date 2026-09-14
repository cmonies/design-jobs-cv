// Company slug — the one place this rule lives. Used by the site (TS) and by
// scripts/sync-supabase.mjs, so both sides always agree on /companies/{slug}.
// Must satisfy the DB check: ^[a-z0-9]+(-[a-z0-9]+)*$

/** @param {string} name @returns {string} */
export function slugify(name) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'company';
}
