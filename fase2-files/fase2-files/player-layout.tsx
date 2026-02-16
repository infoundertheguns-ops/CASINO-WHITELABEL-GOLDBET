"use client";

import { useEffect } from "react";
import { PlayerNavbar, PlayerBottomNav, PlayerDesktopSidebar } from "@/components/layout/player-nav";
import { useAuth } from "@/lib/hooks/use-auth";

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { initialize, isLoading } = useAuth();

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop: sidebar + content */}
      <div className="hidden lg:flex">
        <PlayerDesktopSidebar />
        <div className="flex-1 min-h-screen">
          <PlayerNavbar desktop />
          <main className="max-w-5xl mx-auto p-6">{children}</main>
        </div>
      </div>

      {/* Mobile: top nav + content + bottom nav */}
      <div className="lg:hidden max-w-[430px] mx-auto relative">
        <PlayerNavbar />
        <main className="pb-[70px]">{children}</main>
        <PlayerBottomNav />
      </div>
    </div>
  );
}
