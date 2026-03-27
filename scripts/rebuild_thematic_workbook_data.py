#!/usr/bin/env python3

import argparse
import base64
import gzip
import json
import math
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

import yfinance as yf
from openpyxl import load_workbook


THEME_NAME_MAP = {
    "AI Infra": "AI-Industrial",
    "Silver Economy": "Silver",
    "Batteries": "Battery",
    "Waste Management": "Waste",
    "Digital Finance": "Payments",
    "Legacy": "Legacy Software",
    "Water PFAs": "Water PFAS",
    "Securities": "Security",
}

DB_ROW_COLUMNS = [
    "id",
    "ticker",
    "company",
    "theme",
    "subTheme",
    "buyPrice",
    "currentPrice",
    "entryDate",
    "exitDate",
    "shares",
    "benchmarkWeight",
    "stopLossPct",
    "status",
    "notes",
    "marketBeta",
    "valueBeta",
    "momentumBeta",
    "weeklyReturn",
    "currentValue",
    "pnlFromExcel",
    "sellPrice",
    "costBasis",
    "sellTotal",
    "realizedPnl",
    "realizedPnlPct",
]

TRACKER_DATE_CUTOFF = date(2026, 3, 31)


def parse_args():
    parser = argparse.ArgumentParser(description="Rebuild workbook-backed thematic seed data")
    parser.add_argument("--positions", required=True, help="Path to current positions workbook")
    parser.add_argument("--tracker", required=True, help="Path to entry/exit tracker workbook")
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parents[1] / "lib" / "thematicWorkbookData.js"),
        help="Path to generated JS module",
    )
    return parser.parse_args()


def theme_name(raw):
    return THEME_NAME_MAP.get(raw, raw)


def date_key(value):
    if hasattr(value, "date"):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def normalize_ledger_date(value):
    if not hasattr(value, "date") and not isinstance(value, date):
        return None
    normalized = value.date() if hasattr(value, "date") else value
    while normalized > TRACKER_DATE_CUTOFF:
        normalized = normalized.replace(year=normalized.year - 1)
    return normalized.isoformat()


