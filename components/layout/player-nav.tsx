"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { SportSidebarContent } from "@/components/layout/sport-sidebar";

const NAV_ITEMS = [
  { href: "/home", icon: "🏠", label: "Home" },
  { href: "/live", icon: "🔴", label: "Live" },
  { href: "/sport", icon: "⚽", label: "Sport" },
  { href: "/casino", icon: "🎰", label: "Casino" },
  { href: "/promo", icon: "🎁", label: "Promo" },
  { href: "/wallet", icon: "💰", label: "Wallet" },
];

export function PlayerNavbar({ desktop = false }: { desktop?: boolean }) {
  const { user, wallet } = useAuth();

  return (
    <header className={cn(
      "sticky top-0 z-50 bg-white border-b border-gray-200",
      desktop && "shadow-sm"
    )}>
      <div className={cn(
        "flex items-center justify-between h-[52px]",
        desktop ? "px-6" : "px-4 max-w-[430px] mx-auto"
      )}>
        {/* Mobile: hamburger, Desktop: nothing */}
        {!desktop && <button className="text-xl text-gray-400">☰</button>}

        {/* Logo */}
        <Link href="/home" className="flex items-center gap-1">
          <span className="text-brand text-xl">♦</span>
          <span className="text-lg font-light text-gray-800 tracking-wider">
            vinc<span className="text-brand font-normal">i</span>tu
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {desktop && (
                <span className="text-sm text-gray-500">
                  Ciao, <span className="font-semibold text-gray-800">{user.username}</span>
                </span>
              )}
              <Link
                href="/wallet"
                className="flex items-center gap-1.5 bg-brand/5 border border-brand/20 rounded-lg px-2.5 py-1.5"
              >
                <span className="text-xs font-bold text-brand font-mono">
                  ${wallet?.balance?.toFixed(2) || "0.00"}
                </span>
                <span className="text-brand text-[10px]">▼</span>
              </Link>
            </>
          ) : (
            <Link href="/login" className="text-sm font-semibold text-brand">
              Accedi
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function PlayerBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white border-t border-gray-200 z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="flex">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors",
                isActive ? "text-brand" : "text-gray-400"
              )}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function PlayerDesktopSidebar() {
  const pathname = usePathname();
  const isSportPage = pathname === "/sport" || pathname.startsWith("/sport/")
    || pathname === "/live" || pathname.startsWith("/live/");

  return (
    <aside className={cn(
      "bg-white border-r border-gray-200 min-h-screen flex-shrink-0 sticky top-0 h-screen overflow-y-auto transition-all",
      isSportPage ? "w-64" : "w-56"
    )}>
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-100">
        <Link href="/home" className="flex items-center gap-1.5">
          <span className="text-brand text-2xl">♦</span>
          <span className="text-xl font-light text-gray-800 tracking-wider">
            vinc<span className="text-brand font-normal">i</span>tu
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                isActive
                  ? "bg-brand/10 text-brand font-semibold"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              )}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Sport sidebar — shown when on /sport route */}
      {isSportPage && (
        <div className="border-t border-gray-100">
          <SportSidebarContent />
        </div>
      )}

      {/* Quick Links */}
      <div className={cn("px-3 py-4 border-t border-gray-100 space-y-1", !isSportPage && "mt-auto")}>
        <Link href="/account" className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50">
          <span>👤</span> Account
        </Link>
        <Link href="/bets" className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50">
          <span>🎫</span> Le Mie Scommesse
        </Link>
        <Link href="/admin/dashboard" className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50">
          <span>🔧</span> Back Office
        </Link>
      </div>
    </aside>
  );
}
