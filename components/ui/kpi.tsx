import { cn } from "@/lib/utils";

interface KPIProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  color?: string; // Tailwind text color class
  trend?: { value: number; label?: string }; // positive = up, negative = down
  className?: string;
}

export function KPI({ label, value, subtitle, icon, color = "text-txt", trend, className }: KPIProps) {
  return (
    <div className={cn("kpi-admin flex flex-col min-w-[120px]", className)}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-bold text-txt-tertiary uppercase tracking-wider">
          {label}
        </span>
        {icon && <span className="text-sm opacity-50">{icon}</span>}
      </div>
      <div className={cn("text-[22px] font-extrabold font-mono tracking-tight", color)}>
        {value}
      </div>
      {(subtitle || trend) && (
        <div className="flex items-center gap-2 mt-1">
          {subtitle && (
            <span className="text-[10px] text-txt-tertiary">{subtitle}</span>
          )}
          {trend && (
            <span
              className={cn(
                "text-[10px] font-bold",
                trend.value >= 0 ? "text-emerald-400" : "text-red-400"
              )}
            >
              {trend.value >= 0 ? "▲" : "▼"} {Math.abs(trend.value)}%
              {trend.label && ` ${trend.label}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
