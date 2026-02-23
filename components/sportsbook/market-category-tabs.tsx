"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface MarketCategoryTabsProps {
  categories: { id: string; label: string; count: number }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  extraTab?: { id: string; label: string };
}

export function MarketCategoryTabs({ categories, activeTab, onTabChange, extraTab }: MarketCategoryTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view on mount
  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const el = activeRef.current;
      const left = el.offsetLeft - container.offsetLeft - 16;
      container.scrollTo({ left, behavior: "smooth" });
    }
  }, [activeTab]);

  return (
    <div ref={scrollRef} className="overflow-x-auto no-scrollbar">
      <div className="flex gap-0 border-b border-gray-200 min-w-max">
        {extraTab && (
          <button
            onClick={() => onTabChange(extraTab.id)}
            className={cn(
              "px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px",
              activeTab === extraTab.id
                ? "border-brand text-brand"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {extraTab.label}
          </button>
        )}
        {categories.map((cat) => (
          <button
            key={cat.id}
            ref={activeTab === cat.id ? activeRef : undefined}
            onClick={() => onTabChange(cat.id)}
            className={cn(
              "px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px",
              activeTab === cat.id
                ? "border-brand text-brand"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {cat.label}
            <span className="ml-1 text-gray-400 font-normal">({cat.count})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
