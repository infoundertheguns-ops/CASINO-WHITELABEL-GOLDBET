"use client";

import { useSportCounts } from "@/lib/hooks/use-sport-counts";
import { useSportsbook } from "@/lib/hooks/use-sportsbook";
import { getMidasSportIcon, getMidasSportHero, MIDAS_SPORT_COLORS } from "@/components/kiosk/utils/midas-sport-map";
import { useState, useEffect } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   STATIC DATA — matches Midas kiosk content
   ═══════════════════════════════════════════════════════════════════════════ */

const COMPETITION_ITEMS = [
  { label: "Serie A", icon: "/midas/svg/competition/68-Italy-SerieA.svg", flag: "/midas/svg/flags/IT.svg", colour: "rgb(141,198,63)" },
  { label: "Serie B", icon: "/midas/svg/competition/68-Italy-SerieB.svg", flag: "/midas/svg/flags/IT.svg", colour: "rgb(0,104,166)" },
  { label: "Premier League", icon: "/midas/svg/competition/68-england-premierleague.svg", flag: "/midas/svg/flags/EN.svg", colour: "rgb(250,166,26)" },
  { label: "La Liga", icon: "/midas/svg/competition/68-Spain-LaLiga.svg", flag: "/midas/svg/flags/ES.svg", colour: "rgb(215,25,32)" },
  { label: "Bundesliga", icon: "/midas/svg/competition/68-Germany-Bundesliga.svg", flag: "/midas/svg/flags/DE.svg", colour: "rgb(141,198,63)" },
  { label: "Ligue 1", icon: "/midas/svg/competition/68-France-Ligue1.svg", flag: "/midas/svg/flags/FR.svg", colour: "rgb(0,104,166)" },
  { label: "Primera Liga", icon: "/midas/svg/competition/68-portugal-primeiraliga.svg", flag: "/midas/svg/flags/PT.svg", colour: "rgb(215,25,32)" },
];

const COUPON_ITEMS = [
  { label: "Campionati Top", icon: "/midas/svg/sports/black/football.svg" },
  { label: "Partite di Meta Settimana", icon: "/midas/svg/sports/black/football.svg" },
];

/* ═══════════════════════════════════════════════════════════════════════════
   HomeMainFull LAYOUT — exact grid from Midas QML

   ColumnLayout { margins: 16, spacing: 16 }
     RowLayout { spacing: 16 }
       LEFT COLUMN (fills = ~80%):
         Row 1: PROMO (2/6 height) = PromoPanel(40%) + FeaturedPanel(60%)
         Row 2: COMPETITIONS (1/6)
         Row 3: SPORTS (1/6)
         Row 4: VIRTUAL (2/6) = VsportsPanel(fill) + KenoPanel(20%root)
       RIGHT COLUMN (20% root):
         Top: CouponPanel (2/6 height)
         Bottom: FeaturedLivePanel (fills = 4/6)
     Accreditations (max 140px)
   ═══════════════════════════════════════════════════════════════════════════ */

