"use client";
import { useState, useEffect } from 'react';
import { catalystApi } from '../api';

interface NewsItem {
  news_id: string;
  trade_date: string;
  published_utc: string;
  title: string;
  description: string;
  publisher: string;
  article_url: string;
  image_url: string | null;
  relevance: string | null;
  key_discussion: string | null;
  chinese_summary: string | null;
  sentiment: string | null;
  reason_growth: string | null;
  reason_decrease: string | null;
  ret_t0: number | null;
  ret_t1: number | null;
  ret_t3: number | null;
  ret_t5: number | null;
  ret_t10: number | null;
}

interface RangeNewsResponse {
  total: number;
  date_range: [string, string];
  articles: NewsItem[];
  top_bullish: NewsItem[];
  top_bearish: NewsItem[];
}

interface Props {
  symbol: string;
  startDate: string;
  endDate: string;
  priceChange?: number;
  onClose: () => void;
  onAskAI: (question: string) => void;
}

const PRESET_QUESTIONS = [
  "What's driving the price movement?",
  'Summarize key news in this period',
  'What are the bull/bear factors?',
];

function pct(v: number | null) {
  if (v === null || v === undefined) return '-';
  const p = v * 100;
  const color = p > 0 ? '#26a69a' : p < 0 ? '#ef5350' : '#888';
  return <span style={{ color, fontWeight: 600 }}>{p > 0 ? '+' : ''}{p.toFixed(2)}%</span>;
}

export default function RangeNewsPanel({ symbol, startDate, endDate, priceChange, onClose, onAskAI }: Props) {
  const [data, setData] = useState<RangeNewsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [question, setQuestion] = useState('');

  useEffect(() => {
    setLoading(true);
    setData(null);
    setShowAll(false);
    catalystApi
      .get(`news/${symbol}/range?start=${startDate}&end=${endDate}`)
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [symbol, startDate, endDate]);

  const change = priceChange ?? 0;
  const isUp = change >= 0;

  return (
    <div className="news-panel">
      <div className="news-panel-header">
        <h2>Range News</h2>
        <span className={`range-news-change ${isUp ? 'up' : 'down'}`}>
          {isUp ? '+' : ''}{change.toFixed(2)}%
        </span>
        <button className="range-clear-btn" onClick={onClose}>Close</button>
      </div>

      <div className="range-news-dates">
        {startDate} ~ {endDate}
        {data && <span className="news-count" style={{ marginLeft: 8 }}>{data.total} articles</span>}
      </div>

      <div className="range-ask-box" style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 13, color: '#8ea0c7', marginBottom: 8 }}>Ask AI about this selected range</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {PRESET_QUESTIONS.map((q) => (
            <button
              key={q}
              className="range-news-all-btn"
              style={{ width: 'auto', padding: '6px 10px' }}
              onClick={() => onAskAI(q)}
            >
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) onAskAI(question.trim());
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask your own question..."
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#e6ecff',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button type="submit" className="range-news-ai-btn" style={{ marginTop: 0, width: 'auto', padding: '8px 12px' }}>
            Ask
          </button>
        </form>
      </div>

      {loading ? (
        <div className="news-empty">
          <div className="range-loading">
            <div className="range-spinner" />
            <span>Loading range news...</span>
          </div>
        </div>
      ) : !data || data.total === 0 ? (
        <div className="news-empty">No news in this range</div>
      ) : (
        <div className="news-list">
          {data.top_bullish.length > 0 && (
            <div className="range-news-section">
              <div className="range-news-section-title bullish">▲ Bullish News ({data.top_bullish.length})</div>
              {data.top_bullish.map((item) => (
                <RangeNewsCard key={item.news_id} item={item} />
              ))}
            </div>
          )}

          {data.top_bearish.length > 0 && (
            <div className="range-news-section">
              <div className="range-news-section-title bearish">▼ Bearish News ({data.top_bearish.length})</div>
              {data.top_bearish.map((item) => (
                <RangeNewsCard key={item.news_id} item={item} />
              ))}
            </div>
          )}

          {data.articles.length > 0 && (
            <div className="range-news-all">
              <button className="range-news-all-btn" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Hide' : 'Show'} all {data.total} articles
                <span className="range-news-all-arrow">{showAll ? '▲' : '▼'}</span>
              </button>
              {showAll && data.articles.map((item) => (
                <RangeNewsCard key={item.news_id} item={item} />
              ))}
            </div>
          )}

          <button className="range-news-ai-btn" onClick={() => onAskAI("What's driving the price movement?")}>
            Ask CatalystTracker
          </button>
        </div>
      )}
    </div>
  );
}

function RangeNewsCard({ item }: { item: NewsItem }) {
  const sentiment = item.sentiment || 'neutral';
  const borderClass = sentiment === 'positive' ? 'card-positive' : sentiment === 'negative' ? 'card-negative' : 'card-neutral';

  return (
    <div className={`news-card ${borderClass}`}>
      <div className="news-card-top">
        <span className={`sentiment-dot ${sentiment}`} />
        <a href={item.article_url} target="_blank" rel="noreferrer" className="news-title">
          {item.title}
        </a>
      </div>

      {item.key_discussion && <p className="news-summary">{item.key_discussion}</p>}

      {(item.reason_growth || item.reason_decrease) && (
        <div className="news-reasons">
          {item.reason_growth && (
            <div className="reason up">
              <span className="reason-icon">+</span> {item.reason_growth}
            </div>
          )}
          {item.reason_decrease && (
            <div className="reason down">
              <span className="reason-icon">-</span> {item.reason_decrease}
            </div>
          )}
        </div>
      )}

      <div className="news-card-footer">
        <span className="news-publisher">{item.trade_date} · {item.publisher}</span>
        <div className="returns-chips">
          <span className="ret-chip">T+0 {pct(item.ret_t0)}</span>
          <span className="ret-chip">T+1 {pct(item.ret_t1)}</span>
        </div>
      </div>
    </div>
  );
}
