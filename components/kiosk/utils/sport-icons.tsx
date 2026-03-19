"use client";

import {
  Home,
  Circle,
  CircleDot,
  Target,
  Hexagon,
  Trophy,
  Swords,
  Gamepad2,
  Disc,
  Crosshair,
  Activity,
  Hand,
  Bike,
  Flag,
  Car,
  Dumbbell,
  type LucideIcon,
} from "lucide-react";

const SPORT_ICON_MAP: Record<string, LucideIcon> = {
  calcio: Circle,
  football: Circle,
  tennis: CircleDot,
  "tennis-tavolo": Disc,
  "table-tennis": Disc,
  basket: Target,
  basketball: Target,
  hockey: Hexagon,
  "ice-hockey": Hexagon,
  esports: Gamepad2,
  "arti-marziali": Swords,
  "ufc-mma": Swords,
  boxe: Dumbbell,
  boxing: Dumbbell,
  freccette: Crosshair,
  darts: Crosshair,
  snooker: Target,
  "football-americano": Trophy,
  "american-football": Trophy,
  baseball: Circle,
  rugby: Circle,
  cricket: Circle,
  "australian-rules": Circle,
  ciclismo: Bike,
  cycling: Bike,
  golf: Flag,
  volley: Activity,
  volleyball: Activity,
  pallamano: Hand,
  handball: Hand,
  speedway: Car,
  nascar: Car,
  indycar: Car,
  "v8-supercars": Car,
  "formula-1": Car,
  motociclismo: Car,
};

export function getSportIcon(slug: string): LucideIcon {
  return SPORT_ICON_MAP[slug] || Trophy;
}

export { Home };
