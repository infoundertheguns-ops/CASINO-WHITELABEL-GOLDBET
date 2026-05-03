// components/event-v2/SubPillBar.tsx
"use client";

type Props = {
  pills: string[];
  active: string;
  onChange: (pill: string) => void;
};

export default function SubPillBar({ pills, active, onChange }: Props) {
  return (
    <div style={{
      display: "flex",
      gap: 6,
      padding: "8px 0",
      borderBottom: "1px solid #eee",
      overflowX: "auto",
    }}>
      {pills.map(pill => {
        const isActive = pill === active;
        return (
          <button
            key={pill}
            type="button"
            data-active={isActive ? "true" : "false"}
            onClick={() => onChange(pill)}
            style={{
              background: isActive ? "#d0141c" : "white",
              color: isActive ? "white" : "#333",
              border: isActive ? "none" : "1px solid #ddd",
              padding: "8px 16px",
              borderRadius: 16,
              fontSize: 12,
              fontWeight: "bold",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >{pill}</button>
        );
      })}
    </div>
  );
}
