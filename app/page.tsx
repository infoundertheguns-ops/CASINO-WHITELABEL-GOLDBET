import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
  }

  // Landing page for non-authenticated users
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="max-w-[430px] mx-auto px-4 py-6">
          {/* Logo */}
          <div className="flex items-center gap-1.5 mb-10">
            <span className="text-[#e8611c] text-2xl">♦</span>
            <span className="text-xl font-light tracking-wider">
              vinc<span className="text-[#e8611c] font-normal">i</span>tu
            </span>
          </div>

          <h1 className="text-3xl font-black tracking-tight mb-3">
            Scommesse.<br />Casino.<br />
            <span className="text-[#e8611c]">Crypto.</span>
          </h1>
          <p className="text-gray-400 text-sm mb-8">
            La piattaforma all-in-one per scommesse sportive, casino e pagamenti crypto.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <a
              href="/register"
              className="py-3 rounded-xl bg-[#e8611c] text-center font-bold text-sm"
            >
              Registrati
            </a>
            <a
              href="/login"
              className="py-3 rounded-xl bg-white/10 border border-white/20 text-center font-bold text-sm"
            >
              Accedi
            </a>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-[430px] mx-auto px-4 py-8 space-y-6">
        {[
          { icon: "⚽", title: "Scommesse Live", desc: "Quote competitive su calcio, basket, tennis e 25+ sport" },
          { icon: "🎰", title: "Casino & Live Dealer", desc: "1,000+ giochi da Pragmatic, Evolution, Hacksaw e altri" },
          { icon: "₿", title: "Pagamenti Crypto", desc: "Deposita e preleva in BTC, ETH, USDT, SOL istantaneamente" },
          { icon: "🎁", title: "Bonus & Tornei", desc: "Bonus benvenuto, free spins, free bet e slot tournament" },
        ].map((f, i) => (
          <div key={i} className="flex gap-4 items-start">
            <span className="text-2xl mt-0.5">{f.icon}</span>
            <div>
              <div className="text-sm font-bold text-gray-900">{f.title}</div>
              <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="text-center py-6 text-xs text-gray-400">
        © 2026 VinciTu. 18+ Gioca responsabilmente.
      </div>
    </div>
  );
}
