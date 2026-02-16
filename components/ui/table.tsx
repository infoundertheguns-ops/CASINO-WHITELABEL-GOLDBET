"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// ═══ Table Container ═══
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("bg-admin-surface border border-admin rounded-[10px] overflow-hidden", className)}>
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

// ═══ Table Head ═══
export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

// ═══ Table Body ═══
export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

// ═══ Table Row ═══
export function TRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn("border-b border-admin row-hover", className)}>
      {children}
    </tr>
  );
}

// ═══ Table Header Cell ═══
export function TH({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-2.5 py-2 text-left text-[9px] font-bold text-txt-tertiary uppercase tracking-wider border-b border-admin",
        className
      )}
    >
      {children}
    </th>
  );
}

// ═══ Table Data Cell ═══
interface TDProps {
  children: ReactNode;
  mono?: boolean;
  bold?: boolean;
  color?: string;
  className?: string;
}

export function TD({ children, mono, bold, color, className }: TDProps) {
  return (
    <td
      className={cn(
        "px-2.5 py-2 text-sm",
        mono && "font-mono",
        bold && "font-bold",
        color || "text-txt",
        className
      )}
    >
      {children}
    </td>
  );
}
