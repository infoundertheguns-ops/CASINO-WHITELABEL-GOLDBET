# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VinciTu is an iGaming platform (sports betting, casino, crypto payments) built with Next.js 14 App Router, Supabase (PostgreSQL + Auth), Tailwind CSS, and Zustand for client state. The UI language is Italian.

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run db:migrate   # Push Supabase migrations (supabase db push)
npm run db:reset     # Reset Supabase DB
npm run db:types     # Generate TS types from Supabase -> lib/types/database.ts
```

No test runner is configured.

## Architecture

### Route Groups (App Router)

- `app/(auth)/` — Login, Register, Forgot Password. Server-rendered, no nav chrome.
- `app/(player)/` — Player-facing pages (sport, casino, promo, wallet, account). Uses `PlayerLayout` with responsive nav (sidebar on desktop, bottom nav on mobile).
- `app/admin/` — Back Office (~18 modules). Uses `AdminLayout` with sidebar + topbar. Admin routes are tab-based: sidebar IDs map to routes via `?tab=` query param in `admin/layout.tsx`.
- `app/api/` — API routes: `auth/callback`, `settlement`, `risk-agent`, `promo-engine`.

### Supabase Integration (3 clients)

- `lib/supabase/client.ts` — Browser client (`createBrowserClient` from `@supabase/ssr`). Used in client components and Zustand stores.
- `lib/supabase/server.ts` — Server client (reads cookies via `next/headers`). Also exports `createAdminClient()` which uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS.
- `lib/supabase/middleware.ts` — Session refresh + route protection. Checks `admin_users` table for admin access. Redirects unauthenticated users from protected routes to `/login`.

### State Management

`lib/hooks/use-auth.ts` is a Zustand store that manages user session, wallet, and admin status. Other domain hooks (`use-sportsbook`, `use-casino`, `use-promos`, `use-wallet`) follow the same pattern: Zustand stores that call Supabase directly from the client.

### API Routes (Server-Side Engines)

These use `createClient` from `@supabase/supabase-js` directly (not the SSR wrapper) with the service role key:

- **Settlement Engine** (`api/settlement`) — Settles bet legs against event results using `MARKET_SETTLERS` map (15+ market types). Credits wallets and creates transactions.
- **Risk Agent** (`api/risk-agent`) — Rule-based risk scoring for bets, optionally enhanced with Claude API analysis. Flags/blocks high-risk bets.
- **Promo Engine** (`api/promo-engine`) — Processes wagering contributions from bets/casino rounds, tracks progress, converts bonus to real balance on completion.

### Types

`lib/types/index.ts` contains all TypeScript interfaces mirroring the Supabase schema. Use `npm run db:types` to auto-generate from Supabase (outputs to `lib/types/database.ts`).

### Design System

Two visual themes coexist:

- **Player theme**: Light background, orange brand color (`#e8611c`). CSS classes: `btn-brand`, `card-player`, `input-player`.
- **Admin theme**: Dark background (`#08070f`), gold accent (`#f0b429`). CSS classes: `btn-admin`, `card-admin`, `input-admin`, `.admin-theme` wrapper.

Custom color tokens are defined in `tailwind.config.ts` (`brand.*`, `admin.*`, `gold.*`, `txt.*`). Reusable UI components are in `components/ui/` and exported from `components/ui/index.ts`.

### Path Aliases

- `@/*` — project root
- `@/components/*`, `@/lib/*`, `@/styles/*` — specific directories

### Key Utility: `cn()`

`lib/utils/index.ts` exports `cn()` (clsx + tailwind-merge) for className merging. Other utils: `formatCurrency`, `formatCrypto`, `formatOdds`, `shortenAddress`, `riskColor`, `timeAgo`.

## Environment Variables

See `.env.example`. Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Optional: `ANTHROPIC_API_KEY` (for AI risk agent).

## Database

Schema is in `supabase/migrations/`:
- `001_initial_schema.sql` — Core tables (45+): users, wallets, sports, leagues, events, markets, odds, bets, bet_selections, casino providers/games/sessions, crypto deposits/withdrawals, hot_wallets, transactions, admin_users, risk_flags, etc.
- `002_promotions.sql` — Bonus system: promotions, promotion_rules, user_promotions, slot_tournaments, tournament_participants, wagering_log.

## Staging Directories

`fase2-files/`, `fase3-files/`, `fase-fix-v2/` contain work-in-progress or reference files for development phases. These are not part of the running application.
