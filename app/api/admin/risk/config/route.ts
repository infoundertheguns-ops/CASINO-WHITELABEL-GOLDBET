export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { detectAgent, hasPermission } from "@/lib/agent-permissions";

const CONFIG_KEY = "risk_alert_config";

const DEFAULT_CONFIG = {
  max_exposure: 50000,
  max_daily_win: 10000,
  consecutive_wins_alert: 5,
  enabled: true,
};

// GET /api/admin/risk/config — fetch risk alert config
// PUT /api/admin/risk/config — update risk alert config (super admin only)

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const authClient = await createClient();

  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { data: adminRecord } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).limit(1).maybeSingle();

  const isSuperAdmin = !!adminRecord;

  if (!isSuperAdmin) {
    const myAgent = await detectAgent(supabase, authUser.id);
    if (!myAgent) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    if (!hasPermission(myAgent.permissions, "risk", "viewer"))
      return NextResponse.json({ error: "Permesso negato" }, { status: 403 });
  }

  try {
    const { data } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .limit(1)
      .maybeSingle();

    const config = data?.value ? (typeof data.value === "string" ? JSON.parse(data.value) : data.value) : DEFAULT_CONFIG;

    return NextResponse.json({ config });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const supabase = createAdminClient();
  const authClient = await createClient();

  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  // Only super admin can update config
  const { data: adminRecord } = await supabase
    .from("admin_users").select("id").eq("user_id", authUser.id).limit(1).maybeSingle();

  if (!adminRecord) return NextResponse.json({ error: "Solo super admin" }, { status: 403 });

  try {
    const body = await req.json();
    const { max_exposure, max_daily_win, consecutive_wins_alert, enabled } = body;

    // Fetch current config to merge
    const { data: existing } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .limit(1)
      .maybeSingle();

    const current = existing?.value
      ? (typeof existing.value === "string" ? JSON.parse(existing.value) : existing.value)
      : DEFAULT_CONFIG;

    const updated = {
      ...current,
      ...(max_exposure !== undefined && { max_exposure }),
      ...(max_daily_win !== undefined && { max_daily_win }),
      ...(consecutive_wins_alert !== undefined && { consecutive_wins_alert }),
      ...(enabled !== undefined && { enabled }),
    };

    const { error } = await supabase
      .from("system_config")
      .upsert({ key: CONFIG_KEY, value: updated }, { onConflict: "key" });

    if (error) throw error;

    return NextResponse.json({ config: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
