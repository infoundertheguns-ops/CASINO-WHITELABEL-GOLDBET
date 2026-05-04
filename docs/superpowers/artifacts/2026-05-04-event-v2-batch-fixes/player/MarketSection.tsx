// components/event-v2/MarketSection.tsx
"use client";

type Props = {
  title: string;
  linkTo?: string;
  onLinkClick?: () => void;
  children: React.ReactNode;
};

export default function MarketSection({ title, linkTo, onLinkClick, children }: Props) {
  return (
    <div style={{
      background: 'white',
      borderRadius: 4,
      padding: 8,
      marginBottom: 4,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
      }}>
        <span style={{
          fontWeight: 700,
          color: '#1a1a1a',
          fontSize: 15,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
        }}>{title}</span>
        {linkTo && (
          <button
            type="button"
            onClick={onLinkClick}
            style={{
              fontSize: 10,
              color: '#d0141c',
              background: 'none',
              border: 'none',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >altre linee →</button>
        )}
      </div>
      {children}
    </div>
  );
}
