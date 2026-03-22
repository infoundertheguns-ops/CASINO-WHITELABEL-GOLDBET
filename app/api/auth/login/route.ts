import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
  try {
    const { email: rawIdentifier, password } = await request.json();

    if (!rawIdentifier || !password) {
      return NextResponse.json({ error: "Username/email e password richiesti" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // If input doesn't contain @, treat as username → lookup email
    let email = rawIdentifier;
    if (!rawIdentifier.includes("@")) {
      const { createClient } = await import("@supabase/supabase-js");
      const adminSb = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: userRow } = await adminSb
        .from("users")
        .select("email")
        .eq("username", rawIdentifier)
        .limit(1)
        .maybeSingle();

      if (!userRow?.email) {
        return NextResponse.json({ error: "Username non trovato" }, { status: 401 });
      }
      email = userRow.email;
    }

    // Direct fetch to Supabase auth with 15s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let authRes: Response;
    try {
      authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        return NextResponse.json(
          { error: "Servizio di autenticazione lento. Riprova tra qualche secondo." },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Errore di connessione al servizio auth" }, { status: 503 });
    }
    clearTimeout(timeout);

    const authData = await authRes.json();

    if (!authRes.ok) {
      const msg = authData?.error_description || authData?.msg || authData?.error || "Errore di autenticazione";
      return NextResponse.json({ error: msg }, { status: authRes.status });
    }

    // Set session cookies so middleware can read them
    const cookieStore = await cookies();
    const accessToken = authData.access_token;
    const refreshToken = authData.refresh_token;

    if (accessToken) {
      cookieStore.set("sb-xgnyqkmugnfzhdveeqom-auth-token.0", JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "bearer",
        expires_in: authData.expires_in,
        expires_at: authData.expires_at,
        user: authData.user,
      }), {
        path: "/",
        httpOnly: false,
        sameSite: "lax",
        maxAge: authData.expires_in || 3600,
      });
    }

    // Detect role: super_admin, agent, or player
    const userId = authData.user?.id;
    let role = "player";
    let agentData = null;

    if (userId) {
      const { createClient: createSb } = await import("@supabase/supabase-js");
      const adminSb = createSb(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!);

      // Check if super admin (via admin_users table)
      const { data: adminRow } = await adminSb
        .from("admin_users")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (adminRow) {
        role = "super_admin";
      } else {
        // Check if this user is an agent
        const { data: agentRow } = await adminSb
          .from("agents")
          .select("id, name, code, level, permissions, status")
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle();

        if (agentRow) {
          role = "agent";
          agentData = agentRow;
        }
      }
    }

    return NextResponse.json({
      user: { id: userId, email: authData.user?.email },
      role,
      agent: agentData,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Errore interno" }, { status: 500 });
  }
}
