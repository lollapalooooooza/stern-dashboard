"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { catalystApi } from './api';
import StockSelector from './components/StockSelector';
import CandlestickChart from './components/CandlestickChart';
import NewsPanel from './components/NewsPanel';
import NewsCategoryPanel from './components/NewsCategoryPanel';
import RangeAnalysisPanel from './components/RangeAnalysisPanel';
import RangeQueryPopup from './components/RangeQueryPopup';
import RangeNewsPanel from './components/RangeNewsPanel';
import SimilarDaysPanel from './components/SimilarDaysPanel';
import PredictionPanel from './components/PredictionPanel';
import ToastContainer from './components/Toast';
import './catalyst.css';

interface RangeSelection {
  startDate: string;
  endDate: string;
  priceChange?: number;
  popupX?: number;
  popupY?: number;
}

interface ArticleSelection {
  newsId: string;
  date: string;
}

interface Holding {
  ticker: string;
  theme?: string;
  subTheme?: string;
  [key: string]: unknown;
}

interface Props {
  holdings: Holding[];
}

export default function CatalystPage({ holdings }: Props) {
  const [activeTickers, setActiveTickers] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [hoveredOhlc, setHoveredOhlc] = useState<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    change: number;
  } | null>(null);
  const [selectedRange, setSelectedRange] = useState<RangeSelection | null>(null);
  const [rangeQuestion, setRangeQuestion] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<ArticleSelection | null>(null);
  const [lockedArticle, setLockedArticle] = useState<ArticleSelection | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeCategoryIds, setActiveCategoryIds] = useState<string[]>([]);
  const [activeCategoryColor, setActiveCategoryColor] = useState<string | null>(null);
  const [tickerLoading, setTickerLoading] = useState(false);
  const [tickerLoadingMessage, setTickerLoadingMessage] = useState('');

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ct-watchlist') || '[]'); } catch { return []; }
  });

  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [chartRect, setChartRect] = useState<DOMRect | undefined>(undefined);

  // Derive ticker groups from holdings by subTheme
  const tickerGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const h of holdings) {
      const key = h.subTheme || h.theme || 'Other';
      if (!groups[key]) groups[key] = [];
      if (!groups[key].includes(h.ticker)) {
        groups[key].push(h.ticker);
      }
    }
    return Object.keys(groups).length > 0 ? groups : undefined;
  }, [holdings]);

  // Persist watchlist
  useEffect(() => {
    localStorage.setItem('ct-watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  const toggleWatchlist = useCallback((sym: string) => {
    setWatchlist(prev => prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (selectedRange) { setSelectedRange(null); setRangeQuestion(null); }
        else if (lockedArticle) { setLockedArticle(null); setSelectedArticle(null); }
        else if (selectedDay) { setSelectedDay(null); }
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('chart-navigate', { detail: { direction: e.key === 'ArrowLeft' ? -1 : 1 } }));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRange, lockedArticle, selectedDay]);

  // Fetch active tickers from backend + merge with holdings tickers
  useEffect(() => {
    catalystApi
      .get('stocks')
      .then((res) => {
        const backendTickers: string[] = res.data
          .filter((t: { last_ohlc_fetch?: string }) => t.last_ohlc_fetch)
          .map((t: { symbol: string }) => t.symbol);

        // Merge holdings tickers with backend tickers
        const holdingTickers = holdings.map(h => h.ticker);
        const merged = Array.from(new Set([...backendTickers, ...holdingTickers]));
        setActiveTickers(merged);
        if (merged.length > 0 && !selectedSymbol) {
          // Prefer first holding ticker if available
          const firstHolding = holdingTickers.find(t => backendTickers.includes(t));
          setSelectedSymbol(firstHolding || merged[0]);
        }
      })
      .catch(() => {
        // Fallback to holdings tickers only
        const holdingTickers = holdings.map(h => h.ticker);
        if (holdingTickers.length > 0) {
          setActiveTickers(holdingTickers);
          if (!selectedSymbol) setSelectedSymbol(holdingTickers[0]);
        }
      });
  }, [holdings]);

  useEffect(() => {
    if (selectedRange && chartAreaRef.current) {
      setChartRect(chartAreaRef.current.getBoundingClientRect());
    }
  }, [selectedRange]);

  const handleHover = useCallback(
    (date: string | null, ohlc?: { date: string; open: number; high: number; low: number; close: number; change: number }) => {
      if (!lockedArticle) {
        setHoveredDate(date);
      }
      setHoveredOhlc(ohlc || null);
    },
    [lockedArticle]
  );

  const handleRangeSelect = useCallback((range: RangeSelection | null) => {
    setSelectedRange(range);
    setRangeQuestion(null);
    if (range) {
      setSelectedDay(null);
      setSelectedArticle(null);
      setLockedArticle(null);
    }
  }, []);

  const handleArticleSelect = useCallback((article: ArticleSelection | null) => {
    if (article === null) {
      setLockedArticle(null);
      setSelectedArticle(null);
      return;
    }
    setLockedArticle((prev) => {
      if (prev && prev.newsId === article.newsId) {
        setSelectedArticle(null);
        return null;
      }
      setSelectedArticle(article);
      setSelectedRange(null);
      setRangeQuestion(null);
      setSelectedDay(null);
      setHoveredDate(article.date);
      return article;
    });
  }, []);

  const handleDayClick = useCallback((date: string) => {
    setSelectedDay(date);
    setSelectedRange(null);
    setRangeQuestion(null);
    setSelectedArticle(null);
    setLockedArticle(null);
  }, []);

  const handleRangeAsk = useCallback((question: string) => {
    setRangeQuestion(question);
  }, []);

  const handleCategoryChange = useCallback((category: string | null, articleIds: string[], color?: string) => {
    setActiveCategory(category);
    setActiveCategoryIds(articleIds);
    setActiveCategoryColor(color ?? null);
  }, []);

  async function handleSelectSymbol(symbol: string) {
    setSelectedSymbol(symbol);
    setHoveredDate(null);
    setHoveredOhlc(null);
    setSelectedRange(null);
    setRangeQuestion(null);
    setSelectedDay(null);
    setSelectedArticle(null);
    setLockedArticle(null);
    setActiveCategory(null);
    setActiveCategoryIds([]);
    setActiveCategoryColor(null);

    try {
      const res = await catalystApi.get(`stocks/${symbol}/status`);
      if (!res.data?.has_ohlc) {
        catalystApi.post('stocks', { symbol }).catch(console.error);
        await waitForTickerReady(symbol);
      }
    } catch {
      // If status check fails, try a best-effort refresh anyway.
      catalystApi.post('stocks', { symbol }).catch(console.error);
    }
  }

  async function waitForTickerReady(symbol: string) {
    setTickerLoading(true);
    setTickerLoadingMessage(`Fetching ${symbol} market data...`);
    for (let i = 0; i < 24; i++) {
      try {
        const res = await catalystApi.get(`stocks/${symbol}/status`);
        const status = res.data;
        if (status.has_ohlc) {
          setTickerLoading(false);
          setTickerLoadingMessage('');
          return true;
        }
        if (status.has_news || status.has_aligned_news) {
          setTickerLoadingMessage(`Preparing ${symbol} news timeline...`);
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    setTickerLoading(false);
    setTickerLoadingMessage('');
    return false;
  }

  async function handleAddTicker(symbol: string) {
    if (!activeTickers.includes(symbol)) {
      setActiveTickers((prev) => [...prev, symbol]);
      setSelectedSymbol(symbol);
      catalystApi.post('stocks', { symbol }).catch(console.error);
      await waitForTickerReady(symbol);
    }
  }

  const effectiveDate = lockedArticle?.date ?? hoveredDate;
  const isLocked = lockedArticle !== null;

  function renderRightPanel() {
    if (selectedRange && rangeQuestion) {
      return (
        <RangeAnalysisPanel
          symbol={selectedSymbol}
          startDate={selectedRange.startDate}
          endDate={selectedRange.endDate}
          question={rangeQuestion}
          onClear={() => {
            setSelectedRange(null);
            setRangeQuestion(null);
          }}
        />
      );
    }
    if (selectedRange && !rangeQuestion) {
      return (
        <RangeNewsPanel
          symbol={selectedSymbol}
          startDate={selectedRange.startDate}
          endDate={selectedRange.endDate}
          priceChange={selectedRange.priceChange}
          onClose={() => setSelectedRange(null)}
          onAskAI={handleRangeAsk}
        />
      );
    }
    if (selectedDay) {
      return (
        <SimilarDaysPanel
          symbol={selectedSymbol}
          date={selectedDay}
          onClose={() => setSelectedDay(null)}
        />
      );
    }
    return (
      <NewsPanel
        symbol={selectedSymbol}
        hoveredDate={effectiveDate}
        onFindSimilar={(_newsId: string) => {
          if (effectiveDate) handleDayClick(effectiveDate);
        }}
        highlightedNewsId={selectedArticle?.newsId || null}
        isLocked={isLocked}
        onUnlock={() => {
          setLockedArticle(null);
          setSelectedArticle(null);
        }}
        highlightedCategoryIds={activeCategoryIds.length > 0 ? activeCategoryIds : undefined}
      />
    );
  }

  return (
    <div className="catalyst-wrapper" style={{ height: '100%', minHeight: 0 }}>
      <div className="app">
        <header className="app-header">
          <div className="header-gradient-line" />
          <div className="header-content">
            <div className="header-brand">
              <svg className="brand-logo" width="28" height="28" viewBox="0 0 28 28" fill="none">
                <rect width="28" height="28" rx="6" fill="url(#logo-grad-cw)" />
                <path d="M6 18L10 12L14 15L18 8L22 11" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <defs>
                  <linearGradient id="logo-grad-cw" x1="0" y1="0" x2="28" y2="28">
                    <stop stopColor="#667eea" />
                    <stop offset="1" stopColor="#00e5ff" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="brand-text">CatalystTracker</span>
            </div>
            <StockSelector
              activeTickers={activeTickers}
              selectedSymbol={selectedSymbol}
              onSelect={handleSelectSymbol}
              onAdd={handleAddTicker}
              watchlist={watchlist}
              onToggleWatchlist={toggleWatchlist}
              groups={tickerGroups}
            />
            {selectedRange ? (
              <div className="header-ohlc">
                <span className="ohlc-date">{selectedRange.startDate} ~ {selectedRange.endDate}</span>
                <span className="range-badge">Range Selected</span>
              </div>
            ) : hoveredOhlc ? (
              <div className="header-ohlc">
                <span className="ohlc-date">{hoveredOhlc.date}</span>
                <span className="ohlc-label">O</span>
                <span className="ohlc-val">${hoveredOhlc.open.toFixed(2)}</span>
                <span className="ohlc-label">H</span>
                <span className="ohlc-val">${hoveredOhlc.high.toFixed(2)}</span>
                <span className="ohlc-label">L</span>
                <span className="ohlc-val">${hoveredOhlc.low.toFixed(2)}</span>
                <span className="ohlc-label">C</span>
                <span className="ohlc-val">${hoveredOhlc.close.toFixed(2)}</span>
                <span className={`ohlc-change ${hoveredOhlc.change >= 0 ? 'up' : 'down'}`}>
                  {hoveredOhlc.change >= 0 ? '+' : ''}
                  {hoveredOhlc.change.toFixed(2)}%
                </span>
              </div>
            ) : null}
          </div>
        </header>

        <main className="app-main">
          <div className="chart-area" ref={chartAreaRef}>
            {selectedSymbol ? (
              <>
                <CandlestickChart
                  symbol={selectedSymbol}
                  lockedNewsId={lockedArticle?.newsId ?? null}
                  highlightedArticleIds={activeCategoryIds.length > 0 ? activeCategoryIds : null}
                  highlightColor={activeCategoryColor}
                  onHover={handleHover}
                  onRangeSelect={handleRangeSelect}
                  onArticleSelect={handleArticleSelect}
                  onDayClick={handleDayClick}
                />
                {selectedRange && !rangeQuestion && (
                  <RangeQueryPopup
                    range={selectedRange}
                    chartRect={chartRect}
                    onAsk={handleRangeAsk}
                    onClose={() => setSelectedRange(null)}
                  />
                )}
              </>
            ) : (
              <div className="chart-placeholder">Select a ticker to view the chart</div>
            )}
          </div>
          {selectedSymbol && (
            <div className="prediction-area">
              <PredictionPanel symbol={selectedSymbol} />
            </div>
          )}
          <div className="news-area">
            {tickerLoading ? (
              <div className="news-empty">Preparing news for {selectedSymbol}...</div>
            ) : (
              <>
                {selectedSymbol && (
                  <NewsCategoryPanel
                    symbol={selectedSymbol}
                    activeCategory={activeCategory}
                    onCategoryChange={handleCategoryChange}
                  />
                )}
                {renderRightPanel()}
              </>
            )}
          </div>
        </main>
        <ToastContainer />
      </div>
    </div>
  );
}

