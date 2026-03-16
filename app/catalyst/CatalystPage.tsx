"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { catalystApi } from './api';
import StockSelector from './components/StockSelector';
import CandlestickChart from './components/CandlestickChart';
import NewsPanel from './components/NewsPanel';
import NewsCategoryPanel from './components/NewsCategoryPanel';
import RangeAnalysisPanel from './components/RangeAnalysisPanel';
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

const RANGE_PRESETS = [
  "What's driving the price movement?",
  'Summarize key news in this period',
  'What are the bull/bear factors?',
];

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
  const [tickerSwitching, setTickerSwitching] = useState(false);
  const [predView, setPredView] = useState<'prediction' | 'ask'>('prediction');
  const [customRangeQuestion, setCustomRangeQuestion] = useState('');

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('ct-watchlist') || '[]');
    } catch {
      return [];
    }
  });

  const chartAreaRef = useRef<HTMLDivElement>(null);

  const tickerGroups = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const h of holdings) {
      const key = h.subTheme || h.theme || 'Other';
      if (!groups[key]) groups[key] = [];
      if (!groups[key].includes(h.ticker)) groups[key].push(h.ticker);
    }
    return Object.keys(groups).length > 0 ? groups : undefined;
  }, [holdings]);

  useEffect(() => {
    localStorage.setItem('ct-watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  const toggleWatchlist = useCallback((sym: string) => {
    setWatchlist((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (selectedRange) {
          setSelectedRange(null);
          setRangeQuestion(null);
          setPredView('prediction');
        } else if (lockedArticle) {
          setLockedArticle(null);
          setSelectedArticle(null);
        } else if (selectedDay) {
          setSelectedDay(null);
        }
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('chart-navigate', { detail: { direction: e.key === 'ArrowLeft' ? -1 : 1 } }));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRange, lockedArticle, selectedDay]);

  useEffect(() => {
    catalystApi
      .get('stocks')
      .then((res) => {
        const backendTickers: string[] = res.data
          .filter((t: { last_ohlc_fetch?: string }) => t.last_ohlc_fetch)
          .map((t: { symbol: string }) => t.symbol);
        const holdingTickers = holdings.map((h) => h.ticker);
        const merged = Array.from(new Set([...backendTickers, ...holdingTickers]));
        setActiveTickers(merged);
        if (merged.length > 0 && !selectedSymbol) {
          const firstHolding = holdingTickers.find((t) => backendTickers.includes(t));
          setSelectedSymbol(firstHolding || merged[0]);
        }
      })
      .catch(() => {
        const holdingTickers = holdings.map((h) => h.ticker);
        if (holdingTickers.length > 0) {
          setActiveTickers(holdingTickers);
          if (!selectedSymbol) setSelectedSymbol(holdingTickers[0]);
        }
      });
  }, [holdings]);

  const handleHover = useCallback(
    (date: string | null, ohlc?: { date: string; open: number; high: number; low: number; close: number; change: number }) => {
      if (!lockedArticle) setHoveredDate(date);
      setHoveredOhlc(ohlc || null);
    },
    [lockedArticle]
  );

  const handleRangeSelect = useCallback((range: RangeSelection | null) => {
    setSelectedRange(range);
    setRangeQuestion(null);
    setCustomRangeQuestion('');
    setPredView(range ? 'ask' : 'prediction');
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
      setPredView('prediction');
      setSelectedDay(null);
      setHoveredDate(article.date);
      return article;
    });
  }, []);

  const handleDayClick = useCallback((date: string) => {
    setSelectedDay(date);
    setSelectedRange(null);
    setRangeQuestion(null);
    setPredView('prediction');
    setSelectedArticle(null);
    setLockedArticle(null);
  }, []);

  const handleRangeAsk = useCallback((question: string) => {
    setRangeQuestion(question);
    setPredView('ask');
  }, []);

  const handleCategoryChange = useCallback((category: string | null, articleIds: string[], color?: string) => {
    setActiveCategory(category);
    setActiveCategoryIds(articleIds);
    setActiveCategoryColor(color ?? null);
  }, []);

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

  async function handleSelectSymbol(symbol: string) {
    if (!symbol || symbol === selectedSymbol) return;
    setSelectedSymbol(symbol);
    setHoveredDate(null);
    setHoveredOhlc(null);
    setSelectedRange(null);
    setRangeQuestion(null);
    setPredView('prediction');
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
      catalystApi.post('stocks', { symbol }).catch(console.error);
    }
  }

  useEffect(() => {
    if (!selectedSymbol) return;
    const t = window.setTimeout(() => setTickerSwitching(false), 800);
    return () => window.clearTimeout(t);
  }, [selectedSymbol]);

  async function handleAddTicker(symbol: string) {
    if (!activeTickers.includes(symbol)) {
      setActiveTickers((prev) => [...prev, symbol]);
      setSelectedSymbol(symbol);
      setPredView('prediction');
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
            setPredView('prediction');
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
          onClose={() => {
            setSelectedRange(null);
            setPredView('prediction');
          }}
        />
      );
    }
    if (selectedDay) {
      return <SimilarDaysPanel symbol={selectedSymbol} date={selectedDay} onClose={() => setSelectedDay(null)} />;
    }
    return (
      <NewsPanel
        key={`news-${selectedSymbol}`}
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
          <div className="header-content header-content-minimal">
            <div className="header-left">
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
                <div className="header-range-pill">
                  <span className="header-range-label">Range</span>
                  <span className="header-range-dates">{selectedRange.startDate} ~ {selectedRange.endDate}</span>
                  <span className={`range-change ${(selectedRange.priceChange ?? 0) >= 0 ? 'up' : 'down'}`}>
                    {(selectedRange.priceChange ?? 0) >= 0 ? '+' : ''}
                    {(selectedRange.priceChange ?? 0).toFixed(2)}%
                  </span>
                </div>
              ) : null}
            </div>

            <div className="header-right" data-mode={predView}>
              <div className="header-mode-switch">
                <button className={`header-mode-btn ${predView === 'prediction' ? 'active' : ''}`} onClick={() => setPredView('prediction')}>
                  Prediction
                </button>
                <button className={`header-mode-btn ${predView === 'ask' ? 'active' : ''}`} onClick={() => selectedRange && setPredView('ask')} disabled={!selectedRange}>
                  AI Question
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="app-main">
          <div className="chart-area" ref={chartAreaRef}>
            {selectedSymbol ? (
              <CandlestickChart
                key={`chart-${selectedSymbol}`}
                symbol={selectedSymbol}
                lockedNewsId={lockedArticle?.newsId ?? null}
                highlightedArticleIds={activeCategoryIds.length > 0 ? activeCategoryIds : null}
                highlightColor={activeCategoryColor}
                selectedRange={selectedRange}
                onHover={handleHover}
                onRangeSelect={handleRangeSelect}
                onArticleSelect={handleArticleSelect}
                onDayClick={handleDayClick}
              />
            ) : (
              <div className="chart-placeholder">Select a ticker to view the chart</div>
            )}
          </div>

          {selectedSymbol && (
            <div className="prediction-area">
              {predView === 'ask' && selectedRange ? (
                rangeQuestion ? (
                  <RangeAnalysisPanel
                    key={`range-analysis-inline-${selectedSymbol}-${selectedRange.startDate}-${selectedRange.endDate}`}
                    symbol={selectedSymbol}
                    startDate={selectedRange.startDate}
                    endDate={selectedRange.endDate}
                    question={rangeQuestion}
                    onClear={() => {
                      setSelectedRange(null);
                      setRangeQuestion(null);
                      setPredView('prediction');
                    }}
                  />
                ) : (
                  <div className="pred-ask-panel">
                    <div className="pred-ask-header">
                      <div>
                        <div className="pred-ask-title">Ask AI about selected range</div>
                        <div className="pred-ask-meta">Use the selected window as context and ask a focused research question.</div>
                        <div className="pred-ask-meta pred-ask-meta-mono">{selectedRange.startDate} ~ {selectedRange.endDate}</div>
                      </div>
                      <span className={`range-change ${(selectedRange.priceChange ?? 0) >= 0 ? 'up' : 'down'}`}>
                        {(selectedRange.priceChange ?? 0) >= 0 ? '+' : ''}{(selectedRange.priceChange ?? 0).toFixed(2)}%
                      </span>
                    </div>
                    <div className="pred-ask-presets">
                      {RANGE_PRESETS.map((q) => (
                        <button key={q} className="pred-ask-preset" onClick={() => handleRangeAsk(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                    <form
                      className="pred-ask-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (customRangeQuestion.trim()) handleRangeAsk(customRangeQuestion.trim());
                      }}
                    >
                      <input
                        value={customRangeQuestion}
                        onChange={(e) => setCustomRangeQuestion(e.target.value)}
                        placeholder="Ask your own question about this range..."
                      />
                      <button type="submit">Ask</button>
                    </form>
                  </div>
                )
              ) : (
                <PredictionPanel symbol={selectedSymbol} />
              )}
            </div>
          )}

          <div className="news-area">
            {tickerLoading ? (
              <div className="news-empty">{tickerLoadingMessage || `Preparing news for ${selectedSymbol}...`}</div>
            ) : (
              <>
                {selectedSymbol && !selectedRange && (
                  <NewsCategoryPanel symbol={selectedSymbol} activeCategory={activeCategory} onCategoryChange={handleCategoryChange} />
                )}
                {renderRightPanel()}
              </>
            )}
          </div>
          {(tickerLoading || tickerSwitching) && selectedSymbol && (
            <div className="ticker-switch-overlay">
              <div className="ticker-switch-card">
                <div className="ticker-switch-spinner" />
                <div className="ticker-switch-text">{tickerLoadingMessage || `Switching to ${selectedSymbol}...`}</div>
              </div>
            </div>
          )}
        </main>
        <ToastContainer />
      </div>
    </div>
  );
}
