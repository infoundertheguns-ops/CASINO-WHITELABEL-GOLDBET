"use client";

import { usePathname, useRouter } from "next/navigation";

/* Sidebar items — exact order from Midas QML HomeNavBar + LeftBarNavView
   Icons from /midas/svg/offer/flat/ and /midas/icons/midas/ */
const SIDEBAR_ITEMS = [
  { id: "home",      label: "Home",              href: "/kiosk",       icon: "/midas/svg/offer/flat/home.svg" },
  { id: "prematch",  label: "Pre\nMatch",        href: "/kiosk/sport", icon: "/midas/svg/offer/flat/regular sports.svg" },
  { id: "live",      label: "Live",              href: "/kiosk/live",  icon: "/midas/svg/offer/flat/live sports.svg" },
  { id: "magellan",  label: "Virtual\nMagellan",  href: null,           icon: "/midas/svg/offer/flat/trident.svg" },
  { id: "inspired",  label: "Virtual\nInspired",  href: null,           icon: "/midas/svg/offer/flat/geko.svg" },
  { id: "gap",       label: "",                   href: null,           icon: null },
  { id: "lotterie",  label: "Lotterie",          href: null,           icon: "/midas/svg/offer/flat/lottery.svg" },
  { id: "keno",      label: "Keno",              href: null,           icon: "/midas/svg/offer/flat/keno.svg" },
  { id: "cerca",     label: "Cerca",             href: null,           icon: "/midas/svg/offer/flat/search.svg" },
  { id: "ricerca",   label: "Ricerca",           href: null,           icon: "/midas/svg/offer/flat/search.svg" },
];

export default function KioskSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(item: typeof SIDEBAR_ITEMS[0]) {
    if (!item.href) return false;
    if (item.href === "/kiosk") return pathname === "/kiosk";
    return pathname.startsWith(item.href);
  }

  return (
    <aside
      className="flex-shrink-0 flex flex-col"
      style={{ width: 50, background: "var(--midas-red)" }}
    >
      {SIDEBAR_ITEMS.map((item) => {
        if (item.id === "gap") {
          return <div key="gap" className="flex-1" />;
        }

        const active = isActive(item);
        return (
          <button
            key={item.id}
            onClick={() => item.href && router.push(item.href)}
            className="flex flex-col items-center justify-center border-0 cursor-pointer"
            style={{
              height: 55,
              gap: 2,
              background: active ? "var(--midas-selected)" : "var(--midas-red)",
              borderBottom: "1px solid rgba(0,0,0,0.15)",
            }}
          >
            {/* Icon from midas SVG */}
            {item.icon && (
              <img
                src={item.icon}
                alt={item.label}
                style={{ width: 18, height: 18, filter: "brightness(0) invert(1)" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            )}
            <div
              className="uppercase text-center leading-tight whitespace-pre-line font-semibold text-white"
              style={{ fontSize: 7, fontFamily: "'Open Sans Condensed', sans-serif" }}
            >
              {item.label}
            </div>
          </button>
        );
      })}
    </aside>
  );
}
