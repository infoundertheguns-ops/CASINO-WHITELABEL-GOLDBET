// components/event-v2/OddsFlash.tsx
"use client";

import { useEffect, useState } from "react";

type Props = {
  oddsChange: 'up' | 'down' | null;
  children: React.ReactNode;
};

export default function OddsFlash({ oddsChange, children }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (oddsChange) {
      setActive(true);
      const t = setTimeout(() => setActive(false), 2000);
      return () => clearTimeout(t);
    }
  }, [oddsChange]);

  const bgColor = active && oddsChange === 'up' ? '#e6f7e6'
                : active && oddsChange === 'down' ? '#fde8e8'
                : 'transparent';

  return (
    <div
      style={{
        backgroundColor: bgColor,
        transition: 'background-color 2s ease-out',
      }}
    >
      {children}
    </div>
  );
}
