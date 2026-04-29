// Pure helpers for Home CMS storage bucket path parsing.
// Extracted from app/api/admin/home-content/orphans/route.ts so the logic is
// unit-testable independently of the Supabase client.

/**
 * Extract the storage filename from a Supabase public URL that points to the
 * "home-content" bucket. Returns null when the URL is not a home-content
 * public URL (e.g. external CDN, internal /midas-svg path, legacy uploads).
 *
 * Accepted shapes:
 *   https://<project>.supabase.co/storage/v1/object/public/home-content/<filename>
 *   https://<project>.supabase.co/storage/v1/object/public/home-content/<filename>?query
 *   /storage/v1/object/public/home-content/<filename>        (relative)
 */
export function parseHomeContentStoragePath(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  // Capture up to (not including) ? or # or end-of-string.
  const m = url.match(/\/home-content\/([^?#]+?)(?:[?#]|$)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Given a batch of home_content rows, collect the set of distinct filenames
 * referenced across image_url / icon_url / flag_url fields. Used to diff
 * against storage bucket listing and surface orphan files.
 */
export function collectReferencedFilenames(
  rows: Array<Pick<Record<string, unknown>, "image_url" | "icon_url" | "flag_url">>,
): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    for (const col of ["image_url", "icon_url", "flag_url"] as const) {
      const parsed = parseHomeContentStoragePath(r[col] as string | null);
      if (parsed) out.add(parsed);
    }
  }
  return out;
}
