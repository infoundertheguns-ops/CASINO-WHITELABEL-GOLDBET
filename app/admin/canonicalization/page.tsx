// app/admin/canonicalization/page.tsx
"use client";
export const dynamic = 'force-dynamic';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import { ExploreTab } from './explore-tab';
import { OverviewTab } from './overview-tab';

type Tab = 'explore' | 'overview';

function CanonicalizationContent() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get('tab');
  // Default tab is 'explore'. 'overview' kept for the second tab.
  // Legacy ?tab=inspector links fall through to default ('explore') —
  // the old Inspector tab has been removed (mig 122 inspect_event RPC
  // remains in the DB, idempotent, in case it's brought back later).
  const tab: Tab = raw === 'overview' ? 'overview' : 'explore';

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', t);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="p-4">
      <header className="mb-4">
        <h1 className="text-xl font-bold">🔭 Canonicalizzazione</h1>
        <p className="text-xs opacity-70">
          Sfoglia eventi per Sport / Lega / Gruppo cross-source. Tab "Gerarchia & KPI" per la pipeline a 5 livelli.
        </p>
      </header>

      <div className="flex gap-2 border-b mb-4" style={{ borderColor: 'var(--admin-border)' }}>
        <button
          onClick={() => setTab('explore')}
          className={`px-3 py-2 text-sm ${tab === 'explore' ? 'border-b-2 font-semibold' : 'opacity-70'}`}
          style={tab === 'explore' ? { borderColor: 'var(--admin-text)' } : undefined}
        >
          🌳 Esplora
        </button>
        <button
          onClick={() => setTab('overview')}
          className={`px-3 py-2 text-sm ${tab === 'overview' ? 'border-b-2 font-semibold' : 'opacity-70'}`}
          style={tab === 'overview' ? { borderColor: 'var(--admin-text)' } : undefined}
        >
          📊 Gerarchia & KPI
        </button>
      </div>

      <Suspense fallback={<div className="text-sm opacity-70">Caricamento...</div>}>
        {tab === 'explore' ? <ExploreTab /> : <OverviewTab />}
      </Suspense>
    </div>
  );
}

export default function CanonicalizationPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm opacity-70">Caricamento...</div>}>
      <CanonicalizationContent />
    </Suspense>
  );
}
