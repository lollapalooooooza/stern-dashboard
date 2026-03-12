# NYU Stern Management Investment Fund — Thematic Dashboard

## Overview

A full-stack portfolio management dashboard for the NYU Stern MIF Thematic Investment Team. Built with Next.js, React, Recharts, and Turso (cloud SQLite). Deployed on Vercel with automated daily price updates.

**Live:** Hosted on Vercel  
**Database:** Turso (libSQL cloud)  
**Groups:** Thematic · Opportunistic · Systematic · Bond (separate databases)

---

## Architecture

```
stern-dashboard/
├── app/
│   ├── page.js                  # Main React dashboard (all 7 pages)
│   └── api/
│       ├── holdings/route.js    # CRUD for portfolio positions
│       ├── settings/route.js    # Risk parameters & limits
│       ├── history/route.js     # Weekly return history
│       ├── report/route.js      # Team report content
│       ├── prices/route.js      # Yahoo Finance price fetcher
│       ├── news/route.js        # Google News RSS feed
│       ├── reset/route.js       # Reset database to defaults
│       └── cron/route.js        # Daily automated price + return job
├── lib/
│   └── db.js                    # Turso database (tables, seed, CRUD)
├── vercel.json                  # Cron schedule
└── next.config.mjs
```

### Data Flow

1. **Page load** → Frontend calls `/api/holdings`, `/api/settings`, `/api/history`, `/api/report`
2. **Auto price fetch** → Frontend calls `/api/prices` → Yahoo Finance → writes updated prices to Turso
3. **Daily cron (5:30 PM ET)** → Vercel triggers `/api/cron` → fetches prices → records daily snapshot → on Fridays, computes and stores weekly return
4. **Save buttons** → Frontend POST/PUT to API routes → writes to Turso

### Multi-Group System

Four independent databases using table prefixes:
- `thematic_holdings`, `thematic_settings`, `thematic_weekly_history`, `thematic_report`
- `opportunistic_holdings`, `opportunistic_settings`, ...
- `systematic_holdings`, ...
- `bond_holdings`, ...

Each group has its own holdings, settings, weekly history, and report. Switching groups in the sidebar loads entirely different data.

---

## Dashboard Pages

### 1. Overview
- **Portfolio Value**: Current market value of all active positions
- **Unrealized PnL**: Open positions gain/loss with % relative to starting value
- **Realized PnL %**: Closed positions gain/loss as % of starting portfolio value
- **Total Return**: Cumulative return from actual account balances (matches chart)
- **Portfolio Beta, Tracking Error, VaR**: Live risk metrics
- **Theme Allocation Pie Chart**: Donut chart with side legend
- **Cumulative Return Chart**: Portfolio vs S&P 500 from account balances
- **PnL Bar Chart**: Top and bottom 5 holdings by dollar PnL
- **Realized P&L Summary**: Winners vs losers count and totals
- **Portfolio News**: Live news feed via Google News RSS

### 2. Holdings
- Full table of all active and exited positions
- **Active/Exited/All** filter tabs
- Inline editing, sorting by any column, search, theme filter
- **Exit Position** button: Records sell price, computes realized PnL, saves to DB
- **Fetch Prices** button: Pulls live Yahoo Finance prices
- **Save** button: Persists all changes to database
- Theme badges with color coding

### 3. Returns
- **Cumulative Return**: From actual account balance weekly history
- **Weekly Attribution**: Stacked bar chart (Market, Value, Momentum, Alpha)
- **Basket-Level Attribution**: Per-theme table including both active AND exited positions
  - Shows Deployed $, PnL $, Return %, Avg β, Market Contribution, Alpha

### 4. Risk
- Portfolio β, Tracking Error, VaR (95%, 99%), Systematic/Idiosyncratic Vol
- **Compliance Dashboard**: Utilization bars for each limit
- **Risk by Theme**: Bar chart with toggle between absolute risk and **Risk/Weight** (risk contribution per unit of capital)
- **Theme Risk Profile**: Table with Weight, Avg β, Risk %, Risk/Weight

### 5. Stop-Loss
- 4σ stop-loss monitoring for all active positions
- Breach/Warning/OK status with progress bars
- Filter by status or theme

