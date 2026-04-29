"use client";

// E5 — Home CMS modernization (MVP, frontend-only, no DB migrations).
// Added in this iteration:
//  - Drag & drop reorder via @dnd-kit/sortable (replaces ▲/▼ buttons).
//  - Upload preview pre-upload (FileReader.readAsDataURL) with kind hints.
//  - Size hints per tipo: hero 1920×600, tile 96×96, flag 64×64.
//  - Aspect-ratio warning non-bloccante dopo upload.
//  - Href autocomplete (datalist) con route note del player.
//  - Accent color preview inline sulla tile e nel form.
//  - Tab Live Sidebar: tooltip help icon con descrizione.
//  - Conteggio tab: "(N tot / K attivi)".
//  - "Apri home player" link in nuovo tab (env NEXT_PUBLIC_PLAYER_URL fallback).
// Deferred: scheduling, versioning/history, i18n title, link health, audit log, orphan mgmt.

import { useEffect, useState, useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface HomeContentItem {
  id: string;
  section: string;
  title: string;
  title_en?: string | null;
  image_url?: string | null;
  icon_url?: string | null;
  flag_url?: string | null;
  href?: string | null;
  accent_color?: string | null;
  is_wide?: boolean;
  sort_order: number;
  is_active: boolean;
  published_from?: string | null;
  published_until?: string | null;
  link_status?: "ok" | "broken" | "unknown" | null;
  link_checked_at?: string | null;
  created_at: string;
}

interface HistoryEntry {
  history_id: number;
  action: string;
  changed_at: string;
  changed_by: string | null;
  snapshot: any;
}

type SectionKey = "hero_banners" | "leagues" | "sport_tiles" | "virtual_cards" | "live_sidebar";

const TABS: { label: string; key: SectionKey; help?: string }[] = [
  { label: "Banner Hero",  key: "hero_banners", help: "Slider di banner in alto sulla homepage player." },
  { label: "Leghe",        key: "leagues", help: "Tile leghe featured con icona + bandiera." },
  { label: "Sport",        key: "sport_tiles", help: "Tile sport primari sulla homepage." },
  { label: "Virtual",      key: "virtual_cards", help: "Card sport virtuali (roulette, cani, ecc.)." },
  { label: "Live Sidebar", key: "live_sidebar", help: "Sidebar visibile durante il live streaming eventi." },
];

interface FormData {
  title: string;
  title_en: string;
  image_url: string;
  icon_url: string;
  flag_url: string;
  href: string;
  accent_color: string;
  is_wide: boolean;
  published_from: string;
  published_until: string;
}

const emptyForm: FormData = {
  title: "",
  title_en: "",
  image_url: "",
  icon_url: "",
  flag_url: "",
  href: "",
  accent_color: "#8b5cf6",
  is_wide: false,
  published_from: "",
  published_until: "",
};

// E5: recommended sizes per field/section.
const SIZE_HINTS: Record<string, { w: number; h: number; tolerance: number; label: string }> = {
  "hero_banners.image_url":   { w: 1920, h: 600, tolerance: 0.15, label: "Consigliato 1920×600 (banner wide, 16:5 ≈ 3.2:1)" },
  "live_sidebar.image_url":   { w: 400,  h: 600, tolerance: 0.2,  label: "Consigliato 400×600 (sidebar verticale, 2:3)" },
  "sport_tiles.icon_url":     { w: 96,   h: 96,  tolerance: 0.1,  label: "Consigliato 96×96 (quadrato, 1:1)" },
  "virtual_cards.icon_url":   { w: 96,   h: 96,  tolerance: 0.1,  label: "Consigliato 96×96 (quadrato, 1:1)" },
  "leagues.icon_url":         { w: 96,   h: 96,  tolerance: 0.1,  label: "Consigliato 96×96 (logo lega, 1:1)" },
  "live_sidebar.icon_url":    { w: 96,   h: 96,  tolerance: 0.1,  label: "Consigliato 96×96 (quadrato, 1:1)" },
  "leagues.flag_url":         { w: 64,   h: 64,  tolerance: 0.15, label: "Consigliato 64×64 (bandiera paese, 1:1)" },
};

// Known player routes for href autocomplete.
const KNOWN_ROUTES = [
  "/sport",
  "/live",
  "/casino",
  "/promo",
  "/wallet",
  "/account",
  "/sport?sport=calcio",
  "/sport?sport=tennis",
  "/sport?sport=basketball",
  "/sport?sport=hockey",
  "/sport?league=serie-a",
  "/sport?league=premier-league",
  "/sport?league=champions-league",
  "/virtual",
  "/ippica",
];

function playerUrl(): string {
  return process.env.NEXT_PUBLIC_PLAYER_URL || "https://play.betssolution.com";
}

// Convert ISO UTC timestamp to value expected by <input type="datetime-local">.
function toLocalDT(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Shift for local TZ so the picker shows the local time.
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export default function HomeContentPage() {
  const [items, setItems] = useState<Record<SectionKey, HomeContentItem[]>>({
    hero_banners: [],
    leagues: [],
    sport_tiles: [],
    virtual_cards: [],
    live_sidebar: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<SectionKey>("hero_banners");

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<Record<string, string | null>>({});
  const [uploadWarning, setUploadWarning] = useState<Record<string, string | null>>({});

  // File upload refs
  const imageFileRef = useRef<HTMLInputElement>(null);
  const iconFileRef = useRef<HTMLInputElement>(null);
  const flagFileRef = useRef<HTMLInputElement>(null);

  // E5 Phase 2 — history modal + orphan modal state
  const [historyFor, setHistoryFor] = useState<HomeContentItem | null>(null);
  const [orphansOpen, setOrphansOpen] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/home-content");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setItems({
        hero_banners: data.hero_banners || [],
        leagues: data.leagues || [],
        sport_tiles: data.sport_tiles || [],
        virtual_cards: data.virtual_cards || [],
        live_sidebar: data.live_sidebar || [],
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  // Drag & drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // E5: client-side preview before upload + aspect-ratio warning.
  const handleFileChange = async (field: "image_url" | "icon_url" | "flag_url") => {
    const inputRef = field === "image_url" ? imageFileRef : field === "icon_url" ? iconFileRef : flagFileRef;
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    // Local preview
    const previewUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(file);
    });
    setUploadPreview((p) => ({ ...p, [field]: previewUrl }));

    // Aspect-ratio check against hint
    const hint = SIZE_HINTS[`${activeTab}.${field}`];
    if (hint) {
      const img = new Image();
      img.onload = () => {
        const expectedRatio = hint.w / hint.h;
        const actualRatio = img.width / img.height;
        const delta = Math.abs(actualRatio - expectedRatio) / expectedRatio;
        if (delta > hint.tolerance) {
          setUploadWarning((p) => ({
            ...p,
            [field]: `⚠ Aspect ratio ${actualRatio.toFixed(2)}:1 diverso dal consigliato ${expectedRatio.toFixed(2)}:1 (${img.width}×${img.height}). L'upload procederà comunque.`,
          }));
        } else {
          setUploadWarning((p) => ({ ...p, [field]: null }));
        }
      };
      img.src = previewUrl;
    }

    // Kick off upload
    await handleUpload(field, file);
  };

  const handleUpload = async (field: "image_url" | "icon_url" | "flag_url", file: File) => {
    const fd = new window.FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/admin/home-content/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm((prev) => ({ ...prev, [field]: data.url }));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const body: any = {
        title: form.title.trim(),
        title_en: form.title_en.trim() || null,
        section: activeTab,
        published_from: form.published_from || null,
        published_until: form.published_until || null,
      };
      if (activeTab === "hero_banners") {
        body.image_url = form.image_url || null;
        body.href = form.href || null;
        body.is_wide = form.is_wide;
      } else if (activeTab === "leagues") {
        body.icon_url = form.icon_url || null;
        body.flag_url = form.flag_url || null;
        body.href = form.href || null;
      } else if (activeTab === "sport_tiles" || activeTab === "virtual_cards") {
        body.icon_url = form.icon_url || null;
        body.accent_color = form.accent_color || null;
        body.href = form.href || null;
      } else if (activeTab === "live_sidebar") {
        body.image_url = form.image_url || null;
        body.icon_url = form.icon_url || null;
      }

      if (editingId) {
        const res = await fetch(`/api/admin/home-content/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      } else {
        const res = await fetch("/api/admin/home-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
      resetForm();
      loadItems();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setUploadPreview({});
    setUploadWarning({});
  };

  const handleEdit = (item: HomeContentItem) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      title_en: item.title_en || "",
      image_url: item.image_url || "",
      icon_url: item.icon_url || "",
      flag_url: item.flag_url || "",
      href: item.href || "",
      accent_color: item.accent_color || "#8b5cf6",
      is_wide: item.is_wide || false,
      published_from: toLocalDT(item.published_from),
      published_until: toLocalDT(item.published_until),
    });
    setUploadPreview({});
    setUploadWarning({});
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Eliminare questo elemento?")) return;
    setError("");
    try {
      const res = await fetch(`/api/admin/home-content/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadItems();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggleActive = async (item: HomeContentItem) => {
    setItems((prev) => ({
      ...prev,
      [activeTab]: prev[activeTab].map((i) =>
        i.id === item.id ? { ...i, is_active: !i.is_active } : i
      ),
    }));
    try {
      const res = await fetch(`/api/admin/home-content/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      if (!res.ok) {
        setItems((prev) => ({
          ...prev,
          [activeTab]: prev[activeTab].map((i) =>
            i.id === item.id ? { ...i, is_active: item.is_active } : i
          ),
        }));
        const data = await res.json();
        setError(data.error);
      }
    } catch (e: any) {
      setItems((prev) => ({
        ...prev,
        [activeTab]: prev[activeTab].map((i) =>
          i.id === item.id ? { ...i, is_active: item.is_active } : i
        ),
      }));
      setError(e.message);
    }
  };

  // E5: drag & drop handler
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const sectionItems = items[activeTab];
    const oldIndex = sectionItems.findIndex((i) => i.id === active.id);
    const newIndex = sectionItems.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(sectionItems, oldIndex, newIndex).map((it, i) => ({ ...it, sort_order: i }));
    setItems((prev) => ({ ...prev, [activeTab]: reordered }));

    try {
      const res = await fetch("/api/admin/home-content/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: activeTab,
          order: reordered.map((item) => ({ id: item.id, sort_order: item.sort_order })),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error);
        loadItems();
      }
    } catch (err: any) {
      setError(err.message);
      loadItems();
    }
  };

  const currentItems = items[activeTab];
  const activeCount = currentItems.filter((i) => i.is_active).length;
  const currentTab = TABS.find((t) => t.key === activeTab);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Caricamento…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>Home CMS</h2>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Gestisce banner, tile sport e card della homepage player.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setOrphansOpen(true)}
            style={{ padding: "10px 16px", borderRadius: 8, background: "transparent", border: "1px solid var(--admin-border, #1e3a5f)", color: "#94a3b8", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
          >
            🗑 Orfani storage
          </button>
          <a
            href={playerUrl()}
            target="_blank"
            rel="noreferrer"
            style={{ padding: "10px 16px", borderRadius: 8, background: "transparent", border: "1px solid var(--admin-border, #1e3a5f)", color: "#94a3b8", textDecoration: "none", fontSize: 13, fontWeight: 600 }}
          >
            Apri Home Player ↗
          </a>
          <button
            onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(emptyForm); setUploadPreview({}); setUploadWarning({}); }}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
          >
            + Nuovo
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, background: "#ef444420", color: "#ef4444", fontSize: 13 }}>
          {error}
          <button onClick={() => setError("")} aria-label="Chiudi avviso errore" style={{ marginLeft: 12, background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>&#10005;</button>
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {TABS.map((tab) => {
          const total = items[tab.key].length;
          const active = items[tab.key].filter((i) => i.is_active).length;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); resetForm(); }}
              title={tab.help}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: activeTab === tab.key ? "1px solid #8b5cf6" : "1px solid var(--admin-border, #1e3a5f)",
                background: activeTab === tab.key ? "#8b5cf6" : "transparent",
                color: activeTab === tab.key ? "#fff" : "#94a3b8",
                cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.15s",
              }}
            >
              {tab.label}
              <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.75 }}>({total} / {active} attivi)</span>
            </button>
          );
        })}
      </div>

      {/* Tab help banner (E5) */}
      {currentTab?.help && (
        <div style={{ padding: "6px 12px", background: "rgba(139,92,246,0.06)", border: "1px solid #8b5cf633", borderRadius: 8, fontSize: 12, color: "var(--admin-text-muted, #94a3b8)" }}>
          💡 {currentTab.help}
        </div>
      )}

      {/* Create/Edit Form */}
      {showForm && (
        <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--admin-text, #e2e8f0)" }}>
            {editingId ? "Modifica Elemento" : "Nuovo Elemento"} — {currentTab?.label}
          </h3>
          <FormFields
            activeTab={activeTab}
            form={form}
            setForm={setForm}
            imageFileRef={imageFileRef}
            iconFileRef={iconFileRef}
            flagFileRef={flagFileRef}
            onFileSelected={handleFileChange}
            uploadPreview={uploadPreview}
            uploadWarning={uploadWarning}
          />
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#8b5cf6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, opacity: saving ? 0.5 : 1 }}
            >
              {saving ? "Salvataggio…" : editingId ? "Aggiorna" : "Crea"}
            </button>
            <button
              onClick={resetForm}
              style={{ padding: "10px 24px", borderRadius: 8, border: "1px solid #1e3a5f", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13 }}
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Items Table — now draggable */}
      <div style={{ background: "var(--admin-card, #0f172a)", border: "1px solid var(--admin-border, #1e3a5f)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--admin-border, #1e3a5f)" }}>
              {["", "", "Titolo", "Href", "Ord.", "Attivo", "Azioni"].map((h, i) => (
                <th key={i} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#64748b" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentItems.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Nessun elemento in questa sezione</td>
              </tr>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={currentItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                  {currentItems.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onToggleActive={handleToggleActive}
                      onHistory={setHistoryFor}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </tbody>
        </table>
      </div>

      {currentItems.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--admin-text-muted, #94a3b8)", textAlign: "right" }}>
          💡 Trascina le righe dalla colonna ⋮⋮ per riordinarle. {currentItems.length} totali · {activeCount} attivi.
        </div>
      )}

      {historyFor && (
        <HistoryModal item={historyFor} onClose={() => setHistoryFor(null)} onRolled={() => { setHistoryFor(null); loadItems(); }} />
      )}

      {orphansOpen && (
        <OrphansModal onClose={() => setOrphansOpen(false)} />
      )}
    </div>
  );
}

// ═══ HISTORY MODAL (E5 Phase 2) ═══

function HistoryModal({ item, onClose, onRolled }: { item: HomeContentItem; onClose: () => void; onRolled: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/home-content/${item.id}/history`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setEntries(data.history ?? []);
      } catch (e: any) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, [item.id]);

  const rollback = async (historyId: number) => {
    if (!confirm("Ripristinare a questa versione?")) return;
    setRolling(historyId);
    try {
      const res = await fetch(`/api/admin/home-content/${item.id}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history_id: historyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onRolled();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRolling(null);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 100%)", maxHeight: "85vh", overflow: "auto", background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20, color: "#e2e8f0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Storico: {item.title}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Ultime 50 modifiche</div>
          </div>
          <button onClick={onClose} aria-label="Chiudi storico" style={{ background: "transparent", border: "1px solid #1e3a5f", color: "#94a3b8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        {error && <div style={{ padding: 10, background: "#ef444420", color: "#ef4444", borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        {loading && <div style={{ color: "#94a3b8", padding: 16, textAlign: "center" }}>Caricamento…</div>}
        {!loading && entries.length === 0 && <div style={{ color: "#64748b", padding: 16, textAlign: "center", fontSize: 13 }}>Nessuna modifica registrata.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map((e) => {
            const s = e.snapshot;
            return (
              <div key={e.history_id} style={{ padding: 10, background: "rgba(255,255,255,0.03)", border: "1px solid #1e3a5f", borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    <span style={{ color: e.action === "delete" ? "#ef4444" : "#3b82f6", fontWeight: 700, textTransform: "uppercase", marginRight: 8 }}>{e.action}</span>
                    {new Date(e.changed_at).toLocaleString("it-IT")}
                    {e.changed_by && <span style={{ marginLeft: 8 }}>· {e.changed_by}</span>}
                  </div>
                  {e.action !== "delete" && (
                    <button
                      onClick={() => rollback(e.history_id)}
                      disabled={rolling === e.history_id}
                      style={{ padding: "4px 10px", background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: "pointer", opacity: rolling === e.history_id ? 0.5 : 1 }}
                    >
                      {rolling === e.history_id ? "…" : "⟲ Ripristina"}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#cbd5e1", fontFamily: "monospace", background: "rgba(0,0,0,0.2)", padding: 6, borderRadius: 4 }}>
                  <div>titolo: <strong>{s?.title}</strong>{s?.title_en ? ` · EN: ${s.title_en}` : ""}</div>
                  <div>href: {s?.href ?? "—"} · active: {String(s?.is_active)} · sort: {s?.sort_order}</div>
                  {(s?.published_from || s?.published_until) && (
                    <div>⏲ {s?.published_from ?? "—"} → {s?.published_until ?? "—"}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══ ORPHANS MODAL (E5 Phase 2) ═══

function OrphansModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState("");

  const load = async (purge = false) => {
    if (purge) setPurging(true);
    else setLoading(true);
    setError("");
    try {
      const url = purge ? "/api/admin/home-content/orphans?delete=1" : "/api/admin/home-content/orphans";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setPurging(false);
    }
  };

  useEffect(() => { load(false); /* eslint-disable-next-line */ }, []);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 100%)", maxHeight: "85vh", overflow: "auto", background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20, color: "#e2e8f0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Orfani storage</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>File nel bucket home-content non referenziati da nessun elemento.</div>
          </div>
          <button onClick={onClose} aria-label="Chiudi" style={{ background: "transparent", border: "1px solid #1e3a5f", color: "#94a3b8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        {error && <div style={{ padding: 10, background: "#ef444420", color: "#ef4444", borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        {loading && <div style={{ color: "#94a3b8", padding: 16, textAlign: "center" }}>Scansione in corso…</div>}

        {data && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 14, fontSize: 12 }}>
              <div><strong>{data.total_files}</strong> file totali</div>
              <div style={{ color: "#10b981" }}><strong>{data.referenced}</strong> referenziati</div>
              <div style={{ color: "#ef4444" }}><strong>{data.orphan_count}</strong> orfani ({((data.orphan_size_bytes ?? 0) / 1024).toFixed(0)} KB)</div>
            </div>

            {data.orphan_count > 0 && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <button
                    onClick={() => {
                      if (confirm(`Eliminare definitivamente ${data.orphan_count} file orfani? Operazione non reversibile.`)) load(true);
                    }}
                    disabled={purging}
                    style={{ padding: "8px 16px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    {purging ? "Eliminazione…" : `🗑 Elimina ${data.orphan_count} file orfani`}
                  </button>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: 11, color: "#cbd5e1", background: "rgba(0,0,0,0.2)", padding: 10, borderRadius: 6, maxHeight: 300, overflow: "auto" }}>
                  {(data.orphans ?? []).map((f: any) => (
                    <div key={f.name}>{f.name} <span style={{ color: "#64748b" }}>({((f.size ?? 0) / 1024).toFixed(0)} KB)</span></div>
                  ))}
                </div>
                {data.orphans?.length >= 200 && <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Mostrati i primi 200; la purge agisce su tutti.</div>}
              </>
            )}

            {data.deleted && data.deleted.length > 0 && (
              <div style={{ marginTop: 10, padding: 10, background: "#10b98120", color: "#10b981", borderRadius: 6, fontSize: 12 }}>
                ✓ Eliminati {data.deleted.length} file.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ═══ SORTABLE ROW (E5) ═══

function SortableRow({ item, onEdit, onDelete, onToggleActive, onHistory }: {
  item: HomeContentItem;
  onEdit: (i: HomeContentItem) => void;
  onDelete: (id: string) => void;
  onToggleActive: (i: HomeContentItem) => void;
  onHistory: (i: HomeContentItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? "rgba(139,92,246,0.06)" : undefined,
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  };
  const thumb = item.image_url || item.icon_url || null;

  return (
    <tr ref={setNodeRef} style={style}>
      <td style={{ padding: "8px 8px", width: 32, cursor: "grab", color: "#64748b" }} {...attributes} {...listeners} title="Trascina per riordinare">
        ⋮⋮
      </td>
      <td style={{ padding: "8px 12px", width: 56 }}>
        {thumb ? (
          <img
            src={thumb}
            alt=""
            style={{
              width: 40, height: 40, borderRadius: 6, objectFit: "cover",
              background: "#1e293b",
              border: item.accent_color ? `2px solid ${item.accent_color}` : undefined,
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div style={{
            width: 40, height: 40, borderRadius: 6,
            background: item.accent_color ?? "#1e293b",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: item.accent_color ? "#fff" : "#475569", fontSize: 14, fontWeight: 700,
          }}>
            {item.accent_color ? "●" : "—"}
          </div>
        )}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <span style={{ fontWeight: 600, color: "var(--admin-text, #e2e8f0)" }}>{item.title}</span>
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "#94a3b8", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {item.link_status === "broken" && (
            <span title={`Link verificato ${item.link_checked_at ? new Date(item.link_checked_at).toLocaleString("it-IT") : ""}: rotto`} style={{ color: "#ef4444", fontSize: 10 }}>●</span>
          )}
          {item.link_status === "ok" && (
            <span title={`Link verificato ${item.link_checked_at ? new Date(item.link_checked_at).toLocaleString("it-IT") : ""}: ok`} style={{ color: "#10b981", fontSize: 10 }}>●</span>
          )}
          {item.href || "—"}
        </span>
      </td>
      <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#64748b" }}>{item.sort_order}</td>
      <td style={{ padding: "10px 12px" }}>
        <button
          onClick={() => onToggleActive(item)}
          aria-label={item.is_active ? "Disattiva elemento" : "Attiva elemento"}
          style={{
            padding: "2px 8px", borderRadius: 4,
            fontSize: 10, fontWeight: 700,
            border: "none", cursor: "pointer",
            background: item.is_active ? "#10b98120" : "#ef444420",
            color: item.is_active ? "#10b981" : "#ef4444",
          }}
        >
          {item.is_active ? "ATTIVO" : "OFF"}
        </button>
        {(item.published_from || item.published_until) && (
          <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }} title={`Finestra: ${item.published_from ?? "—"} → ${item.published_until ?? "—"}`}>
            ⏲ sched
          </div>
        )}
      </td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => onEdit(item)} aria-label="Modifica" style={miniBtn("#3b82f6")}>Edit</button>
          <button onClick={() => onHistory(item)} aria-label="Storico modifiche" title="Storico" style={miniBtn("#94a3b8")}>⟲</button>
          <button onClick={() => onDelete(item.id)} aria-label="Elimina" style={miniBtn("#ef4444")}>Del</button>
        </div>
      </td>
    </tr>
  );
}

// ═══ FORM FIELDS (extracted + E5 upgraded) ═══

interface FormFieldsProps {
  activeTab: SectionKey;
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
  imageFileRef: React.RefObject<HTMLInputElement>;
  iconFileRef: React.RefObject<HTMLInputElement>;
  flagFileRef: React.RefObject<HTMLInputElement>;
  onFileSelected: (field: "image_url" | "icon_url" | "flag_url") => Promise<void>;
  uploadPreview: Record<string, string | null>;
  uploadWarning: Record<string, string | null>;
}

function FormFields(p: FormFieldsProps) {
  const { activeTab, form, setForm } = p;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <FieldRow label="Titolo (IT)">
        <input value={form.title} onChange={(e) => setForm((pv) => ({ ...pv, title: e.target.value }))} placeholder="Titolo in italiano" style={inputStyle} />
      </FieldRow>

      <FieldRow label="Titolo (EN) — opzionale">
        <input value={form.title_en} onChange={(e) => setForm((pv) => ({ ...pv, title_en: e.target.value }))} placeholder="English title (opzionale)" style={inputStyle} />
      </FieldRow>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FieldRow label="Pubblicato DA (opzionale)">
          <input
            type="datetime-local"
            value={form.published_from}
            onChange={(e) => setForm((pv) => ({ ...pv, published_from: e.target.value }))}
            style={inputStyle}
          />
        </FieldRow>
        <FieldRow label="Pubblicato FINO A (opzionale)">
          <input
            type="datetime-local"
            value={form.published_until}
            onChange={(e) => setForm((pv) => ({ ...pv, published_until: e.target.value }))}
            style={inputStyle}
          />
        </FieldRow>
      </div>
      {(form.published_from || form.published_until) && (
        <div style={{ fontSize: 11, color: "#64748b", marginTop: -8 }}>
          💡 Cron scheduler attiva/disattiva automaticamente in base a questa finestra.
        </div>
      )}

      {activeTab === "hero_banners" && (
        <>
          <ImageField
            field="image_url" section={activeTab}
            value={form.image_url}
            setValue={(v) => setForm((pv) => ({ ...pv, image_url: v }))}
            {...p}
          />
          <HrefField value={form.href} setValue={(v) => setForm((pv) => ({ ...pv, href: v }))} placeholder="/sport" />
          <FieldRow label="Banner largo">
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={form.is_wide} onChange={(e) => setForm((pv) => ({ ...pv, is_wide: e.target.checked }))} />
              <span style={{ fontSize: 13, color: "#e2e8f0" }}>is_wide (banner full-width)</span>
            </label>
          </FieldRow>
        </>
      )}

      {activeTab === "leagues" && (
        <>
          <ImageField field="icon_url" section={activeTab} value={form.icon_url} setValue={(v) => setForm((pv) => ({ ...pv, icon_url: v }))} {...p} />
          <ImageField field="flag_url" section={activeTab} value={form.flag_url} setValue={(v) => setForm((pv) => ({ ...pv, flag_url: v }))} {...p} />
          <HrefField value={form.href} setValue={(v) => setForm((pv) => ({ ...pv, href: v }))} placeholder="/sport?league=serie-a" />
        </>
      )}

      {(activeTab === "sport_tiles" || activeTab === "virtual_cards") && (
        <>
          <ImageField field="icon_url" section={activeTab} value={form.icon_url} setValue={(v) => setForm((pv) => ({ ...pv, icon_url: v }))} {...p} />
          <FieldRow label="Accent color">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input type="color" value={form.accent_color} onChange={(e) => setForm((pv) => ({ ...pv, accent_color: e.target.value }))}
                style={{ width: 44, height: 32, border: "1px solid #1e3a5f", borderRadius: 4, background: "transparent", cursor: "pointer" }} />
              <input value={form.accent_color} onChange={(e) => setForm((pv) => ({ ...pv, accent_color: e.target.value }))} style={{ ...inputStyle, flex: 1 }} />
              <div style={{
                width: 54, height: 32, borderRadius: 6,
                background: form.accent_color,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 11, fontWeight: 700,
              }}>
                Preview
              </div>
            </div>
          </FieldRow>
          <HrefField value={form.href} setValue={(v) => setForm((pv) => ({ ...pv, href: v }))} placeholder="/sport?sport=calcio" />
        </>
      )}

      {activeTab === "live_sidebar" && (
        <>
          <ImageField field="image_url" section={activeTab} value={form.image_url} setValue={(v) => setForm((pv) => ({ ...pv, image_url: v }))} {...p} />
          <ImageField field="icon_url"  section={activeTab} value={form.icon_url}  setValue={(v) => setForm((pv) => ({ ...pv, icon_url: v }))}  {...p} />
        </>
      )}
    </div>
  );
}

function ImageField(props: {
  field: "image_url" | "icon_url" | "flag_url";
  section: SectionKey;
  value: string;
  setValue: (v: string) => void;
  imageFileRef: React.RefObject<HTMLInputElement>;
  iconFileRef: React.RefObject<HTMLInputElement>;
  flagFileRef: React.RefObject<HTMLInputElement>;
  onFileSelected: (field: "image_url" | "icon_url" | "flag_url") => Promise<void>;
  uploadPreview: Record<string, string | null>;
  uploadWarning: Record<string, string | null>;
}) {
  const { field, section, value, setValue, imageFileRef, iconFileRef, flagFileRef, onFileSelected, uploadPreview, uploadWarning } = props;
  const ref = field === "image_url" ? imageFileRef : field === "icon_url" ? iconFileRef : flagFileRef;
  const hint = SIZE_HINTS[`${section}.${field}`];
  const preview = uploadPreview[field] ?? (value || null);
  const warning = uploadWarning[field] ?? null;
  const fieldLabel = field === "image_url" ? "Image URL" : field === "icon_url" ? "Icon URL" : "Flag URL";

  return (
    <FieldRow label={fieldLabel}>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…" style={{ ...inputStyle, flex: 1 }} />
        <input type="file" ref={ref} accept="image/*" style={{ display: "none" }} onChange={() => onFileSelected(field)} />
        <button onClick={() => ref.current?.click()} style={miniBtn("#3b82f6")}>Upload</button>
      </div>
      {hint && <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>📏 {hint.label}</div>}
      {preview && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <img src={preview} alt="preview" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid #1e3a5f", background: "#1e293b" }} onError={(e) => (e.target as HTMLImageElement).style.display = "none"} />
          {warning && <div style={{ fontSize: 11, color: "#f59e0b" }}>{warning}</div>}
        </div>
      )}
    </FieldRow>
  );
}

function HrefField({ value, setValue, placeholder }: { value: string; setValue: (v: string) => void; placeholder: string }) {
  return (
    <FieldRow label="Href">
      <input list="known-routes" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} style={inputStyle} />
      <datalist id="known-routes">
        {KNOWN_ROUTES.map((r) => <option key={r} value={r} />)}
      </datalist>
    </FieldRow>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ═══ STYLES ═══

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #1e3a5f",
  background: "#0a0914",
  color: "#e2e8f0",
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  display: "block",
  marginBottom: 4,
};

function miniBtn(color: string): React.CSSProperties {
  return {
    padding: "3px 10px",
    borderRadius: 4,
    border: `1px solid ${color}40`,
    background: "transparent",
    color,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
  };
}
