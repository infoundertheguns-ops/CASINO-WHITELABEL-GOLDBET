export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getAgentFromSession() {
  const cookieStore = await cookies();
  const agentId = cookieStore.get("agent_id")?.value;
  if (!agentId) return null;

  const supabase = getSupabase();
  const { data } = await supabase
    .from("agents")
    .select("id, name, code, totp_secret, status, user_id")
    .eq("id", agentId)
    .eq("status", "active")
    .maybeSingle();

  return data;
}

// GET — List kiosks for the current agent
export async function GET() {
  const agent = await getAgentFromSession();
  if (!agent) {
    // Fallback: try to get first active agent (for dev/testing)
    const supabase = getSupabase();
    const { data: firstAgent } = await supabase
      .from("agents")
      .select("id, name, code, totp_secret, status")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!firstAgent) {
      return NextResponse.json({ error: "Nessun agente trovato" }, { status: 404 });
    }

    const { data: kiosks } = await supabase
      .from("kiosks")
      .select("*, kiosk_wallets(balance), kiosk_sessions(id, is_active, last_heartbeat)")
      .eq("agent_id", firstAgent.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      agent_id: firstAgent.id,
      agent_name: firstAgent.name,
      totp_configured: !!firstAgent.totp_secret,
      kiosks: (kiosks || []).map(flattenKiosk),
    });
  }

  const supabase = getSupabase();
  const { data: kiosks } = await supabase
    .from("kiosks")
    .select("*, kiosk_wallets(balance), kiosk_sessions(id, is_active, last_heartbeat)")
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    agent_id: agent.id,
    agent_name: agent.name,
    totp_configured: !!agent.totp_secret,
    kiosks: (kiosks || []).map(flattenKiosk),
  });
}

// POST — Create kiosk for current agent
export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  const body = await req.json();
  const { name } = body;

  if (!name) {
    return NextResponse.json({ error: "Nome obbligatorio" }, { status: 400 });
  }

  // Get agent (from session or fallback)
  const agent = await getAgentFromSession();
  let agentId: string;

  if (agent) {
    agentId = agent.id;
  } else {
    const { data: firstAgent } = await supabase
      .from("agents")
      .select("id")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!firstAgent) return NextResponse.json({ error: "Nessun agente" }, { status: 400 });
    agentId = firstAgent.id;
  }

  // Generate code
  const { data: code, error: codeErr } = await supabase.rpc("generate_kiosk_code");
  if (codeErr || !code) {
    return NextResponse.json({ error: "Errore generazione codice" }, { status: 500 });
  }

  // Create kiosk
  const { data: kiosk, error: kioskErr } = await supabase
    .from("kiosks")
    .insert({ code, name, agent_id: agentId, is_active: true })
    .select("*")
    .single();

  if (kioskErr) return NextResponse.json({ error: kioskErr.message }, { status: 500 });

  // Create wallet
  await supabase.from("kiosk_wallets").insert({ kiosk_id: kiosk.id, balance: 0 });

  return NextResponse.json({ kiosk }, { status: 201 });
}

function flattenKiosk(k: any) {
  const wallet = Array.isArray(k.kiosk_wallets) ? k.kiosk_wallets[0] : k.kiosk_wallets;
  const sessions = Array.isArray(k.kiosk_sessions) ? k.kiosk_sessions : [];
  const activeSession = sessions.find((s: any) => s.is_active);
  return {
    id: k.id,
    code: k.code,
    name: k.name,
    is_active: k.is_active,
    balance: wallet?.balance ?? 0,
    has_active_session: !!activeSession,
    last_heartbeat: activeSession?.last_heartbeat ?? null,
  };
}