### 6. Team Report
- Editable report draft with save button
- Upload PDF/DOCX with viewer
- Google Doc embed with save/edit
- Print/PDF export
- Auto-populated summary stats

### 7. Settings
- Editable benchmark and factor inputs
- Compliance limit configuration
- JSON export/import, CSV export
- Reset to defaults
- Save button

---

## Financial Formulas

### Return Calculation

**Source of truth:** Actual account balance from the Portfolio Balance Tracker.

```
Weekly Return = (Balance_end - Balance_start) / Balance_start
Cumulative Return = Σ(weekly returns)  [additive approximation]
Starting Value = Current Value / (1 + Cumulative Return)
```

The cumulative return chart, the Total Return card, and all percentage displays derive from the same weekly history data, ensuring consistency.

**Basket-Level Attribution** includes both active and exited positions:

```
Theme PnL = Σ(position PnL) for all active + exited in theme
Theme Return = Theme PnL / Theme Deployed Capital
Theme Deployed = Σ(cost basis) for all positions in theme
```

### Portfolio Beta

```
β_portfolio = Σ(w_i × β_i)
```

Where `w_i` = weight of position i (current value / total portfolio value) and `β_i` = market beta of position i.

**Stock-Only Beta** excludes the SPY benchmark allocation:

```
β_stocks = Σ(w_i × β_i) / Σ(w_i)   for i ≠ SPY
```

### Risk Contribution

Each theme's contribution to total portfolio risk:

```
Risk Contribution_theme = Σ(w_i × β_i) for all holdings in theme
Risk % = Risk Contribution_theme / β_portfolio
```

**Weighted Risk (Risk/Weight):**

```
Weighted Risk = Risk % / Weight %
```

- Value > 1.0: Theme contributes MORE risk than its capital weight → risk-heavy
- Value < 1.0: Theme contributes LESS risk than its capital weight → risk-efficient
- Value = 1.0: Risk proportional to capital

### Volatility Decomposition

**Systematic Volatility** (market-driven):

```
σ_systematic = |β_portfolio| × σ_benchmark
```

**Idiosyncratic Volatility** (stock-specific):

```
σ_idiosyncratic = √(max(σ²_portfolio - σ²_systematic, 0))
```

**Tracking Error** (deviation from benchmark):

```
TE = √((β_portfolio - 1)² × σ²_benchmark + σ²_idiosyncratic)
```

### Value at Risk (Parametric)

Assumes normal distribution of returns:

```
Daily VaR 95% = σ_annual / √252 × 1.645
Daily VaR 99% = σ_annual / √252 × 2.326
Weekly VaR 95% = Daily VaR 95% × √5
Weekly VaR 99% = Daily VaR 99% × √5
```

Where `σ_annual` = annualized portfolio volatility (from settings).

### Compliance

```
Utilization = Current / Limit
Status:
  BREACH  if Utilization > 100%
  WARNING if Utilization > 85%
  OK      otherwise
```

Monitored metrics:
| Metric | Default Limit |
|--------|--------------|
| Daily VaR 95% | 2.5% |
| Tracking Error | 6.0% |
| Beta Deviation from 1 | 0.30 |
| Systematic Volatility | 20.0% |
| Max Single Stock Weight | 8.0% |
| S&P 500 Weight | 50.0% |

---

## Stop-Loss Framework

Uses a **4-sigma stop-loss** derived from the Portfolio Analysis Output. Each position has a `stopLossPct` representing the maximum acceptable drawdown from entry price.

### Stop-Loss Price

```
Stop-Loss Price = Buy Price × (1 - Stop-Loss %)
```

Example: NVDA bought at $179.87 with 9.4% stop-loss:
```
SL Price = $179.87 × (1 - 0.094) = $162.96
```

### Distance to Stop-Loss

```
Distance = (Current Price - SL Price) / Current Price
```

### Alert Status

```
BREACH  if Current Price ≤ SL Price        → EXIT IMMEDIATELY
WARNING if Distance < Warning Buffer (5%)  → MONITOR CLOSELY
OK      otherwise                          → HOLD
```

