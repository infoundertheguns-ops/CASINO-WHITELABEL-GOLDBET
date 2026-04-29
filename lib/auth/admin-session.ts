import { createClient } from "@/lib/supabase/server";

export interface AdminSession {
  userId: string;        // auth.users.id
  adminUserId: string;   // admin_users.id
  role: string;          // admin_roles.name (super_admin, risk_manager, ecc.)
  username: string;      // admin_users.username (display name)
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: admin } = await supabase
    .from("admin_users")
    .select("id, username, is_active, admin_roles(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!admin || !admin.is_active) return null;
  return {
    userId: user.id,
    adminUserId: admin.id,
    role: (admin.admin_roles as any)?.name ?? "unknown",
    username: admin.username,
  };
}

export type RequireAdminResult = AdminSession | { error: string; status: number };

export function isAdminError(r: RequireAdminResult): r is { error: string; status: number } {
  return (r as any).error !== undefined;
}

export async function requireAdmin(): Promise<RequireAdminResult> {
  const s = await getAdminSession();
  if (!s) return { error: "Non autenticato come admin", status: 401 };
  return s;
}
