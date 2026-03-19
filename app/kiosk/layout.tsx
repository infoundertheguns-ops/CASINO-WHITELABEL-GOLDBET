"use client";

import { usePathname } from "next/navigation";
import { SourceProvider } from "@/lib/contexts/source-context";
import { SportFilterProvider } from "@/lib/contexts/sport-filter-context";
import KioskHeader from "@/components/kiosk/layout/kiosk-header";
import KioskSidebar from "@/components/kiosk/layout/kiosk-sidebar";

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/kiosk";

  return (
    <SourceProvider>
      <SportFilterProvider>
        {/* Google Fonts: Open Sans + Open Sans Condensed (exact Midas fonts) */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800&family=Open+Sans+Condensed:wght@300;700&display=swap"
        />
        <div
          className="kiosk-theme h-screen w-screen flex flex-col overflow-hidden"
          style={{ background: "var(--midas-bg)" }}
        >
          {/* Header — from QML HeaderBar */}
          <KioskHeader />

          {/* Sidebar + Content — from QML RowLayout */}
          <div className="flex flex-1 overflow-hidden">
            <KioskSidebar />
            <main className="flex-1 overflow-hidden relative flex flex-col">
              {/* Stadium background only on home (from QML Image { source: stadium.png }) */}
              {isHome && (
                <>
                  <div
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                    style={{ backgroundImage: "url(/midas/background/stadium.png)" }}
                  />
                  <div className="absolute inset-0 bg-black/50" />
                </>
              )}
              <div className="relative z-[1] flex-1 flex flex-col overflow-hidden">
                {children}
              </div>
            </main>
          </div>
        </div>
      </SportFilterProvider>
    </SourceProvider>
  );
}
