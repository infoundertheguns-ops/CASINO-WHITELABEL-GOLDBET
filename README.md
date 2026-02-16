# 🎲 VinciTu — Scommesse, Casino & Crypto

Full-stack iGaming platform built with Next.js 14, Supabase, and Tailwind CSS.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Create Supabase project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Copy your **Project URL** and **Anon Key** from Settings → API

### 3. Environment setup
```bash
cp .env.example .env.local
# Edit .env.local with your Supabase credentials
```

### 4. Run database migrations
```bash
npx supabase init
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Or manually run the SQL files in Supabase SQL Editor:
- `supabase/migrations/001_initial_schema.sql` (core: 45+ tables)
- `supabase/migrations/002_promotions.sql` (bonus system: 6 tables + functions)

### 5. Generate TypeScript types
```bash
npm run db:types
```

### 6. Start development
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
vincitu/
├── app/
│   ├── (auth)/          # Login, Register, Forgot Password
│   ├── (player)/        # Sport, Casino, Promo, Wallet, Account
│   ├── (admin)/         # Back Office (18 modules)
│   └── api/             # API routes
├── components/
│   ├── ui/              # Design system (Button, Badge, KPI, Table, Input)
│   └── layout/          # PlayerNav, AdminSidebar, AdminTopBar
├── lib/
│   ├── supabase/        # Client, Server, Middleware helpers
│   ├── hooks/           # useAuth (Zustand store)
│   ├── types/           # TypeScript interfaces
│   └── utils/           # Formatting, helpers
├── styles/
│   └── globals.css      # Tailwind + custom design tokens
└── supabase/
    └── migrations/      # SQL schema files
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Styling | Tailwind CSS |
| State | Zustand |
| Types | TypeScript |

## Routes

### Player
- `/` — Landing page
- `/login` `/register` `/forgot-password` — Auth
- `/sport` — Scommesse sportive
- `/casino` — Casino lobby
- `/promo` — Promozioni & tornei
- `/wallet` — Crypto wallet
- `/account` — Profilo utente

### Admin
- `/admin/dashboard` — Overview
- `/admin/sportsbook` — Bets, Settlement, Risk
- `/admin/casino` — Provider, Sessions
- `/admin/promos` — Promos, Wagering, Tournaments, Analytics
- `/admin/crypto` — Withdrawals, Deposits, Treasury, AML
- `/admin/management` — Users, Agents, Config, Audit
