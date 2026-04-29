// E9 — Shared admin UI primitives package.
// Import via: `import { Kpi, SourceBadge, ... } from "@/components/admin/ui";`

export { Kpi, KpiRow } from "./kpi";
export type { KpiProps } from "./kpi";

export {
  SourceBadge,
  SOURCE_COLORS,
  StatusBadge,
  ConfidenceCell,
  ExtractedByBadge,
} from "./badges";

export {
  FilterBar,
  FilterLabel,
  AdminSelect,
  AdminSearchInput,
  AdminCheckboxLabel,
} from "./filter-bar";

export { Pagination } from "./pagination";

export { Toast } from "./toast";
export type { ToastProps } from "./toast";

export { Modal } from "./modal";

export {
  AdminTable,
  AdminThead,
  AdminTh,
  AdminTd,
  AdminTr,
  AdminEmptyRow,
} from "./table";

export { PresetChip } from "./preset-chip";

export { GlossaryTerm } from "./glossary-term";
