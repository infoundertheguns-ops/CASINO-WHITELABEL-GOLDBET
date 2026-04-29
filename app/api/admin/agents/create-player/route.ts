export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Create player for an agent
export async function POST(req: NextRequest) {
  const supabase = getAdminSupabase();
  const body = await req.json();

  const { username, password, player_type, agent_id } = body;

  if (!username || !password || !agent_id) {
    return NextResponse.json({ error: "username, password e agent_id richiesti" }, { status: 400 });
  }

  // Check agent exists
  const { data: agent } = await supabase
    .from("agents")
    .select("id, status")
    .eq("id", agent_id)
    .single();

  if (!agent || agent.status !== "active") {
    return NextResponse.json({ error: "Agente non trovato o non attivo" }, { status: 404 });
  }

  // Check username uniqueness
  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existingUser) {
    return NextResponse.json({ error: `Username '${username}' già in uso` }, { status: 409 });
  }

  // Generate placeholder email
  const email = `${username}@players.betssolution.local`;

  // Create auth user
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    return NextResponse.json({ error: "Errore creazione account: " + (authError?.message || "") }, { status: 500 });
  }

  // Create user profile
  await supabase.from("users").upsert({
    id: authUser.user.id,
    email,
    username,
    display_name: username,
    player_type: player_type || "online",
    agent_id,
    is_active: true,
  }, { onConflict: "id" });

  // Create player wallet
  await supabase.from("wallets").insert({
    user_id: authUser.user.id,
    owner_type: "player",
    balance: 0,
    bonus_balance: 0,
    locked_balance: 0,
    total_deposited: 0,
    total_withdrawn: 0,
    total_wagered: 0,
    total_won: 0,
  });

  return NextResponse.json({
    player: {
      id: authUser.user.id,
      username,
      player_type: player_type || "online",
    },
  }, { status: 201 });
}
