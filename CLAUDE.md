# VinciTu - Project Context

## Overview
VinciTu is an iGaming platform targeting the Italian market with ADM-licensed bookmakers. The platform combines casino games, sports betting odds comparison, and promotional content.

## Tech Stack
- **Frontend**: Next.js with React
- **Backend**: Supabase (PostgreSQL + Auth + Realtime + Storage)
- **Hosting**: Local development
- **Language**: TypeScript/JavaScript

## Core Features
1. **Casino/Game Launcher** - Integration with game providers, supports real-money mode
2. **Odds Comparison Tool** - Pre-match and live odds across Italian ADM-licensed bookmakers
3. **Promotions System** - Bookmaker promotions with Supabase-backed CRUD
4. **User Authentication** - Supabase Auth

## Odds Comparator
- Covers 8 football leagues: Serie A, Serie B, Premier League, La Liga, Bundesliga, Ligue 1, Champions League, Eredivisie
- Scraping via Apify actors
- Data stored in Supabase
- Features: line movement tracking, sure bet detection, value bet detection
- UI designed to match UTGNews.com light Foxiz WordPress theme
- Embeddable widget versions available

## Known Issues and Recent Bugs
- Game launch errors in real-money mode
- Supabase schema cache issues with promotions table
- Check Supabase dashboard if queries return stale data

## Related Projects
- **UTGNews.com** - Sports news portal (WordPress + Foxiz theme)
- **LinkedIn automation** - n8n Cloud carousel posts for iGaming industry

## Architecture Decisions
- Supabase chosen for rapid prototyping + built-in auth + realtime
- Next.js for SSR/SEO benefits on betting content
- Apify for web scraping (odds data collection)
- n8n for workflow automation

## Development Notes
- Owner: Nicolo (non-developer, proficient with no-code tools)
- Primary tools: n8n, Apify, Supabase, Claude Code
- Claude Code CLI configured for local development assistance
- Memory persistence via claude-mem MCP plugin

## Conventions
- Use Italian ADM-licensed bookmakers only
- Follow UTGNews.com design language for public-facing components
- Supabase RLS policies should be reviewed for each new table
- Test game launches in both demo and real-money modes

## File Structure
```
vincitu/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Landing/redirect page
│   ├── (auth)/                   # Auth route group
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── forgot-password/page.tsx
│   ├── (player)/                 # Player-facing route group
│   │   ├── layout.tsx            # Player layout with nav
│   │   ├── home/page.tsx         # Player homepage (live events, casino, promos, recent bets)
│   │   ├── sport/page.tsx        # Sportsbook listing
│   │   ├── sport/[id]/page.tsx   # Event detail (grouped markets, accordion)
│   │   ├── casino/page.tsx       # Casino games browser
│   │   ├── bets/page.tsx         # My bets (pagination, realtime, cashout)
│   │   ├── wallet/page.tsx       # Crypto wallet (deposit/withdraw)
│   │   ├── promo/page.tsx        # Promotions listing
│   │   ├── account/page.tsx      # Account settings
│   │   ├── account/kyc/page.tsx  # KYC verification
│   │   └── account/responsible-gaming/page.tsx
│   ├── admin/                    # Admin panel
│   │   ├── layout.tsx            # Admin layout with sidebar
│   │   ├── page.tsx              # Admin redirect
│   │   ├── dashboard/page.tsx    # KPI dashboard
│   │   ├── sportsbook/page.tsx   # Sportsbook management (3 tabs, filters, settlement)
│   │   ├── casino/page.tsx       # Casino game management
│   │   ├── promos/page.tsx       # Promotions CRUD
│   │   ├── risk/page.tsx         # Risk alerts & AI analysis
│   │   ├── crypto/page.tsx       # Crypto payment management
│   │   ├── management/page.tsx   # User management
│   │   ├── treasury/page.tsx     # Treasury (hot/cold wallets)
│   │   ├── aml/page.tsx          # AML compliance
│   │   └── audit/page.tsx        # Audit log viewer
│   └── api/                      # API Routes
│       ├── auth/callback/route.ts      # Supabase OAuth callback
│       ├── scraper/prematch/route.ts   # Prematch odds ingestion
│       ├── scraper/live/route.ts       # Live odds update
│       ├── scraper/results/route.ts    # Match results + auto-settlement
│       ├── settlement/route.ts         # Bet settlement engine (15 market types)
│       ├── risk-agent/route.ts         # AI risk analysis (Claude API + rule-based)
│       └── promo-engine/route.ts       # Wagering contribution processor
├── components/
│   ├── ui/                       # Reusable UI primitives
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── badge.tsx
│   │   ├── kpi.tsx
│   │   ├── table.tsx
│   │   └── index.ts              # Barrel export
│   └── layout/
│       ├── admin-sidebar.tsx
│       ├── admin-topbar.tsx
│       └── player-nav.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client
│   │   ├── server.ts             # Server client + admin (service role) client
│   │   └── middleware.ts         # Session refresh middleware
│   ├── hooks/
│   │   ├── use-auth.ts           # Auth state hook
│   │   ├── use-wallet.ts         # Wallet balance hook
│   │   ├── use-casino.ts         # Casino games hook
│   │   ├── use-promos.ts         # Promotions hook
│   │   └── use-sportsbook.ts     # Sportsbook data hook
│   ├── types/index.ts            # TypeScript interfaces (all domain types)
│   └── utils/index.ts            # Utility functions
├── styles/globals.css            # Tailwind + global styles
├── middleware.ts                 # Next.js middleware (session refresh)
├── supabase/migrations/          # Database migrations
│   ├── 001_initial_schema.sql    # Core: users, wallets, sportsbook, casino, crypto, RLS
│   ├── 002_promotions.sql        # Full promotions system + tournaments
│   └── 003_scraper_fields.sql    # Unique indexes for scraper upserts
├── fase2-files/                  # Staging: phase 2 implementation files
├── fase3-files/                  # Staging: phase 3 implementation files
├── fase-fix-v2/                  # Staging: bug fix batch files
├── public/icons/                 # Static icons
├── public/images/                # Static images
├── tailwind.config.ts
├── next.config.mjs
├── tsconfig.json
└── package.json
```