def as_float(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_existing_seed(seed_path):
    text = seed_path.read_text()
    b64 = "".join(re.findall(r'"([A-Za-z0-9+/=]+)"', text))
    rows = json.loads(gzip.decompress(base64.b64decode(b64)).decode())
    active_by_ticker = {}
    any_by_ticker = {}
    for row in rows:
        meta = {
            "company": row[2],
            "theme": row[3],
            "subTheme": row[4],
            "stopLossPct": float(row[11] or 0.1),
            "notes": row[13] or "",
            "marketBeta": float(row[14] or 1.0),
            "valueBeta": float(row[15] or 0.0),
            "momentumBeta": float(row[16] or 0.0),
            "benchmarkWeight": float(row[10] or 0.0),
            "buyPrice": float(row[5] or 0.0),
        }
        any_by_ticker.setdefault(row[1], meta)
        if row[12] == "active":
            active_by_ticker.setdefault(row[1], meta)
    return active_by_ticker, any_by_ticker


def load_positions(positions_path):
    wb = load_workbook(positions_path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    active_rows = []
    summary = {}
    for values in ws.iter_rows(min_row=2, values_only=True):
        symbol, subtheme, weight, current_value, pnl, pnl_pct = values[:6]
        if symbol and subtheme:
            active_rows.append(
                {
                    "ticker": symbol,
                    "theme": subtheme,
                    "weight": float(weight or 0),
                    "currentValue": float(current_value or 0),
                    "pnl": float(pnl or 0),
                    "pnlPct": float(pnl_pct or 0),
                }
            )
        elif symbol and subtheme is None:
            summary[symbol] = float(current_value or 0)
    return active_rows, summary


def load_tracker(tracker_path):
    wb = load_workbook(tracker_path, data_only=True)

    ledger = []
    ws_ledger = wb["Sheet1"]
    current_theme = None
    last_slot_dates = {2: None, 6: None, 10: None, 16: None, 20: None}
    for idx, row in enumerate(ws_ledger.iter_rows(min_row=2, values_only=True), start=2):
        if row[0]:
            current_theme = row[0]
            last_slot_dates = {2: None, 6: None, 10: None, 16: None, 20: None}
        ticker = row[1]
        if not ticker:
            continue

        entries = []
        for base in (2, 6, 10):
            entry_date, quantity, average_cost, total = row[base : base + 4]
            normalized_date = normalize_ledger_date(entry_date)
            if normalized_date:
                last_slot_dates[base] = normalized_date
            if quantity or average_cost or total:
                entries.append(
                    {
                        "date": normalized_date or last_slot_dates[base],
                        "qty": float(quantity or 0),
                        "cost": float(average_cost or 0),
                        "total": float(total or 0),
                    }
                )

        exits = []
        for base in (16, 20):
            exit_date, quantity, average_price, total = row[base : base + 4]
            normalized_date = normalize_ledger_date(exit_date)
            if normalized_date:
                last_slot_dates[base] = normalized_date
            if quantity or average_price or total:
                exits.append(
                    {
                        "date": normalized_date or last_slot_dates[base],
                        "qty": float(quantity or 0),
                        "price": float(average_price or 0),
                        "total": float(total or 0),
                    }
                )

        entry_qty = sum(entry["qty"] for entry in entries)
        exit_qty = sum(exit_row["qty"] for exit_row in exits)
        ledger.append(
            {
                "rowIdx": idx,
                "ticker": ticker,
                "theme": theme_name(current_theme),
                "rawTheme": current_theme,
                "entries": entries,
                "exits": exits,
                "entryQty": entry_qty,
                "exitQty": exit_qty,
                "remainingQty": entry_qty - exit_qty,
                "allFlag": row[15],
            }
        )

    ws_hist = wb["Historical Data"]
    headers = [cell.value for cell in ws_hist[1]]
    raw_by_date = {}
    for row in ws_hist.iter_rows(min_row=2, values_only=True):
        row_date = date_key(row[0])
        if not row_date:
            continue
        raw_by_date[row_date] = {
            headers[index]: as_float(row[index]) for index in range(1, len(headers)) if headers[index]
        }

    tickers = headers[1:]
    filled_by_date = {}
    last_valid = {ticker: None for ticker in tickers if ticker}
    for row_date in sorted(raw_by_date):
        current = {}
        for ticker in tickers:
            if not ticker:
                continue
            value = raw_by_date[row_date].get(ticker)
            if value is not None and not math.isnan(value):
                last_valid[ticker] = float(value)
            current[ticker] = last_valid[ticker]
        filled_by_date[row_date] = current

    return ledger, filled_by_date


def download_spy_history(start_date, end_date):
    history = yf.download("SPY", start=start_date, end=end_date, auto_adjust=False, progress=False)
    close_series = history["Close"]["SPY"] if getattr(history.columns, "nlevels", 1) > 1 else history["Close"]
    return {timestamp.strftime("%Y-%m-%d"): float(value) for timestamp, value in close_series.items() if not math.isnan(float(value))}


def find_metadata(ticker, active_meta, any_meta):
    return active_meta.get(ticker) or any_meta.get(ticker) or {
        "company": ticker,
        "theme": "",
        "subTheme": "",
        "stopLossPct": 0.1,
        "notes": "",
        "marketBeta": 1.0,
        "valueBeta": 0.0,
        "momentumBeta": 0.0,
        "benchmarkWeight": 0.0,
        "buyPrice": 0.0,
    }


def normalize_theme(value):
    return theme_name(value or "").strip().lower()


def match_active_ledger_rows(active_rows, ledger_rows):
    active_ledger_by_ticker = defaultdict(list)
    for row in ledger_rows:
        if row["remainingQty"] > 1e-8:
            active_ledger_by_ticker[row["ticker"]].append(row)

    used = set()
    for row in active_rows:
        candidates = active_ledger_by_ticker.get(row["ticker"], [])
        matched = None
        for candidate in candidates:
            if candidate["rowIdx"] in used:
                continue
            if normalize_theme(candidate["theme"]) == normalize_theme(row["theme"]):
                matched = candidate
                break
        if matched is None:
            for candidate in candidates:
                if candidate["rowIdx"] not in used:
                    matched = candidate
                    break
        if matched is None and candidates:
            matched = candidates[0]
        if matched is not None:
            used.add(matched["rowIdx"])
        row["matchedLedger"] = matched


def build_active_rows(active_rows, active_meta, any_meta, price_rows, snapshot_date, previous_week_date):
    current_shares_by_ticker = defaultdict(float)
    for row in active_rows:
        current_price = price_rows[snapshot_date].get(row["ticker"])
        if not current_price:
            raise ValueError(f"Missing snapshot price for {row['ticker']} on {snapshot_date}")
        previous_price = price_rows[previous_week_date].get(row["ticker"]) or current_price
        row["currentPrice"] = float(current_price)
        row["shares"] = row["currentValue"] / row["currentPrice"]
        row["costBasis"] = row["currentValue"] - row["pnl"]
        row["buyPrice"] = row["costBasis"] / row["shares"] if row["shares"] else row["currentPrice"]
        row["weeklyReturn"] = (row["currentPrice"] / previous_price) - 1 if previous_price else 0
        current_shares_by_ticker[row["ticker"]] += row["shares"]

    db_rows = []
    for index, row in enumerate(active_rows, start=1):
        meta = find_metadata(row["ticker"], active_meta, any_meta)
        matched = row.get("matchedLedger")
        entry_date = ""
        if matched:
            valid_dates = [entry["date"] for entry in matched["entries"] if entry["date"]]
            entry_date = valid_dates[0] if valid_dates else ""
        db_rows.append(
            [
                f"active-{index}",
                row["ticker"],
                meta["company"] or row["ticker"],
                row["theme"],
                meta["subTheme"] or row["theme"],
                row["buyPrice"],
                row["currentPrice"],
                entry_date,
                "",
                row["shares"],
                meta["benchmarkWeight"],
                meta["stopLossPct"],
                "active",
                meta["notes"] or f"{row['theme']} snapshot holding",
                meta["marketBeta"],
                meta["valueBeta"],
                meta["momentumBeta"],
                row["weeklyReturn"],
                row["currentValue"],
                row["pnl"],
                0,
                0,
                0,
                0,
                0,
            ]
        )
    return db_rows, current_shares_by_ticker


def build_benchmark_row(active_meta, any_meta, snapshot_date, spy_price, benchmark_value):
    meta = find_metadata("SPY", active_meta, any_meta)
    shares = benchmark_value / spy_price
    return [
        "benchmark-spy",
        "SPY",
        meta["company"] or "SPDR S&P 500 ETF Trust",
        "Benchmark",
        meta["subTheme"] or "Benchmark",
        spy_price,
        spy_price,
        snapshot_date,
        "",
        shares,
        meta["benchmarkWeight"],
        meta["stopLossPct"],
        "active",
        meta["notes"] or "S&P 500 core",
        1.0,
        meta["valueBeta"],
        meta["momentumBeta"],
        0,
        benchmark_value,
        0,
        0,
        0,
        0,
        0,
        0,
    ], shares


def build_exited_rows(ledger_rows, scale_by_ticker, active_meta, any_meta):
    db_rows = []
    counter = 1
    for row in ledger_rows:
        if row["exitQty"] <= 1e-8:
            continue

        scale = scale_by_ticker.get(row["ticker"], 1.0) if row["remainingQty"] > 1e-8 else 1.0
        sold_qty = row["exitQty"] * scale
        sold_total = sum(exit_row["total"] for exit_row in row["exits"]) * scale
        total_entry_cost = sum(entry["total"] for entry in row["entries"]) * scale
        total_entry_qty = row["entryQty"] * scale
        sold_cost_basis = total_entry_cost * (sold_qty / total_entry_qty) if total_entry_qty else 0
        realized_pnl = sold_total - sold_cost_basis
        realized_pnl_pct = realized_pnl / sold_cost_basis if sold_cost_basis else 0
        sell_price = sold_total / sold_qty if sold_qty else 0
        buy_price = sold_cost_basis / sold_qty if sold_qty else 0
        exit_dates = [exit_row["date"] for exit_row in row["exits"] if exit_row["date"]]
        entry_dates = [entry["date"] for entry in row["entries"] if entry["date"]]
        meta = find_metadata(row["ticker"], active_meta, any_meta)
        db_rows.append(
            [
                f"exited-{counter}",
                row["ticker"],
                meta["company"] or row["ticker"],
                row["theme"],
                meta["subTheme"] or row["theme"],
                buy_price or meta["buyPrice"],
                sell_price,
                entry_dates[0] if entry_dates else "",
                exit_dates[-1] if exit_dates else "",
                sold_qty,
                meta["benchmarkWeight"],
                meta["stopLossPct"],
                "exited",
                meta["notes"] or f"{row['theme']} exited position",
                meta["marketBeta"],
                meta["valueBeta"],
                meta["momentumBeta"],
                0,
                sold_total,
                realized_pnl,
                sell_price,
                sold_cost_basis,
                sold_total,
                realized_pnl,
                realized_pnl_pct,
            ]
        )
        counter += 1
    return db_rows


def build_scale_map(ledger_rows, current_shares_by_ticker):
    remaining_by_ticker = defaultdict(float)
    for row in ledger_rows:
        if row["remainingQty"] > 1e-8:
            remaining_by_ticker[row["ticker"]] += row["remainingQty"]

    scale = {}
    for ticker, remaining_qty in remaining_by_ticker.items():
        if remaining_qty > 0:
            scale[ticker] = current_shares_by_ticker[ticker] / remaining_qty
    return scale


def build_daily_series(ledger_rows, price_rows, spy_rows, scale_by_ticker, cash_value, benchmark_shares):
    transactions_by_date = defaultdict(lambda: {"buy": 0.0, "sell": 0.0})
    ledger_by_ticker = defaultdict(list)
    for row in ledger_rows:
        ledger_by_ticker[row["ticker"]].append(row)
        scale = scale_by_ticker.get(row["ticker"], 1.0) if row["remainingQty"] > 1e-8 else 1.0
        for entry in row["entries"]:
            if entry["date"]:
                transactions_by_date[entry["date"]]["buy"] += entry["total"] * scale
        for exit_row in row["exits"]:
            if exit_row["date"]:
                transactions_by_date[exit_row["date"]]["sell"] += exit_row["total"] * scale

    initial_cash = cash_value + sum(flow["buy"] - flow["sell"] for flow in transactions_by_date.values())
    cash_balance = initial_cash
    daily_rows = []
    for row_date in sorted(price_rows):
        flows = transactions_by_date[row_date]
        cash_balance -= flows["buy"]
        cash_balance += flows["sell"]

        stock_value = 0.0
        for ticker, rows in ledger_by_ticker.items():
            price = price_rows[row_date].get(ticker)
            if price is None:
                continue
            quantity = 0.0
            for row in rows:
                scale = scale_by_ticker.get(ticker, 1.0) if row["remainingQty"] > 1e-8 else 1.0
                held = 0.0
                for entry in row["entries"]:
                    if entry["date"] and entry["date"] <= row_date:
                        held += entry["qty"] * scale
                for exit_row in row["exits"]:
                    if exit_row["date"] and exit_row["date"] <= row_date:
                        held -= exit_row["qty"] * scale
                quantity += held
            stock_value += quantity * price

        benchmark_value = benchmark_shares * spy_rows[row_date]
        total_value = stock_value + benchmark_value + cash_balance
        daily_rows.append(
            {
                "date": row_date,
                "stockValue": stock_value,
                "benchmarkValue": benchmark_value,
                "cashValue": cash_balance,
                "portfolioValue": total_value,
            }
        )

    for index, row in enumerate(daily_rows):
        if index == 0:
            row["portfolioReturn"] = 0
            row["benchmarkReturn"] = 0
        else:
            previous = daily_rows[index - 1]
            row["portfolioReturn"] = (
                row["portfolioValue"] / previous["portfolioValue"] - 1 if previous["portfolioValue"] else 0
            )
            row["benchmarkReturn"] = (
                row["benchmarkValue"] / previous["benchmarkValue"] - 1 if previous["benchmarkValue"] else 0
            )
    return daily_rows


def build_weekly_history(daily_rows):
    weekly_groups = []
    current_group = []
    current_key = None

    for row in daily_rows:
        row_date = datetime.fromisoformat(row["date"])
        iso_key = (row_date.isocalendar().year, row_date.isocalendar().week)
        if current_key and iso_key != current_key:
            weekly_groups.append(current_group)
            current_group = []
        current_group.append(row)
        current_key = iso_key

    if current_group:
        weekly_groups.append(current_group)

    weekly_rows = []
    for index, group in enumerate(weekly_groups, start=1):
        portfolio_nav = 1.0
        benchmark_nav = 1.0
        for row in group:
            portfolio_nav *= 1 + row["portfolioReturn"]
            benchmark_nav *= 1 + row["benchmarkReturn"]
        portfolio_return = portfolio_nav - 1
        benchmark_return = benchmark_nav - 1
        weekly_rows.append(
            {
                "week": f"W{index}",
                "date": group[-1]["date"],
                "portfolioReturn": portfolio_return,
                "benchmarkReturn": benchmark_return,
                "marketContrib": benchmark_return,
                "valueContrib": 0,
                "momentumContrib": 0,
                "alpha": portfolio_return - benchmark_return,
            }
        )
    return weekly_rows


def sample_std(values):
    values = [float(value) for value in values]
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
    return math.sqrt(variance)


def build_payload(active_rows, exited_rows, weekly_history, summary):
    return {
        "snapshotDate": summary["snapshotDate"],
        "summary": summary,
        "activeRows": active_rows,
        "exitedRows": exited_rows,
        "weeklyHistory": weekly_history,
    }


def write_module(output_path, payload):
    encoded = base64.b64encode(gzip.compress(json.dumps(payload, separators=(",", ":")).encode())).decode()
    chunks = [encoded[index : index + 120] for index in range(0, len(encoded), 120)]
    lines = [
        'import { gunzipSync } from "node:zlib";',
        "",
        "const THEMATIC_WORKBOOK_B64 = [",
    ]
    lines.extend(f'  "{chunk}",' for chunk in chunks)
    lines.append('].join("");')
    lines.append("")
    lines.append(
        "const THEMATIC_WORKBOOK = JSON.parse(gunzipSync(Buffer.from(THEMATIC_WORKBOOK_B64, \"base64\")).toString(\"utf8\"));"
    )
    lines.append("")
    lines.append("export const THEMATIC_WORKBOOK_SNAPSHOT_DATE = THEMATIC_WORKBOOK.snapshotDate;")
    lines.append("export const THEMATIC_WORKBOOK_SUMMARY = THEMATIC_WORKBOOK.summary;")
    lines.append("export const THEMATIC_WORKBOOK_ACTIVE_ROWS = THEMATIC_WORKBOOK.activeRows;")
    lines.append("export const THEMATIC_WORKBOOK_EXITED_ROWS = THEMATIC_WORKBOOK.exitedRows;")
    lines.append("export const THEMATIC_WORKBOOK_WEEKLY_HISTORY = THEMATIC_WORKBOOK.weeklyHistory;")
    lines.append("")
    output_path.write_text("\n".join(lines) + "\n")


def main():
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    active_meta, any_meta = load_existing_seed(repo_root / "lib" / "thematicSeed.js")

    active_rows, summary_rows = load_positions(Path(args.positions))
    ledger_rows, price_rows = load_tracker(Path(args.tracker))

    snapshot_date = "2026-03-24"
    previous_week_date = "2026-03-17"
    spy_rows = download_spy_history("2025-11-01", "2026-03-27")
    if snapshot_date not in spy_rows:
        raise ValueError(f"Missing SPY close for {snapshot_date}")

    match_active_ledger_rows(active_rows, ledger_rows)
    active_db_rows, current_shares_by_ticker = build_active_rows(
        active_rows,
        active_meta,
        any_meta,
        price_rows,
        snapshot_date,
        previous_week_date,
    )
    scale_by_ticker = build_scale_map(ledger_rows, current_shares_by_ticker)

    benchmark_row, benchmark_shares = build_benchmark_row(
        active_meta,
        any_meta,
        snapshot_date,
        spy_rows[snapshot_date],
        summary_rows["In Benchmark"],
    )
    exited_db_rows = build_exited_rows(ledger_rows, scale_by_ticker, active_meta, any_meta)

    cash_value = summary_rows["Portfolio Value"] - summary_rows["Total Positions"] - summary_rows["In Benchmark"]
    daily_rows = build_daily_series(ledger_rows, price_rows, spy_rows, scale_by_ticker, cash_value, benchmark_shares)
    weekly_history = build_weekly_history(daily_rows)

    portfolio_returns = [row["portfolioReturn"] for row in weekly_history]
    benchmark_returns = [row["benchmarkReturn"] for row in weekly_history]
    summary = {
        "snapshotDate": snapshot_date,
        "stockValue": summary_rows["Total Positions"],
        "stockPnl": sum(row[19] for row in active_db_rows),
        "benchmarkValue": summary_rows["In Benchmark"],
        "cashValue": cash_value,
        "portfolioValue": summary_rows["Portfolio Value"],
        "benchmarkCurrentPrice": spy_rows[snapshot_date],
        "benchmarkShares": benchmark_shares,
        "portfolioVol": sample_std(portfolio_returns) * math.sqrt(52),
        "benchmarkVol": sample_std(benchmark_returns) * math.sqrt(52),
        "spyWeeklyReturn": weekly_history[-1]["benchmarkReturn"] if weekly_history else 0,
    }

    snapshot_row = next(row for row in daily_rows if row["date"] == snapshot_date)
    if round(snapshot_row["portfolioValue"], 2) != round(summary["portfolioValue"], 2):
        raise ValueError(
            f"Snapshot total mismatch: expected {summary['portfolioValue']:.2f}, got {snapshot_row['portfolioValue']:.2f}"
        )

    payload = build_payload([benchmark_row, *active_db_rows], exited_db_rows, weekly_history, summary)
    write_module(Path(args.output), payload)

    print(
        json.dumps(
            {
                "activeRows": len(payload["activeRows"]),
                "exitedRows": len(payload["exitedRows"]),
                "portfolioValue": round(summary["portfolioValue"], 2),
                "stockValue": round(summary["stockValue"], 2),
                "benchmarkValue": round(summary["benchmarkValue"], 2),
                "cashValue": round(summary["cashValue"], 2),
                "stockPnl": round(summary["stockPnl"], 2),
                "portfolioVol": round(summary["portfolioVol"], 4),
                "benchmarkVol": round(summary["benchmarkVol"], 4),
                "weeklyRows": len(payload["weeklyHistory"]),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
