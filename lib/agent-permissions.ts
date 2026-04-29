import type { Agent, AgentPermissions, PermissionKey, PermissionLevel } from "@/lib/types/agent";

/**
 * Check if agent has at least the required permission level
 */
export function hasPermission(
  permissions: AgentPermissions,
  key: PermissionKey,
  required: PermissionLevel
): boolean {
  const level = permissions[key] || "none";
  if (required === "none") return true;
  if (required === "viewer") return level === "viewer" || level === "editor";
  if (required === "editor") return level === "editor";
  return false;
}

/**
 * Build admin navigation for an agent based on their permissions
 */
export function buildAgentNavigation(permissions: AgentPermissions) {
  const items: { id: string; icon: string; label: string }[] = [];

  if (hasPermission(permissions, "dashboard", "viewer"))
    items.push({ id: "agent-dashboard", icon: "📊", label: "Dashboard" });
  if (hasPermission(permissions, "players", "viewer"))
    items.push({ id: "agent-players", icon: "👥", label: "Giocatori" });
  if (hasPermission(permissions, "bets", "viewer"))
    items.push({ id: "bets", icon: "🎯", label: "Scommesse" });
  items.push({ id: "agent-wallet", icon: "💳", label: "Wallet" });
  if (hasPermission(permissions, "sub_agents", "viewer"))
    items.push({ id: "agent-network", icon: "🌐", label: "Rete Agenti" });
  if (hasPermission(permissions, "kiosks", "viewer"))
    items.push({ id: "agent-kiosks", icon: "🖥️", label: "Kiosk" });
  if (hasPermission(permissions, "tickets", "viewer"))
    items.push({ id: "agent-tickets", icon: "🎫", label: "Ticket" });
  if (hasPermission(permissions, "reports", "viewer") || hasPermission(permissions, "commissions", "viewer"))
    items.push({ id: "agent-commissions", icon: "💰", label: "Report & Commissioni" });
  if (hasPermission(permissions, "commissions", "viewer"))
    items.push({ id: "agent-settlements", icon: "📅", label: "Settlements" });
  if (hasPermission(permissions, "risk", "viewer"))
    items.push({ id: "agent-risk", icon: "🛡️", label: "Rischio" });

  return [{ group: "AGENTE", items }];
}

/**
 * Get all descendant agent IDs for data scoping (recursive)
 */
export async function getDescendantAgentIds(
  supabase: any,
  agentId: string
): Promise<string[]> {
  const ids: string[] = [agentId];
  let currentLevel = [agentId];

  for (let i = 0; i < 3; i++) {
    if (currentLevel.length === 0) break;
    const { data } = await supabase
      .from("agents")
      .select("id")
      .in("parent_id", currentLevel)
      .eq("status", "active");

    const childIds = (data || []).map((a: any) => a.id);
    ids.push(...childIds);
    currentLevel = childIds;
  }

  return ids;
}

/**
 * Get all player IDs scoped to an agent and descendants
 */
export async function getScopedPlayerIds(
  supabase: any,
  agentId: string
): Promise<string[]> {
  const agentIds = await getDescendantAgentIds(supabase, agentId);
  const { data } = await supabase
    .from("users")
    .select("id")
    .in("agent_id", agentIds);

  return (data || []).map((u: any) => u.id);
}

/**
 * Detect if user is an agent, return agent info or null
 */
export async function detectAgent(
  supabase: any,
  userId: string
): Promise<Agent | null> {
  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  return data || null;
}
