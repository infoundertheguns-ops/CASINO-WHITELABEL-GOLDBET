export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  const { items } = await req.json();

  if (!Array.isArray(items)) {
    return NextResponse.json({ error: "items array obbligatorio" }, { status: 400 });
  }

  for (const item of items) {
    await supabase
      .from("home_content")
      .update({ sort_order: item.sort_order, updated_at: new Date().toISOString() })
      .eq("id", item.id);
  }

  return NextResponse.json({ success: true });
}
