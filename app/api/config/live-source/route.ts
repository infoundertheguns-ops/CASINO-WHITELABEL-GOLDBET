import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const CONFIG_KEY = "active_live_source";
const VALID_SOURCES = ["leon", "goldbet"];

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** GET: read current live source */
export async function GET() {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("system_config")
    .select("value")
    .eq("key", CONFIG_KEY)
    .single();

  if (error || !data) {
    return NextResponse.json({ source: "leon" });
  }

  const source = typeof data.value === "string" ? data.value : "leon";
  return NextResponse.json({ source });
}

/** POST: update live source (admin only) */
export async function POST(req: NextRequest) {
  // Auth: require scraper key or admin check
  const key = req.headers.get("x-scraper-key");
  const isScraperAuth = key && key === process.env.SCRAPER_API_KEY;

  if (!isScraperAuth) {
    // Check for admin cookie auth
    const { createServerClient } = await import("@supabase/ssr");
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
        },
      }
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin role
    const supabase = getServiceClient();
    const { data: admin } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (!admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
  }

  let body: { source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.source || !VALID_SOURCES.includes(body.source)) {
    return NextResponse.json(
      { error: `Invalid source. Must be one of: ${VALID_SOURCES.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = getServiceClient();
  const { error } = await supabase
    .from("system_config")
    .upsert({
      key: CONFIG_KEY,
      value: body.source,
      description: "Active live data source (leon or goldbet)",
      updated_at: new Date().toISOString(),
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ source: body.source, updated: true });
}
