export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — List kiosks (all kiosks, no auth check — admin panel is already protected)
export async function GET() {
  const admin = getSupabase();

  let query = admin
    .from("kiosks")
    .select("*, kiosk_wallets(balance), kiosk_sessions(id, is_active, last_heartbeat)")
    .order("created_at", { ascending: false });

  const { data: kiosks, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Flatten joined data
  const enriched = (kiosks || []).map((k: any) => {
    const wallet = Array.isArray(k.kiosk_wallets) ? k.kiosk_wallets[0] : k.kiosk_wallets;
    const sessions = Array.isArray(k.kiosk_sessions) ? k.kiosk_sessions : [];
    const activeSession = sessions.find((s: any) => s.is_active);

    return {
      id: k.id,
      code: k.code,
      name: k.name,
      agent_id: k.agent_id,
      is_active: k.is_active,
      created_at: k.created_at,
      balance: wallet?.balance ?? 0,
      has_active_session: !!activeSession,
      last_heartbeat: activeSession?.last_heartbeat ?? null,
    };
  });

  return NextResponse.json({ kiosks: enriched });
}

// POST — Create new kiosk
export async function POST(req: NextRequest) {
  const admin = getSupabase();

  const body = await req.json();
  const { name, agent_id } = body;

  if (!name) {
    return NextResponse.json({ error: "Nome obbligatorio" }, { status: 400 });
  }

  let resolvedAgentId = agent_id;

  // If no agent_id provided, use the first active agent
  if (!resolvedAgentId) {
    const { data: firstAgent } = await admin
      .from("agents")
      .select("id")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    resolvedAgentId = firstAgent?.id;
  }

  if (!resolvedAgentId) {
    return NextResponse.json({ error: "Nessun agente attivo trovato" }, { status: 400 });
  }

  // Generate unique kiosk code
  const { data: codeResult, error: codeError } = await admin.rpc("generate_kiosk_code");
  if (codeError || !codeResult) {
    return NextResponse.json({ error: "Errore generazione codice: " + (codeError?.message || "unknown") }, { status: 500 });
  }

  // Insert kiosk
  const { data: kiosk, error: kioskError } = await admin
    .from("kiosks")
    .insert({
      code: codeResult,
      name,
      agent_id: resolvedAgentId,
      is_active: true,
    })
    .select("*")
    .single();

  if (kioskError) {
    return NextResponse.json({ error: "Errore creazione kiosk: " + kioskError.message }, { status: 500 });
  }

  // Create wallet for kiosk
  const { error: walletError } = await admin
    .from("kiosk_wallets")
    .insert({
      kiosk_id: kiosk.id,
      balance: 0,
    });

  if (walletError) {
    // Cleanup kiosk
    await admin.from("kiosks").delete().eq("id", kiosk.id);
    return NextResponse.json({ error: "Errore creazione wallet: " + walletError.message }, { status: 500 });
  }

  return NextResponse.json({ kiosk }, { status: 201 });
}