export default function KioskHomePage() {
  const { sports } = useSportCounts("all");
  const { events, loading } = useSportsbook();

  // Live sports grouped (max 3)
  const liveSports: { name: string; slug: string; count: number }[] = [];
  const liveMap = new Map<string, { name: string; slug: string; count: number }>();
  for (const ev of events.filter((e) => e.live)) {
    const slug = ev.sportSlug || "other";
    if (!liveMap.has(slug)) liveMap.set(slug, { name: ev.sportName || slug, slug, count: 0 });
    liveMap.get(slug)!.count++;
  }
  liveMap.forEach((v) => liveSports.push(v));

  // Top sports for featured/sports panels
  const topSports = sports.length > 0
    ? sports.slice(0, 8).map((s) => ({ name: s.name, slug: s.slug, count: s.eventCount }))
    : [
        { name: "Calcio", slug: "calcio", count: 450 },
        { name: "Tennis", slug: "tennis", count: 120 },
        { name: "Pallacanestro", slug: "basket", count: 80 },
        { name: "Sci", slug: "calcio", count: 30 },
        { name: "Football Americano", slug: "football-americano", count: 20 },
        { name: "Biathlon", slug: "calcio", count: 10 },
        { name: "Rugby", slug: "rugby", count: 15 },
        { name: "Hockey", slug: "hockey", count: 40 },
      ];

  // Featured sports for promo row (top 3 with most events)
  const featuredSports = topSports.slice(0, 3);

  // Live fallback
  const displayLive = liveSports.length > 0
    ? liveSports.slice(0, 3)
    : [
        { name: "Tennis", slug: "tennis", count: 0 },
        { name: "Table Tennis", slug: "tennis-tavolo", count: 0 },
        { name: "Football", slug: "calcio", count: 0 },
      ];

  return (
    <div className="flex flex-col h-full" style={{ padding: 16, gap: 0 }}>
      {/* ═══ MAIN CONTENT: Left + Right columns ═══ */}
      <div className="flex flex-1 min-h-0" style={{ gap: 16 }}>

        {/* ═══ LEFT COLUMN (fills remaining = ~80%) ═══ */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0" style={{ gap: 16 }}>

          {/* Row 1: PROMO (2/6 height) — PromoPanel(40%) + FeaturedPanel(60%) */}
          <div className="flex min-h-0" style={{ flex: "2 0 0%", gap: 16 }}>
            {/* HomePromoPanel — 40% width, GlassSwipePanel carousel */}
            <div style={{ width: "40%", flexShrink: 0 }}>
              <PromoCarousel />
            </div>
            {/* HomeFeaturedPanel — 60% width, GlassSwipePanel carousel */}
            <div className="flex-1 min-w-0">
              <FeaturedCarousel sports={featuredSports} />
            </div>
          </div>

          {/* Row 2: COMPETITIONS (1/6 height) */}
          <div className="min-h-0" style={{ flex: "1 0 0%" }}>
            <CompetitionCarousel items={COMPETITION_ITEMS} />
          </div>

          {/* Row 3: SPORTS (1/6 height) */}
          <div className="min-h-0" style={{ flex: "1 0 0%" }}>
            <SportsCarousel sports={topSports.slice(0, 7)} />
          </div>

          {/* Row 4: VIRTUAL (2/6 height) — VsportsPanel(fill) + KenoPanel(20%root) */}
          <div className="flex min-h-0" style={{ flex: "2 0 0%", gap: 16 }}>
            {/* HomeVsportsPanel — fills remaining */}
            <div className="flex-1 min-w-0">
              <VsportsPanel />
            </div>
            {/* HomeKenoPanel — 20% of root width */}
            <div style={{ width: "20%" }}>
              <KenoPanel />
            </div>
          </div>
        </div>

        {/* ═══ RIGHT COLUMN (20% of root width) ═══ */}
        <div className="flex flex-col min-h-0" style={{ width: "20%", gap: 16 }}>
          {/* HomeCouponPanel — 2/6 height */}
          <div className="min-h-0" style={{ flex: "2 0 0%" }}>
            <CouponPanel items={COUPON_ITEMS} />
          </div>
          {/* HomeFeaturedLivePanel — fills remaining (4/6) */}
          <div className="min-h-0" style={{ flex: "4 0 0%" }}>
            <FeaturedLivePanel liveSports={displayLive} />
          </div>
        </div>
      </div>

      {/* ═══ ACCREDITATIONS — max 140px ═══ */}
      <Accreditations />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   GLASS PANEL — exact from QML: rgba(128,128,128,0.1) bg, rgba(255,255,255,0.2) border
   ═══════════════════════════════════════════════════════════════════════════ */

function GlassPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[0px] overflow-hidden ${className}`}
      style={{
        background: "rgba(128,128,128,0.1)",
        border: "1px solid rgba(255,255,255,0.2)",
      }}
    >
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE DOTS — 8x8px, active #b30013, inactive white
   ═══════════════════════════════════════════════════════════════════════════ */

function PageDots({ count, active }: { count: number; active: number }) {
  return (
    <div className="flex justify-center items-center" style={{ gap: 6, height: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: i === active ? "#b30013" : "white",
          }}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROMO CAROUSEL — GlassSwipePanel with promo images, auto-carousel 10s
   ═══════════════════════════════════════════════════════════════════════════ */

function PromoCarousel() {
  const promoImages = [
    "/midas/sport/promo1.png",
    "/midas/sport/football.png",
    "/midas/sport/tennis.png",
  ];
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentPage((p) => (p + 1) % promoImages.length);
    }, 10000);
    return () => clearInterval(timer);
  }, [promoImages.length]);

  return (
    <div className="h-full flex flex-col">
      <GlassPanel className="flex-1 min-h-0">
        <div className="w-full h-full relative overflow-hidden" style={{ margin: 8 }}>
          {promoImages.map((src, i) => (
            <div
              key={i}
              className="absolute inset-0 transition-opacity duration-500"
              style={{ opacity: i === currentPage ? 1 : 0 }}
            >
              <img
                src={src}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = getMidasSportHero("calcio");
                }}
              />
            </div>
          ))}
        </div>
      </GlassPanel>
      <PageDots count={promoImages.length} active={currentPage} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEATURED CAROUSEL — HomeFeaturedButton items in GlassSwipePanel
   Each: hero image + sport icon overlay + sportText + compText + eventsText
   ═══════════════════════════════════════════════════════════════════════════ */

function FeaturedCarousel({ sports }: { sports: { name: string; slug: string; count: number }[] }) {
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentPage((p) => (p + 1) % Math.max(1, Math.ceil(sports.length / 3)));
    }, 10000);
    return () => clearInterval(timer);
  }, [sports.length]);

  // Show 3 items per page (from QML: homeFeaturedModel.pageSize())
  const pageSize = 3;
  const pages = Math.ceil(sports.length / pageSize);
  const pageItems = sports.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  return (
    <div className="h-full flex flex-col">
      <GlassPanel className="flex-1 min-h-0">
        <div className="w-full h-full flex" style={{ padding: 8, gap: 8 }}>
          {pageItems.map((sport) => (
            <HomeFeaturedButton key={sport.slug} sport={sport} />
          ))}
        </div>
      </GlassPanel>
      <PageDots count={pages} active={currentPage} />
    </div>
  );
}

function HomeFeaturedButton({ sport }: { sport: { name: string; slug: string; count: number } }) {
  const sportColor = MIDAS_SPORT_COLORS[sport.slug] || "rgb(141,198,63)";

  return (
    <div className="flex-1 relative overflow-hidden rounded-[4px] cursor-pointer min-w-0">
      {/* Hero background image */}
      <img
        src={getMidasSportHero(sport.slug)}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)" }} />

      {/* Sport icon overlay (top-right) */}
      <div className="absolute top-[8px] right-[8px] z-[2] opacity-70">
        <img src={getMidasSportIcon(sport.slug, "white")} alt="" className="w-[20px] h-[20px]" />
      </div>

      {/* Tag — yellow band at top (tagWidth: 130 from QML) */}
      <div
        className="absolute top-0 left-0 z-[2] flex items-center justify-center"
        style={{ width: 130, height: 20, background: sportColor }}
      >
        <span
          className="text-white font-bold uppercase"
          style={{ fontSize: 14, fontFamily: "'Open Sans', sans-serif" }}
        >
          {sport.name}
        </span>
      </div>

      {/* Bottom text */}
      <div className="absolute bottom-0 left-0 right-0 p-[8px] z-[2]">
        <div
          className="text-white font-bold uppercase leading-tight"
          style={{ fontSize: 16, fontFamily: "'Open Sans', sans-serif" }}
        >
          {sport.count} Events
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPETITION CAROUSEL — HomeSportButton items: top 60% = icon, bottom 40% = color + text
   7 items per page in GlassSwipePanel (from QML homeCompetitionModel.pageSize())
   ═══════════════════════════════════════════════════════════════════════════ */

function CompetitionCarousel({ items }: { items: typeof COMPETITION_ITEMS }) {
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 7;
  const pages = Math.ceil(items.length / pageSize);
  const pageItems = items.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  useEffect(() => {
    if (pages <= 1) return;
    const timer = setInterval(() => setCurrentPage((p) => (p + 1) % pages), 10000);
    return () => clearInterval(timer);
  }, [pages]);

  return (
    <div className="h-full flex flex-col">
      <GlassPanel className="flex-1 min-h-0">
        <div className="w-full h-full flex" style={{ padding: 8, gap: 8 }}>
          {pageItems.map((comp) => (
            <HomeSportButton
              key={comp.label}
              icon={comp.icon}
              text={comp.label}
              colour={comp.colour}
              hasImage={false}
              regionIcon={comp.flag}
            />
          ))}
        </div>
      </GlassPanel>
      <PageDots count={pages} active={currentPage} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPORT BUTTON — from QML HomeSportButton.qml
   top 60% = icon/image area (white bg), bottom 40% = sport colour band + text
   ═══════════════════════════════════════════════════════════════════════════ */

function HomeSportButton({
  icon, text, colour, hasImage = true, img, regionIcon, iconScale = 1, fontSize = 12, showLive = false,
}: {
  icon: string; text: string; colour: string; hasImage?: boolean; img?: string;
  regionIcon?: string; iconScale?: number; fontSize?: number; showLive?: boolean;
}) {
  const topPct = 60; // topHeight: height * 0.6
  const bottomPct = 40; // bottomHeight: height - topHeight - 2

  return (
    <div className="flex-1 flex flex-col overflow-hidden rounded-[4px] cursor-pointer relative min-w-0 min-h-0">
      {/* Top section — 60% height */}
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{ height: `${topPct}%`, background: hasImage ? "transparent" : "white" }}
      >
        {hasImage && img && (
          <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        {/* Competition/sport icon */}
        <img
          src={icon}
          alt={text}
          className="relative z-[1] object-contain"
          style={{ maxHeight: "70%", maxWidth: "70%", transform: `scale(${iconScale})` }}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
        {/* Flag overlay (top-right corner) */}
        {regionIcon && (
          <img
            src={regionIcon}
            alt=""
            className="absolute top-[3px] right-[3px] z-[2] object-contain"
            style={{ width: 18, height: 12 }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
        {/* LIVE badge — yellow 40x20 pill */}
        {showLive && (
          <div
            className="absolute top-[8px] right-[8px] z-[3] flex items-center justify-center"
            style={{ width: 40, height: 20, background: "yellow", borderRadius: 10 }}
          >
            <span style={{ color: "black", fontWeight: "bold", fontSize: 16, fontFamily: "'Open Sans', sans-serif", textTransform: "capitalize" }}>
              LIVE
            </span>
          </div>
        )}
      </div>
      {/* Bottom section — 40% height, sport colour band */}
      <div
        className="flex items-center justify-center"
        style={{ height: `${bottomPct}%`, background: colour, borderTop: "2px solid rgba(0,0,0,0.15)" }}
      >
        <span
          className="text-white font-bold uppercase text-center leading-tight px-[2px]"
          style={{ fontSize, fontFamily: "'Open Sans', sans-serif" }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SPORTS CAROUSEL — HomeCouponButton-style items (gradient buttons with sport icons)
   ═══════════════════════════════════════════════════════════════════════════ */

function SportsCarousel({ sports }: { sports: { name: string; slug: string; count?: number }[] }) {
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 7;
  const pages = Math.ceil(sports.length / pageSize);
  const pageItems = sports.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  useEffect(() => {
    if (pages <= 1) return;
    const timer = setInterval(() => setCurrentPage((p) => (p + 1) % pages), 10000);
    return () => clearInterval(timer);
  }, [pages]);

  return (
    <div className="h-full flex flex-col">
      <GlassPanel className="flex-1 min-h-0">
        <div className="w-full h-full flex" style={{ padding: 8, gap: 8 }}>
          {pageItems.map((sport) => (
            <HomeCouponButton
              key={sport.slug}
              icon={getMidasSportIcon(sport.slug, "black")}
              text={sport.name}
            />
          ))}
        </div>
      </GlassPanel>
      <PageDots count={pages} active={currentPage} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   COUPON BUTTON — exact gradient from QML HomeCouponButton.qml
   gradient: #eeeeee → #cecece → #c5c5c5 → #bbbbbb
   icon: 60x60 centered, text: "Open Sans" bold 15px black, textTop: 45
   ═══════════════════════════════════════════════════════════════════════════ */

function HomeCouponButton({ icon, text, img, iconAboveImg = false }: {
  icon: string; text: string; img?: string; iconAboveImg?: boolean;
}) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center overflow-hidden rounded-[4px] cursor-pointer relative min-w-0 min-h-0"
      style={{
        background: "linear-gradient(to bottom, #eeeeee 0%, #cecece 50%, #c5c5c5 51%, #bbbbbb 100%)",
      }}
    >
      {/* Background image (optional) */}
      {img && !iconAboveImg && (
        <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
      )}
      {/* Icon — 60x60 centered */}
      <img
        src={icon}
        alt={text}
        style={{ width: 60, height: 60 }}
        className="object-contain relative z-[1]"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />
      {/* Text — offset by textTop: 45 from center */}
      <span
        className="relative z-[1] text-black font-bold text-center leading-tight mt-[4px]"
        style={{ fontSize: 15, fontFamily: "'Open Sans', sans-serif" }}
      >
        {text}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   VSPORTS PANEL — horizontal ListView of HomeSportButton items
   from QML: maxWidth 155, topHeight 70%, iconScale 0.5, fontSize 12
   ═══════════════════════════════════════════════════════════════════════════ */

function VsportsPanel() {
  const vsports = [
    { name: "Football", icon: "/midas/svg/sports/white/football.svg", img: "/midas/sport/football.png", colour: "rgb(141,198,63)" },
    { name: "Motor Racing", icon: "/midas/svg/sports/white/formula1.svg", img: "/midas/sport/formula1.png", colour: "rgb(215,25,32)" },
  ];

  return (
    <GlassPanel className="h-full">
      <div className="w-full h-full flex" style={{ padding: 8, gap: 8 }}>
        {vsports.map((sport) => (
          <div key={sport.name} className="flex-1 flex flex-col overflow-hidden rounded-[4px] cursor-pointer min-w-0 min-h-0" style={{ maxWidth: 155 }}>
            {/* Top 70% — hero image + icon overlay */}
            <div className="relative flex items-center justify-center overflow-hidden" style={{ height: "70%" }}>
              <img src={sport.img} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/30" />
              <img
                src={sport.icon}
                alt=""
                className="relative z-[1] object-contain"
                style={{ maxHeight: "50%", maxWidth: "50%", transform: "scale(0.5)" }}
              />
            </div>
            {/* Bottom 30% — colour band */}
            <div
              className="flex items-center justify-center"
              style={{ height: "30%", background: sport.colour, borderTop: "2px solid rgba(0,0,0,0.15)" }}
            >
              <span
                className="text-white font-bold uppercase text-center leading-tight"
                style={{ fontSize: 12, fontFamily: "'Open Sans', sans-serif" }}
              >
                {sport.name}
              </span>
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   KENO PANEL — vertical ListView of HomeCouponButton items (iconAboveImg)
   from QML HomeKenoModel: height = (viewHeight / itemCount) - 5
   ═══════════════════════════════════════════════════════════════════════════ */

function KenoPanel() {
  const items = [
    { name: "Lotterie", icon: "/midas/svg/offer/colour/lottery.svg", img: "/midas/svg/offer/flat/lottery.svg" },
    { name: "Keno", icon: "/midas/svg/offer/colour/keno.svg", img: "/midas/svg/offer/flat/keno.svg" },
  ];

  return (
    <GlassPanel className="h-full">
      <div className="w-full h-full flex flex-col" style={{ padding: 8, gap: 8 }}>
        {items.map((item) => (
          <HomeCouponButton key={item.name} icon={item.icon} text={item.name} iconAboveImg />
        ))}
      </div>
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   COUPON PANEL (right column top) — vertical ListView of HomeCouponButton
   from QML HomeCouponModel: height = (viewHeight / itemCount) - 5
   ═══════════════════════════════════════════════════════════════════════════ */

function CouponPanel({ items }: { items: { label: string; icon: string }[] }) {
  return (
    <GlassPanel className="h-full">
      <div className="w-full h-full flex flex-col" style={{ padding: 8, gap: 8 }}>
        {items.map((item) => (
          <HomeCouponButton key={item.label} icon={item.icon} text={item.label} />
        ))}
      </div>
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEATURED LIVE PANEL (right column bottom) — vertical ListView of HomeSportButton
   from QML HomeSportBasicLive: topHeight 60%, bottomHeight 40%, iconScale 0.6
   LIVE badge: yellow Rectangle 40x20, radius 10, "LIVE" black bold 16px
   ═══════════════════════════════════════════════════════════════════════════ */

function FeaturedLivePanel({ liveSports }: { liveSports: { name: string; slug: string; count: number }[] }) {
  return (
    <GlassPanel className="h-full">
      <div className="w-full h-full flex flex-col" style={{ padding: 8, gap: 8 }}>
        {liveSports.map((sport) => (
          <HomeSportButton
            key={sport.slug}
            icon={getMidasSportIcon(sport.slug, "white")}
            img={getMidasSportHero(sport.slug)}
            text={sport.name}
            colour={MIDAS_SPORT_COLORS[sport.slug] || "rgb(141,198,63)"}
            hasImage
            iconScale={0.6}
            fontSize={16}
            showLive
          />
        ))}
      </div>
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACCREDITATIONS — footer bar, max 140px from QML
   ═══════════════════════════════════════════════════════════════════════════ */

function Accreditations() {
  return (
    <footer
      className="flex items-center justify-between flex-shrink-0 px-[8px]"
      style={{ height: 32, maxHeight: 140, background: "#000000", borderTop: "1px solid #333", marginTop: 8 }}
    >
      {/* Left: info + logos */}
      <div className="flex items-center" style={{ gap: 8 }}>
        <div className="flex items-center justify-center rounded-full" style={{ width: 16, height: 16, background: "#d0141c" }}>
          <span className="text-white font-bold" style={{ fontSize: 9 }}>i</span>
        </div>
        <img src="/midas/accreditations/Icon_18+.png" alt="18+" style={{ height: 18 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <img src="/midas/accreditations/Icon_MGA.png" alt="MGA" style={{ height: 16 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <img src="/midas/accreditations/Icon_Ibia.png" alt="IBIA" style={{ height: 16 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <img src="/midas/accreditations/Icon_BGC.png" alt="BGC" style={{ height: 16 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <img src="/midas/accreditations/Icon_Gamble.png" alt="BeGambleAware" style={{ height: 14 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      </div>

      {/* Center: disclaimer text */}
      <div
        className="text-center leading-tight"
        style={{ fontSize: 6, color: "#888", maxWidth: "45%", fontFamily: "'Open Sans Condensed', sans-serif" }}
      >
        Class 1 on 4 MGA Remote Gaming Licence Number MGA / CL1 / 945 / 2013 &middot; Tutte le operazioni sono regolate dalla Malta Gaming Authority
      </div>

      {/* Right: Regolamento button */}
      <button
        className="bg-transparent border cursor-pointer uppercase"
        style={{
          borderColor: "#555", color: "#aaa", padding: "3px 8px",
          borderRadius: 3, fontSize: 8, fontFamily: "'Open Sans Condensed', sans-serif",
        }}
      >
        Regolamento
      </button>
    </footer>
  );
}
