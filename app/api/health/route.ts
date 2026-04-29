import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startedAt = Date.now();

export async function GET() {
  const version = process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown";
  let dbStatus: "ok" | "down" = "down";

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const { error } = await supabase
      .from("system_config")
      .select("key", { count: "exact", head: true })
      .abortSignal(ctrl.signal);
    clearTimeout(timer);
    if (!error) dbStatus = "ok";
  } catch {
    dbStatus = "down";
  }

  const body = {
    status: dbStatus === "ok" ? "ok" : "degraded",
    db: dbStatus,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version,
    env: process.env.NEXT_PUBLIC_APP_ENV ?? "unknown",
    app: "betssolution-admin",
  };

  return NextResponse.json(body, { status: dbStatus === "ok" ? 200 : 503 });
}
