import { cn } from "@/lib/utils";

type BadgeVariant = "success" | "danger" | "warning" | "info" | "gold" | "purple" | "neutral" | "live";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  success: "bg-emerald-500/10 text-emerald-400",
  danger: "bg-red-500/10 text-red-400",
  warning: "bg-orange-500/10 text-orange-400",
  info: "bg-blue-500/10 text-blue-400",
  gold: "bg-yellow-400/10 text-yellow-400",
  purple: "bg-purple-500/10 text-purple-400",
  neutral: "bg-gray-500/10 text-gray-400",
  live: "bg-red-500/20 text-red-400",
};

export function Badge({ children, variant = "neutral", className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap leading-tight",
        variantStyles[variant],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            variant === "live" && "animate-pulse2",
            variant === "success" ? "bg-emerald-400" :
            variant === "danger" || variant === "live" ? "bg-red-400" :
            variant === "warning" ? "bg-orange-400" : "bg-current"
          )}
        />
      )}
      {children}
    </span>
  );
}
