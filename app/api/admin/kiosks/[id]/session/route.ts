export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// DELETE — Kill all active sessions for a kiosk
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: kioskId } = await params;
  const admin = getSupabase();

  // Kill all active sessions
  const { error, count } = await admin
    .from("kiosk_sessions")
    .update({ is_active: false })
    .eq("kiosk_id", kioskId)
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: "Errore disattivazione sessioni: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, sessionsKilled: count ?? 0 });
}
