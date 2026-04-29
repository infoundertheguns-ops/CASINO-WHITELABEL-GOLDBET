export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { collectReferencedFilenames } from "@/lib/admin/home-content-storage";

// E5 Phase 2 — Storage orphan scanner for home-content bucket.
// Lists files uploaded to the "home-content" bucket that are NOT referenced by
// any column in home_content (image_url / icon_url / flag_url). Supports a
// ?delete=1 query flag to actually purge them (otherwise read-only preview).

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const sp = req.nextUrl.searchParams;
  const purge = sp.get("delete") === "1";

  // 1) List all files in the bucket (paginated over 1000-item Supabase API).
  const allFiles: { name: string; size: number; updated_at: string }[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase.storage.from("home-content").list("", {
      limit: PAGE, offset, sortBy: { column: "updated_at", order: "desc" },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (!f.name) continue;
      allFiles.push({ name: f.name, size: (f as any).metadata?.size ?? 0, updated_at: f.updated_at ?? "" });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // 2) Collect referenced filenames from home_content.
  const { data: rows, error: qErr } = await supabase
    .from("home_content")
    .select("image_url, icon_url, flag_url");
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  const referenced = collectReferencedFilenames(rows ?? []);

  const orphans = allFiles.filter((f) => !referenced.has(f.name));
  const totalSize = orphans.reduce((a, f) => a + (f.size || 0), 0);

  let deleted: string[] = [];
  if (purge && orphans.length > 0) {
    const paths = orphans.map((f) => f.name);
    const { data: delData, error: delErr } = await supabase.storage.from("home-content").remove(paths);
    if (delErr) return NextResponse.json({ error: delErr.message, found: orphans.length }, { status: 500 });
    deleted = (delData ?? []).map((d: any) => d.name);
  }

  return NextResponse.json({
    total_files: allFiles.length,
    referenced: referenced.size,
    orphan_count: orphans.length,
    orphan_size_bytes: totalSize,
    orphans: orphans.slice(0, 200), // cap response
    deleted,
  });
}
