"use client";

import { useEffect, useState } from "react";

interface SLABadgeProps {
  deadline: string | null;
  severity: string;
}

export function SLABadge({ deadline, severity }: SLABadgeProps) {
  const [timeLeft, setTimeLeft] = useState("");
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!deadline) return;

    const update = () => {
      const now = Date.now();
      const end = new Date(deadline).getTime();
      const diff = end - now;

      if (diff <= 0) {
        setTimeLeft("SCADUTO");
        setIsExpired(true);
        return;
      }

      setIsExpired(false);
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);

      if (hours > 24) {
        setTimeLeft(`${Math.floor(hours / 24)}g ${hours % 24}h`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else {
        setTimeLeft(`${minutes}m`);
      }
    };

    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!deadline) {
    // Generate SLA from severity
    const slaHours = severity === "critical" ? 4 : severity === "high" ? 24 : 72;
    return (
      <span className="text-[8px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400 font-bold">
        SLA: {slaHours}h
      </span>
    );
  }

  const colorClass = isExpired
    ? "bg-red-500/20 text-red-400"
    : timeLeft.includes("m") && !timeLeft.includes("h")
      ? "bg-orange-500/20 text-orange-400"
      : "bg-blue-500/20 text-blue-400";

  return (
    <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${colorClass}`}>
      {isExpired ? "SCADUTO" : timeLeft}
    </span>
  );
}
