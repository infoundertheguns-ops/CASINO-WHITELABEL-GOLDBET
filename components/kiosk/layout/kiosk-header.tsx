"use client";

/* Header — 40px alto, colori esatti da UIData.xml HeaderBarView
   Layout: [☰] [Stanleybet logo | MIDAS]  [🔍]  [✉50] [ACCREDITA] [PAGARE] [0.00] [👁]
*/

export default function KioskHeader() {
  return (
    <header
      className="flex items-center justify-between flex-shrink-0 px-[8px]"
      style={{ height: "40px", background: "#d0141c" }}
    >
      {/* Left: Hamburger + Logo + MIDAS */}
      <div className="flex items-center gap-[8px]">
        {/* Hamburger */}
        <div className="flex flex-col justify-center gap-[3px] w-[20px] h-[20px] cursor-pointer">
          <span className="block w-[16px] h-[2px] bg-white rounded-sm" />
          <span className="block w-[16px] h-[2px] bg-white rounded-sm" />
          <span className="block w-[16px] h-[2px] bg-white rounded-sm" />
        </div>

        {/* Stanleybet Logo */}
        <img
          src="/midas/svg/Stanleybet-logo-2022-WHITE.svg"
          alt="Stanleybet"
          className="h-[20px] w-auto"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = "flex";
          }}
        />
        <div className="hidden items-center gap-1 text-white font-bold text-[13px]" style={{ fontFamily: "'Open Sans', sans-serif" }}>
          <span className="inline-flex items-center justify-center w-[14px] h-[14px] border-2 border-white rounded-full text-[8px] font-bold">S</span>
          Stanleybet
        </div>

        {/* Separator + MIDAS */}
        <div
          className="text-white text-[16px] font-bold italic uppercase tracking-[2px] border-l border-white/40 pl-[8px]"
          style={{ fontFamily: "'Open Sans', sans-serif" }}
        >
          MIDAS
        </div>
      </div>

      {/* Center: Search field (placeholder) */}
      <div
        className="w-[100px] h-[22px] rounded-[3px] flex items-center px-[6px]"
        style={{ background: "rgba(0,0,0,0.25)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>

      {/* Right: Messages + Buttons + Balance + Eye */}
      <div className="flex items-center gap-[6px]">
        {/* Message icon with badge */}
        <div className="relative w-[24px] h-[24px] flex items-center justify-center cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
          <span className="absolute -top-[2px] -right-[2px] bg-white text-[#d0141c] text-[7px] font-bold px-[3px] py-[1px] rounded-full min-w-[14px] text-center leading-none">
            50
          </span>
        </div>

        {/* ACCREDITA — outlined white */}
        <button
          className="px-[10px] py-[4px] border border-white bg-transparent text-white font-bold uppercase text-[9px] rounded-[3px] cursor-pointer"
          style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}
        >
          ACCREDITA
        </button>

        {/* PAGARE — filled darker */}
        <button
          className="px-[10px] py-[4px] border border-white text-white font-bold uppercase text-[9px] rounded-[3px] cursor-pointer"
          style={{ background: "rgba(255,255,255,0.15)", fontFamily: "'Open Sans Condensed', sans-serif" }}
        >
          PAGARE
        </button>

        {/* Balance */}
        <span
          className="text-white font-bold text-[12px] min-w-[30px] text-right"
          style={{ fontFamily: "'Open Sans Condensed', sans-serif" }}
        >
          0.00
        </span>

        {/* Eye icon */}
        <div className="w-[20px] h-[20px] flex items-center justify-center cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
      </div>
    </header>
  );
}
