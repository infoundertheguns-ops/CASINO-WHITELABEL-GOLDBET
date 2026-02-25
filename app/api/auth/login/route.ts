import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email e password richiesti" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

    return NextResponse.json({
      user: { id: authData.user?.id, email: authData.user?.email },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Errore interno" }, { status: 500 });
  }
}
