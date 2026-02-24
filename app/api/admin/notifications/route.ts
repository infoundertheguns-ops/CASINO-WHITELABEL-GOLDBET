import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ═══════════════════════════════════════════════════
// ADMIN API: Notifications
// GET — fetch notifications (unread count + list)
// PATCH — mark as read
// ═══════════════════════════════════════════════════

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
    const unreadOnly = req.nextUrl.searchParams.get("unread") === "true";

    let query = supabase
      .from("admin_notifications")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) query = query.eq("is_read", false);

    const { data, count } = await query;

    // Unread count (always)
    const { count: unreadCount } = await supabase
      .from("admin_notifications")
      .select("id", { count: "exact", head: true })
      .eq("is_read", false);

    return NextResponse.json({
      notifications: data || [],
      total: count || 0,
      unread_count: unreadCount || 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const { ids, mark_all_read } = await req.json();

    if (mark_all_read) {
      await supabase
        .from("admin_notifications")
        .update({ is_read: true })
        .eq("is_read", false);
    } else if (ids && ids.length > 0) {
      await supabase
        .from("admin_notifications")
        .update({ is_read: true })
        .in("id", ids);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
