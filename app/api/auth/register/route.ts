import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { email, password, username } = await request.json();

  if (!email || !password || !username) {
    return NextResponse.json({ error: "Tutti i campi sono richiesti" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username, display_name: username } },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (data.user) {
    await supabase.from("users").insert({
      id: data.user.id,
      email,
      username,
      display_name: username,
    });

    await supabase.from("wallets").insert({
      user_id: data.user.id,
      currency: "USDT",
      balance: 0,
      bonus_balance: 0,
      locked_balance: 0,
    });
  }

  return NextResponse.json({ user: { id: data.user?.id, email: data.user?.email } });
}
