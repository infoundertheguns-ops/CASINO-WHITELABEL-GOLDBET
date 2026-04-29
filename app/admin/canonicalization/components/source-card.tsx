// app/admin/canonicalization/components/source-card.tsx
"use client";
import type { SourceEventCard } from '@/lib/admin/canonicalization-types';
import { StatusIcon } from './status-icon';

const SOURCE_LABELS: Record<string, string> = {
  flashscore: 'FLASHSCORE',
  'odds-api': 'ODDS-API',
  unknown: '?',
};

export function SourceCard({ event }: { event: SourceEventCard }) {
  const sig = event.field_signals;
  const rows: Array<[string, React.ReactNode, keyof typeof sig | null]> = [
    ['external_id', event.external_id, null],
    ['home_team', event.home_team, null],
    ['away_team', event.away_team, null],
    ['sport', event.sport ?? '—', null],
    ['league', event.league_name ?? '—', 'league_name'],
    ['country', event.country ?? event.country_code ?? '—', 'country'],
    ['tour_code', event.tour_code ?? '—', 'tour_code'],
    ['starts_at', new Date(event.starts_at).toLocaleString('it-IT'), null],
    [
      'status',
      <>
        {event.status}
        {event.is_source_only === true && (
          <span
            className="ml-1"
            title="is_source_only=true: evento strutturalmente non in Flashscore (Setka/Esports/Alternative Matches/...)"
            aria-label="source-only structural"
          >
            🔒
          </span>
        )}
      </>,
      null,
    ],
    [
      'flashscore_id',
      event.flashscore_id
        ? `${event.flashscore_id} (${event.match_stage ?? '?'} ${event.confidence?.toFixed(2) ?? ''})`
        : '—',
      'flashscore_id',
    ],
    ['canonical_id', event.canonical_id ?? '—', 'canonical_id'],
    ['markets · outcomes', `${event.markets_count} · ${event.outcomes_count}`, null],
  ];

  return (
    <div className="border rounded p-3 text-xs flex-1 min-w-[260px]" style={{ borderColor: 'var(--admin-border)' }}>
      <div className="font-bold mb-2">{SOURCE_LABELS[event.source] ?? event.source}</div>
      <table className="w-full">
        <tbody>
          {rows.map(([label, value, sigKey], idx) => (
            <tr key={idx}>
              <td className="font-medium pr-2 align-top opacity-70">{label}</td>
              <td className="break-all">{value}</td>
              <td className="pl-1 align-top">
                {sigKey && sig[sigKey] && <StatusIcon state={sig[sigKey]} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
