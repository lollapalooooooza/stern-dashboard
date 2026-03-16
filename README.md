# Stern Dashboard 📚💹

A portfolio dashboard for the NYU Stern MIF workflow, with a built-in **Catalyst** research workspace for event-driven stock analysis.

Built with:
- Next.js
- React
- Recharts
- SQLite / libSQL-backed portfolio data
- external CatalystTracker backend for chart/news/forecast intelligence

---

## ✨ What this app includes

### Portfolio dashboard pages
- **Overview** — portfolio value, PnL, return, risk summary
- **Holdings** — active/exited positions, inline editing, search, save
- **Returns** — cumulative return and attribution views
- **Risk** — beta, tracking error, VaR, compliance checks
- **Stop-Loss** — 4σ stop-loss monitoring and alerts
- **Report** — editable report area and export helpers
- **Settings** — benchmark/risk inputs and config management
- **Catalyst** — integrated event-driven stock research terminal

---

## 🔍 Catalyst integration

The Catalyst page is an embedded research workspace connected to the separate `CatalystTracker` backend.

### Catalyst currently supports
- full-screen embedded Catalyst workspace inside the dashboard
- ticker search and add flow
- OHLC chart rendering
- news particle overlays on the chart
- hover-day news inspection
- news category filtering
- range-based move analysis
- similar-day lookup
- forecast panel with:
  - ticker-specific models when available
  - unified-model fallback when ticker-specific models are missing

### New ticker flow
When a ticker is newly added:
1. the frontend sends it to the Catalyst backend
2. backend fetches OHLC + news data asynchronously
3. backend aligns fetched news to trading days
4. frontend waits on ticker readiness and shows loading states
5. chart / news / forecast appear as data becomes available

This makes newly searched names like `BE`, `CSIQ`, or `IREN` much easier to onboard into the Catalyst view.

---

## 🏗️ Architecture

```text
stern-dashboard/
├── app/
│   ├── page.jsx                # Main dashboard shell
│   ├── catalyst/              # Embedded Catalyst UI
│   └── api/                   # Portfolio-related routes
├── lib/
│   └── db.js                  # Portfolio data layer
├── next.config.mjs
└── vercel.json
```

### Data split
This project has two different data systems:

#### 1. Portfolio dashboard data
Used for holdings, returns, risk, report, settings.

#### 2. Catalyst research data
Handled by external Catalyst backend for:
- ticker search
- OHLC
- aligned news
- category views
- forecast inference

---

## 🌐 Catalyst backend wiring

The frontend supports a direct public backend URL via:

```bash
NEXT_PUBLIC_CATALYST_API_URL=https://your-catalyst-backend/api
```

This is the recommended production setup.

There is also a local fallback path:

```text
/catalyst-api
```

which can be used in local development with rewrites.

---

## 🚀 Local development

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

### Production build

```bash
npm run build
npm run start
```

---

## 🧩 Catalyst requirements

For the Catalyst page to function fully, the external backend should provide:
- `/api/health`
- `/api/stocks/search`
- `/api/stocks/{symbol}/ohlc`
- `/api/stocks/{symbol}/status`
- `/api/news/{symbol}/particles`
- `/api/predict/{symbol}/forecast`

If forecast models are unavailable for a specific ticker, the backend can fall back to unified models.

---

## 📌 Notes

- Catalyst is designed as a research workspace, not just a chart widget.
- Newly added tickers may take a short time to ingest before all downstream views populate.
- Production Catalyst behavior depends on the health and configuration of the external backend.

---

## 📜 License

Private / project-specific unless otherwise noted.
