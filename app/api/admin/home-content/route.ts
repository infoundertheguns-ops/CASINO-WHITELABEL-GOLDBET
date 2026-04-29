export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET — list all items grouped by section
export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("home_content")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const grouped: Record<string, any[]> = {
    hero_banners: [], leagues: [], sport_tiles: [], virtual_cards: [], live_sidebar: [],
  };
  for (const item of data || []) {
    if (grouped[item.section]) grouped[item.section].push(item);
  }
  return NextResponse.json(grouped);
}

// POST — create item (E5 Phase 2: accepts title_en, published_from/until)
export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  const body = await req.json();
  const {
    section, title, title_en, image_url, icon_url, flag_url, href, accent_color,
    is_wide, sort_order, published_from, published_until,
  } = body;

  if (!section || !title) {
    return NextResponse.json({ error: "section e title obbligatori" }, { status: 400 });
  }

  let order = sort_order ?? 0;
  if (sort_order === undefined) {
    const { data: maxItem } = await supabase
      .from("home_content")
      .select("sort_order")
      .eq("section", section)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    order = (maxItem?.sort_order ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("home_content")
    .insert({
      section, title, title_en: title_en ?? null,
      image_url, icon_url, flag_url, href, accent_color,
      is_wide: is_wide ?? false, sort_order: order,
      published_from: published_from ?? null,
      published_until: published_until ?? null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data }, { status: 201 });
}
