// Normalize messy job locations into clean filter buckets.
// "Remote US (SF preferred)" -> ["Remote — US"]
// "San Francisco, CA / New York, NY" -> ["San Francisco", "New York"]
// A job can belong to several buckets; the filter matches any of them.

const CITY_ALIASES: Record<string, string> = {
  'nyc': 'New York',
  'new york city': 'New York',
  'sf': 'San Francisco',
  'remote': '', // handled by the remote branch
};

export function locationBuckets(location: string, locationType: string): string[] {
  const cleaned = location.replace(/\s*\([^)]*\)/g, '').trim();

  // Remote roles bucket by region, not by preferred-office nuance
  if (locationType === 'Remote' || /\bremote\b/i.test(cleaned)) {
    if (/europe|\bEU\b|EMEA/i.test(cleaned)) return ['Remote — Europe'];
    if (/global|anywhere|worldwide/i.test(cleaned)) return ['Remote — Global'];
    return ['Remote — US'];
  }

  // On-site / hybrid: extract each city from multi-city strings
  const buckets: string[] = [];
  for (const segment of cleaned.split(/\s*(?:\/|;| or )\s*/i)) {
    let city = segment.split(',')[0].trim();
    if (!city) continue;
    const alias = CITY_ALIASES[city.toLowerCase()];
    if (alias !== undefined) {
      if (alias) city = alias;
      else continue;
    }
    if (!buckets.includes(city)) buckets.push(city);
  }
  return buckets.length ? buckets : [cleaned];
}

/** Unique buckets across all jobs — Remote options first, then cities A-Z. */
export function allLocationBuckets(jobs: { location: string; locationType: string }[]): string[] {
  const set = new Set<string>();
  for (const j of jobs) locationBuckets(j.location, j.locationType).forEach(b => set.add(b));
  const all = [...set];
  const remote = all.filter(b => b.startsWith('Remote')).sort();
  const cities = all.filter(b => !b.startsWith('Remote')).sort();
  return [...remote, ...cities];
}
