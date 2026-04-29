// app/admin/canonicalization/components/status-icon.tsx
"use client";
import type { SignalState } from '@/lib/admin/canonicalization-types';
import { signalToIcon, signalToTooltip } from '@/lib/admin/canonicalization-signals';

export function StatusIcon({ state }: { state: SignalState }) {
  return (
    <span
      title={signalToTooltip(state)}
      className="inline-block w-5 text-center"
      aria-label={signalToTooltip(state)}
    >
      {signalToIcon(state)}
    </span>
  );
}
