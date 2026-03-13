import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// ═══ GET — Market Translation Report ═══
// Shows all distinct market_type values, whether they're Italian or English,
// and if they match any settlement pattern.

// Known Italian patterns (settlement-compatible)
const ITALIAN_PATTERNS = [
  /^1X2(\s|$)/, /^U\/O(\s|$)/, /^GG\/NG/, /^DC(\s|$)/, /^P\/D$/,
  /^Pari\/Dispari/, /^Risultato Esatto/, /^Handicap/, /^Draw No Bet/,
  /^Vincente/, /^Testa a Testa/, /^Rete Inviolata/, /^Vincente A 0/,
  /^Parziale\/Finale/, /^Tempo Con/, /^Tempi Supplementari/,
  /^Passaggio Turno/, /^Prima Squadra/, /^Marcatore/, /^Primo Marcatore/,
  /^Ultimo Marcatore/, /^Tripletta/, /^Doppietta/, /^Multigol/,
  /^Somma Gol/, /^Set Betting/, /^Numero Esatto/, /^T\/T/,
  /^Tiebreak/, /^Gol In Entrambi/, /^Vince .+ Tempo/,
  /^Ribaltone/, /^Autorete/, /^Gol Nei Primi/, /^Squadra .+ Segna/,
  /^1X2 Corner/, /^U\/O Corner/, /^DC Corner/, /^Fascia Corner/,
  /^Gara A \d+ Corner/, /^Handicap Corner/, /^Handicap Asiatico/,
  /^1X2 Handicap/, /^1X2 \d+° Tempo/, /^U\/O \d+° Tempo/,
  /^DC \d+° Tempo/, /^GG\/NG \d+° Tempo/, /^Pari\/Dispari \d+° Tempo/,
  /^Risultato Esatto \d+° Tempo/, /^Multigol \d+° Tempo/,
  /^U\/O Casa/, /^U\/O Ospite/, /^U\/O Incl/, /^U\/O Games/,
  /^U\/O Giochi/, /^Pari\/Dispari Casa/, /^Pari\/Dispari Ospite/,
  /^Pari\/Dispari Games/, /^Pari\/Dispari Set/, /^Pari\/Dispari Incl/,
  /^1X2 \+ /, /^DC \+ /, /^GG\/NG \+ /, /^Combo/,
  /^1X2 \d+ Minuti/,
  // ── Period/Quarter/Tempo ──
  /\d°\s*Periodo/, /\d°\s*Quarto/,
  /^Handicap \d°\s*Tempo/,
  /^Handicap Punti/,
  // ── Props varie tradotte ──
  /^Metodo Primo Gol/, /^Tempo Primo Gol/, /^Rigore/,
  /^Numero Esatto Gol/, /^Squadra Segna Gol/,
  /^Quarto Con Più Punti/, /^Falli Totali/, /^Rinvii Dal Fondo/,
  // ── Tennis ──
  /^Entrambi Vincono Un Set/, /^G\d Vince Almeno/,
  /^Handicap Set/, /^U\/O Set/, /^U\/O Games G\d/,
  /^Vincente Set \d+/, /^Gara A \d+ Games/,
  /^Deuce\s/, /^In Vantaggio Dopo/,
  /^Risultato Esatto \(Best Of/,
  // ── Esports ──
  /^Vincente Mappa/, /^U\/O Mappe/, /^Vincente Incontro \+ Vincente Mappa/,
  // ── Hockey ──
  /^Power Play/, /Gol PP/, /^Risultato Gol PP/,
  // ── Player props tradotte ──
  /Tiri In Porta/, /Tiri Totali/, /Tiri Di Testa/,
  /Tiri (Sinistro|Destro)/, /Passaggi Completati/,
  /Contrasti Difensivi/, /\bAssist$/, /\bFalli$/,
  /\bParate$/, /\bRespinte$/, /\bFuorigioco$/, /\bCross$/,
  // ── Cartellini ──
  /Cartellini/,
  // ── Corner/Gol props ──
  /^Primo Corner/, /^Espulsione/, /^Marcatore 2\+/,
  /^Primo Marcatore (Casa|Ospite)/, /^Marcatore (Piede|Di Testa|Fuori)/,
  /^Gara A \d+ Gol/, /^Mappa \d+:/, /^1X2 Mappa/,
  // ── Baseball/Basket ──
  /^Handicap Runs/, /^U\/O Runs/, /^Handicap Punti/,
  // ── Varie ──
  /^Vince Entrambi/, /^Entrambi Tempi/,
  /^Vincente (Casa|Ospite)/, /^Squadra Segna Gol/,
  /^U\/O G\d/, /^Handicap Set/,
];

function isItalian(marketType: string): boolean {
  return ITALIAN_PATTERNS.some(p => p.test(marketType));
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const source = sp.get("source") || "leon";

  const supabase = createAdminClient();

  // Get all distinct active market types with counts
  const { data, error } = await supabase.rpc("get_market_type_stats", {
    p_source: source,
  });

  if (error) {
    // Fallback: raw query if RPC doesn't exist
    const { data: rawData, error: rawErr } = await supabase
      .from("markets")
      .select("market_type, event_id, events!inner(source)")
      .eq("is_active", true)
      .eq("events.source", source)
      .limit(10000);

    if (rawErr) {
      return NextResponse.json({ error: rawErr.message }, { status: 500 });
    }

    // Aggregate manually
    const counts: Record<string, number> = {};
    for (const row of rawData || []) {
      counts[row.market_type] = (counts[row.market_type] || 0) + 1;
    }

    const markets = Object.entries(counts)
      .map(([type, count]) => ({
        market_type: type,
        count,
        is_italian: isItalian(type),
      }))
      .sort((a, b) => b.count - a.count);

    const totalTypes = markets.length;
    const italianTypes = markets.filter(m => m.is_italian).length;
    const englishTypes = totalTypes - italianTypes;
    const totalMarkets = markets.reduce((s, m) => s + m.count, 0);
    const italianMarkets = markets.filter(m => m.is_italian).reduce((s, m) => s + m.count, 0);

    return NextResponse.json({
      source,
      total_types: totalTypes,
      italian_types: italianTypes,
      english_types: englishTypes,
      total_markets: totalMarkets,
      italian_markets: italianMarkets,
      coverage_pct: totalMarkets > 0 ? Math.round((italianMarkets / totalMarkets) * 100) : 0,
      markets,
    });
  }

  // RPC path
  const markets = (data || []).map((row: any) => ({
    ...row,
    is_italian: isItalian(row.market_type),
  }));

  const totalTypes = markets.length;
  const italianTypes = markets.filter((m: any) => m.is_italian).length;
  const totalMarkets = markets.reduce((s: number, m: any) => s + (m.count || 0), 0);
  const italianMarkets = markets.filter((m: any) => m.is_italian).reduce((s: number, m: any) => s + (m.count || 0), 0);

  return NextResponse.json({
    source,
    total_types: totalTypes,
    italian_types: italianTypes,
    english_types: totalTypes - italianTypes,
    total_markets: totalMarkets,
    italian_markets: italianMarkets,
    coverage_pct: totalMarkets > 0 ? Math.round((italianMarkets / totalMarkets) * 100) : 0,
    markets,
  });
}