## Database Schema
**Migration 001 — Core + Sportsbook + Casino + Crypto** (single transaction):

| Table | Description | RLS |
|-------|-------------|-----|
| `system_config` | Key-value platform settings (limits, KYC, crypto, bonuses) | — |
| `admin_roles` | Role-based permissions (super_admin, risk_manager, finance, support, content) | — |
| `users` | Player profiles extending `auth.users` — KYC, classification, risk_score, ban status | Own data only |
| `admin_users` | Admin accounts linked to roles | — |
| `wallets` | USDT gaming balance per user — balance, bonus_balance, locked_balance, totals | Own data only |
| `transactions` | Financial ledger — deposit, withdrawal, bet, win, bonus, refund, adjustment, fee | Own data only |
| `user_limits` | Per-user betting/deposit limits set by admins | — |
| `audit_log` | Admin action audit trail | — |
| `agents` | Affiliate/agent system with commission tracking | — |
| `risk_events` | Risk alerts with severity levels | — |
| `sports` | Sports catalog (Calcio, Basket, Tennis, Hockey, Pallavolo) | Public (active) |
| `leagues` | Leagues per sport with external API IDs | Public (active) |
| `events` | Matches — prematch/live/finished, scores, external_id for scraper | Public |
| `markets` | Betting markets per event (1X2, O/U, GG/NG, etc.) | Public (active) |
| `outcomes` | Odds per market with previous_odds tracking | Public (active) |
| `bets` | User bets — singola/multi/sistema, stake, risk_score, risk_flags | Own data only |
| `bet_selections` | Individual legs of a bet linking to event/market/outcome | Own data only |
| `settlement_log` | Settlement audit trail per event | — |
| `casino_providers` | Game providers with API config, RTP, GGR share | Public (active) |
| `casino_games` | Games catalog — category, RTP, volatility, jackpot flags, stats | Public (active) |
| `game_sessions` | Active player gaming sessions | — |
| `game_rounds` | Individual casino rounds with bet/win amounts | — |
| `game_transactions` | Casino financial transactions per round | — |
| `crypto_currencies` | Supported cryptos (USDT_TRC, USDT_ERC, USDT_SOL, BTC, ETH, SOL, LTC, TRX, DOGE, BNB) | Public (active) |
| `user_crypto_wallets` | Per-user deposit addresses per currency | — |
| `crypto_deposits` | Incoming deposits with confirmation tracking | Own data only |
| `crypto_withdrawals` | Withdrawal requests with AML/risk checks | Own data only |
| `hot_wallets` | Platform hot wallet balances | — |
| `cold_wallets` | Platform cold wallet records | — |
| `wallet_transfers` | Hot/cold wallet transfer log | — |
| `crypto_price_log` | Historical price feed (CoinGecko) | — |
| `withdrawal_rules` | Auto-hold rules (large amount, unverified, new account, etc.) | — |

