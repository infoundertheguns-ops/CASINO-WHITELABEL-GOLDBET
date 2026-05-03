// components/event-v2/OutcomeButton.tsx
"use client";

import OddsFlash from "./OddsFlash";

type Size = 'hero' | 'standard' | 'compact';

type Props = {
  outcomeId: string;
  outcomeIdV2: string;
  label: string;
  odds: number;
  isSuspended: boolean;
  isManualSuspended: boolean;
  oddsChange: 'up' | 'down' | null;
  size: Size;
  onSelect: (outcome: { outcomeId: string; outcomeIdV2: string; odds: number; label: string }) => void;
};

const SIZE_STYLES: Record<Size, { padding: string; oddsFontSize: string; labelFontSize: string }> = {
  hero:     { padding: '22px', oddsFontSize: '22px', labelFontSize: '11px' },
  standard: { padding: '16px', oddsFontSize: '16px', labelFontSize: '10px' },
  compact:  { padding: '12px', oddsFontSize: '14px', labelFontSize: '9px' },
};

const LockIcon = () => (
  <svg
    data-testid="lock-icon"
    width="14" height="14" viewBox="0 0 24 24"
    style={{ position: 'absolute', top: 4, right: 4 }}
  >
    <rect x="5" y="11" width="14" height="10" rx="2" fill="#666"/>
    <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="#666" strokeWidth="2" fill="none"/>
  </svg>
);

export default function OutcomeButton({
  outcomeId, outcomeIdV2, label, odds, isSuspended, isManualSuspended,
  oddsChange, size, onSelect,
}: Props) {
  const suspended = isSuspended || isManualSuspended;
  const styles = SIZE_STYLES[size];

  const handleClick = () => {
    if (suspended) return;
    onSelect({ outcomeId, outcomeIdV2, odds, label });
  };

  return (
    <OddsFlash oddsChange={oddsChange}>
      <button
        type="button"
        data-size={size}
        onClick={handleClick}
        disabled={suspended}
        style={{
          position: 'relative',
          background: suspended ? '#e0e0e0' : '#f0f0f0',
          opacity: suspended ? 0.6 : 1,
          border: 'none',
          padding: styles.padding,
          borderRadius: 4,
          cursor: suspended ? 'not-allowed' : 'pointer',
          width: '100%',
          textAlign: 'center',
        }}
      >
        {suspended && <LockIcon />}
        <div style={{ fontSize: styles.labelFontSize, color: '#888' }}>{label}</div>
        <div style={{ fontSize: styles.oddsFontSize, fontWeight: 'bold', color: '#333', marginTop: 4 }}>
          {odds.toFixed(2)}
        </div>
      </button>
    </OddsFlash>
  );
}
