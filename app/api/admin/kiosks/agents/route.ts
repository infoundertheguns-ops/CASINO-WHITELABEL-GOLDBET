export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — List agents with TOTP status (for kiosk management)
export async function GET() {
  const supabase = getSupabase();

  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, name, code, totp_secret, status")
    .eq("status", "active")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    agents: (agents || []).map((a) => ({
      id: a.id,
      name: a.name,
      code: a.code,
      has_totp: !!a.totp_secret,
    })),
  });
}