**Migration 002 — Promotions & Tournaments:**

| Table | Description | RLS |
|-------|-------------|-----|
| `promotions` | Master promo table — 16+ types, eligibility, schedule, budget | Public (active) |
| `promotion_rules` | Per-promo config: deposit bonus, free spins, free bet, cashback, acca boost, enhanced odds, wagering | Service role only |
| `slot_tournaments` | Tournament config — type, scoring, prizes, schedule | Public (live/upcoming) |
| `tournament_participants` | Leaderboard — scores, ranks, prizes | Public (leaderboard) |
| `user_promotions` | Claimed promos per user — wagering tracking, free spin/bet tracking | Service role only |
| `wagering_log` | Per-bet wagering contribution log | Service role only |

**Migration 003 — Scraper Indexes:**
- `uq_events_external_id` — unique on `events.external_id`
- `uq_markets_event_type` — unique on `markets(event_id, market_type)`
- `uq_outcomes_market_name` — unique on `outcomes(market_id, name)`

**Database Functions:**
- `process_crypto_deposit(deposit_id)` — confirms deposit, converts to USDT, credits wallet
- `request_crypto_withdrawal(user_id, currency, amount, address)` — validates, deducts, applies auto-approval rules
- `process_wagering(user_id, source_type, source_id, bet_amount, game_category)` — tracks wagering contributions, auto-completes bonuses
- `update_tournament_score(tournament_id, user_id, bet, win, multiplier)` — updates tournament leaderboard

**Realtime Subscriptions:** `events`, `outcomes`, `crypto_deposits`, `crypto_withdrawals`, `tournament_participants`, `slot_tournaments`

## API Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/auth/callback` | GET | Public | Supabase OAuth code exchange, redirects to `/sport` |
| `/api/scraper/prematch` | POST | `x-scraper-key` header | Ingests prematch events with markets/odds from Apify. Upserts sports, leagues, events, markets, outcomes. Tracks line movement via `previous_odds`. |
| `/api/scraper/live` | POST | `x-scraper-key` header | Updates live event status, scores, minute. Upserts live odds changes. |
| `/api/scraper/results` | POST | `x-scraper-key` header | Sets events to ended, suspends markets, triggers `/api/settlement` internally. |
| `/api/settlement` | POST | Internal | Settles bets for an event. Supports 15 market types (1X2, O/U, GG/NG, DC, HT_FT, Exact Score, Handicap, etc.). Credits winnings, refunds void bets. |
| `/api/risk-agent` | POST | Internal | Hybrid risk analysis: rule-based engine (stake spikes, velocity, win rate, KYC) + optional Claude AI analysis. Flags/blocks high-risk bets. |
| `/api/promo-engine` | POST | Internal | Processes wagering contributions from bets/casino rounds. Tracks progress, auto-converts bonus to real balance on completion. |

## Environment Variables
```env
# ═══ SUPABASE ═══
NEXT_PUBLIC_SUPABASE_URL=         # Supabase project URL (public)
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Supabase anon key (public, RLS-restricted)
SUPABASE_SERVICE_ROLE_KEY=        # Supabase service role key (server-only, bypasses RLS)

# ═══ ANTHROPIC (AI Risk Agent) ═══
ANTHROPIC_API_KEY=                # Claude API key for /api/risk-agent analysis

# ═══ APP ═══
NEXT_PUBLIC_APP_URL=              # App base URL (default: http://localhost:3000)
NEXT_PUBLIC_APP_NAME=             # App display name (default: VinciTu)

# ═══ SCRAPER (Apify webhook auth) ═══
SCRAPER_API_KEY=                  # Shared secret for x-scraper-key header auth on /api/scraper/* routes

# ═══ CRYPTO (future) ═══
# BLOCKCYPHER_API_KEY=            # Not yet implemented
# ALCHEMY_API_KEY=                # Not yet implemented
```