### Stop-Loss Percentages by Position

The 4σ stop-loss percentages vary by stock volatility. Higher-beta stocks get wider stops:

| Range | Example Stocks |
|-------|---------------|
| 3-6% | AWK, RSG, ABBV, WM, VTR, WELL (low-vol utilities/REITs) |
| 6-10% | NVDA, TSM, TSLA, GOOG, MSI, GE, RTX (large-cap growth) |
| 10-20% | BABA, BWXT, CLH, ADUS, NOW, RDDT, SNOW (mid-vol) |
| 20-31% | BE, NBIS, IREN, APLD, VRT, LITE (high-vol AI/infra) |

---

## Exited Positions

The dashboard tracks all 60 exited positions with full realized P&L:

```
Realized PnL = Sell Total - Cost Basis
Realized PnL % = Realized PnL / Cost Basis
```

Exited positions are stored permanently in the database with:
- `status = "exited"`
- `exitDate` = date of exit
- `sellPrice` = price at which position was sold
- `costBasis` = total capital deployed at entry
- `sellTotal` = total proceeds from sale
- `realizedPnl` = dollar profit/loss
- `realizedPnlPct` = percentage return

### Exit Functionality

Click the exit icon (↗) on any active holding in the Holdings table:
1. Records current market price as sell price
2. Computes `costBasis = buyPrice × shares`
3. Computes `sellTotal = currentPrice × shares`
4. Computes `realizedPnl = sellTotal - costBasis`
5. Sets `status = "exited"` and saves to database

Exited positions remain in the database permanently. They appear in:
- Holdings table (Exited tab, dimmed rows)
- Overview realized P&L summary
- Returns basket-level attribution (per-theme PnL includes exits)

---

## Automated Daily Updates (Cron)

**Schedule:** Every weekday at 5:30 PM Eastern (30 min after market close)  
**Config:** `vercel.json` → `"schedule": "30 21 * * 1-5"`

### Daily Process

1. Skip weekends automatically
2. For each group (thematic, opportunistic, systematic, bond):
   a. Fetch all active holdings from database
   b. Call Yahoo Finance for latest prices
   c. Update `currentPrice`, `currentValue`, `pnlFromExcel` in database
   d. Record daily snapshot: date, portfolio value, daily return
3. **On Fridays only:**
   a. Sum daily returns for the week
   b. Compute factor attribution (market, value, momentum, alpha)
   c. Insert new row into `weekly_history` table
   d. This automatically extends the cumulative return chart

### Price Fetch Strategy

Three fallback methods (tries in order):
1. Yahoo Finance v7 batch quote (`query1` then `query2`)
2. Yahoo cookie + crumb authentication
3. Individual v8 chart requests (for remaining tickers)

---

## Setup

### Prerequisites
- Node.js 18+
- Turso account (free tier)
- Vercel account

### Installation

```bash
# Clone
git clone https://github.com/lollapalooooooza/stern-dashboard.git
cd stern-dashboard

# Install
npm install @libsql/client

# Turso setup
brew install tursodatabase/tap/turso
turso auth signup
turso db create stern-mif
turso db show stern-mif --url        # → TURSO_DATABASE_URL
turso db tokens create stern-mif     # → TURSO_AUTH_TOKEN

# Local env
echo "TURSO_DATABASE_URL=libsql://stern-mif-YOUR_USER.turso.io" > .env.local
echo "TURSO_AUTH_TOKEN=your-token" >> .env.local

# Run
npm run dev
```

### Vercel Deployment

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `CRON_SECRET` (any random string)
4. Deploy — database auto-seeds on first request

### Reset Database

- **UI:** Settings page → Reset button
- **API:** `POST /api/reset` with `{"group": "thematic"}`
- **Turso Shell:** Drop tables and let auto-seed recreate

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18, Next.js 14 (App Router) |
| Charts | Recharts |
| Icons | Lucide React |
| Styling | Tailwind CSS, DM Sans font |
| Database | Turso (libSQL / cloud SQLite) |
| Hosting | Vercel (serverless) |
| Cron | Vercel Cron Jobs |
| Prices | Yahoo Finance API (server-side) |
| News | Google News RSS |
