// app/admin/canonicalization/components/event-group.tsx
"use client";
import type { EventGroup as TGroup } from '@/lib/admin/canonicalization-types';
import { SourceCard } from './source-card';

export function EventGroup({ group }: { group: TGroup }) {
  const groupTypeBadge = {
    flashscore: '🟢 linked via flashscore_id',
    cross_source: '🟣 linked via cross-source canonical_id',
    trigram: '🟡 linked via trigram (heuristic)',
    isolated: '🔵 isolated — possibly a missed cross-source match',
  }[group.group_type];

  const crossSourceMsg = (() => {
    const sources = new Set(group.events.map(e => e.source));
    if (sources.size === 3) return '✅ 3/3 source canonical';
    if (sources.size === 2) return '⚠️ 2/3 source linked, 1 missing';
    return '❌ Single source only — nessun match cross-source rilevato';
  })();

  // Sprint 3 Phase B: when EVERY event in the group is is_source_only=true
  // the group is strutturalmente source-only — surface a 🔒 badge so the
  // operator knows it's not worth chasing a Flashscore match here.
  const groupSourceOnly = group.events.length > 0
    && group.events.every(e => e.is_source_only === true);

  return (
    <section className="border rounded p-4 mb-4" style={{ borderColor: 'var(--admin-border)' }}>
      <header className="flex justify-between items-start mb-3">
        <div>
          <div className="font-semibold">{group.real_world_label}</div>
          <div className="text-xs opacity-70">{groupTypeBadge}</div>
          {groupSourceOnly && (
            <div
              className="text-xs mt-1"
              title="Tutti gli eventi sono is_source_only=true: lega strutturalmente non in Flashscore."
            >
              🔒 source-only structural
            </div>
          )}
        </div>
      </header>
      <div className="flex flex-wrap gap-3">
        {group.events.map(e => (
          <SourceCard key={e.external_id} event={e} />
        ))}
      </div>
      <footer className="text-xs mt-3 opacity-80">{crossSourceMsg}</footer>
    </section>
  );
}
