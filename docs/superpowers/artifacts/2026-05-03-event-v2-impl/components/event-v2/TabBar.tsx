// components/event-v2/TabBar.tsx
"use client";

type Props = {
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
};

export default function TabBar({ tabs, activeTab, onChange }: Props) {
  return (
    <div
      className="flex items-center justify-center shrink-0 overflow-x-auto px-2 gap-1"
      style={{
        height: 48,
        background: "#d0141c",
        marginRight: 10,
        borderRadius: "0 0 6px 6px",
      }}
    >
      {tabs.map(tab => {
        const isActive = tab === activeTab;
        return (
          <button
            key={tab}
            type="button"
            data-active={isActive ? "true" : "false"}
            onClick={() => onChange(tab)}
            className="whitespace-nowrap text-[19px] font-bold text-white transition-colors"
            style={{
              backgroundColor: isActive ? "#4f0a0d" : "#860e12",
              border: "none",
              borderRadius: 4,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
