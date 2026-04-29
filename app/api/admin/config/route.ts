export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  try {
    const supabase = getSupabase();

    const [{ data: sysConfig }, { data: riskConfig }] = await Promise.all([
      supabase.from("system_config").select("key, value"),
      supabase.from("risk_config").select("key, value, description"),
    ]);

    const system: Record<string, any> = {};
    for (const row of sysConfig || []) {
      system[row.key] = row.value;
    }

    const risk: Record<string, any> = {};
    for (const row of riskConfig || []) {
      risk[row.key] = row.value;
    }

    return NextResponse.json({ system, risk });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const { table, key, value } = await req.json();

    if (!table || !key || value === undefined) {
      return NextResponse.json({ error: "table, key, value required" }, { status: 400 });
    }

    const targetTable = table === "risk" ? "risk_config" : "system_config";

    const { data, error } = await supabase
      .from(targetTable)
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log
    await supabase.from("audit_log").insert({
      action: "config_update",
      entity_type: targetTable,
      entity_id: key,
      details: { key, value, table: targetTable },
    }).then(() => {}, () => {});

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
