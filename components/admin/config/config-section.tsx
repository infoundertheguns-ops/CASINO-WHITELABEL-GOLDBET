"use client";

import { cn } from "@/lib/utils";

interface ConfigField {
  key: string;
  label: string;
  type: "number" | "text" | "toggle" | "select";
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

interface ConfigSectionProps {
  title: string;
  description?: string;
  fields: ConfigField[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
}

export function ConfigSection({ title, description, fields, values, onChange }: ConfigSectionProps) {
  return (
    <div className="rounded-xl p-5" style={{ background: "var(--admin-card)", borderColor: "var(--admin-border)", borderWidth: "1px" }}>
      <h3 className="text-sm font-bold mb-1" style={{ color: "var(--admin-text)" }}>{title}</h3>
      {description && <p className="text-[10px] mb-4" style={{ color: "var(--admin-text4)" }}>{description}</p>}
      <div className="space-y-4">
        {fields.map(f => (
          <div key={f.key} className="flex items-center justify-between gap-4">
            <label className="text-xs min-w-[200px]" style={{ color: "var(--admin-text2)" }}>{f.label}</label>
            {f.type === "toggle" ? (
              <button
                onClick={() => onChange(f.key, !values[f.key])}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors",
                  values[f.key] ? "bg-brand" : "bg-gray-700"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                  values[f.key] ? "translate-x-5" : "translate-x-0.5"
                )} />
              </button>
            ) : f.type === "number" ? (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={f.min || 0}
                  max={f.max || 100}
                  step={f.step || 1}
                  value={values[f.key] ?? 0}
                  onChange={e => onChange(f.key, Number(e.target.value))}
                  className="w-32 accent-brand"
                />
                <input
                  type="number"
                  min={f.min || 0}
                  max={f.max || 100}
                  step={f.step || 1}
                  value={values[f.key] ?? 0}
                  onChange={e => onChange(f.key, Number(e.target.value))}
                  className="w-16 border border-gray-700 rounded px-2 py-1 text-xs text-center font-mono"
                  style={{ background: "var(--admin-input)", color: "var(--admin-text)" }}
                />
              </div>
            ) : f.type === "select" ? (
              <select
                value={values[f.key] ?? ""}
                onChange={e => onChange(f.key, e.target.value)}
                className="border border-gray-700 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: "var(--admin-input)", color: "var(--admin-text)" }}
              >
                {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={values[f.key] ?? ""}
                onChange={e => onChange(f.key, e.target.value)}
                className="w-48 border border-gray-700 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: "var(--admin-input)", color: "var(--admin-text)" }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
