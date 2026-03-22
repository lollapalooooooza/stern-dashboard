"use client";
import { useState, useEffect, useRef } from 'react';
import { catalystApi } from '../api';

interface CategoryInfo {
  label: string;
  count: number;
  article_ids: string[];
  positive_ids: string[];
  negative_ids: string[];
  neutral_ids: string[];
}

interface CategoriesResponse {
  categories: Record<string, CategoryInfo>;
  total: number;
}

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
  sentiment: string | null;
  reason_growth: string | null;
  reason_decrease: string | null;
  ret_t0: number | null;
  ret_t1: number | null;
}

interface Props {
  symbol: string;
  activeCategory: string | null;
  onCategoryChange: (category: string | null, articleIds: string[], color?: string) => void;
}

const CATEGORY_META: Record<string, { icon: string; zh: string; color: string }> = {
  market:       { icon: '📈', zh: 'Market Impact',       color: '#667eea' },
  policy:       { icon: '🏛️', zh: 'Policy Impact',       color: '#f59e0b' },
  earnings:     { icon: '💰', zh: 'Earnings',            color: '#10b981' },
  product_tech: { icon: '🚀', zh: 'Product & Tech',      color: '#8b5cf6' },
  competition:  { icon: '⚔️',  zh: 'Competition',         color: '#ef4444' },
  management:   { icon: '👤', zh: 'Management',          color: '#06b6d4' },
};

type SentimentFilter = 'all' | 'positive' | 'negative';

function pct(v: number | null) {
  if (v === null || v === undefined) return '-';
  const pctVal = v * 100;
  const color = pctVal > 0 ? '#26a69a' : pctVal < 0 ? '#ef5350' : '#888';
  return <span style={{ color, fontWeight: 600 }}>{pctVal > 0 ? '+' : ''}{pctVal.toFixed(2)}%</span>;
}

export default function NewsCategoryPanel({ symbol, activeCategory, onCategoryChange }: Props) {
  const [categories, setCategories] = useState<Record<string, CategoryInfo>>({});
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all');
  const [categoryNews, setCategoryNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const newsCacheRef = useRef<Map<string, NewsItem[]>>(new Map());

  useEffect(() => {
    if (!symbol) return;
    newsCacheRef.current.clear();
    setCategoryNews([]);
    catalystApi
      .get<CategoriesResponse>(`news/${symbol}/categories`)
      .then((res) => setCategories(res.data.categories))
      .catch(() => setCategories({}));
  }, [symbol]);

  // Reset sentiment sub-filter when category changes
  useEffect(() => {
    setSentimentFilter('all');
  }, [activeCategory]);

  // Fetch news for the active category
  useEffect(() => {
    if (!activeCategory || !symbol) {
      setCategoryNews([]);
      return;
    }
    const cat = categories[activeCategory];
    if (!cat || cat.article_ids.length === 0) {
      setCategoryNews([]);
      return;
    }

    const cacheKey = `${symbol}_${activeCategory}`;
    const cached = newsCacheRef.current.get(cacheKey);
    if (cached) {
      setCategoryNews(cached);
      return;
    }

    setNewsLoading(true);
    // Fetch all articles for this category by IDs
    catalystApi
      .post<NewsItem[]>(`news/${symbol}/by-ids`, { ids: cat.article_ids })
      .then((res) => {
        const sorted = [...(res.data || [])].sort((a, b) => b.trade_date.localeCompare(a.trade_date));
        newsCacheRef.current.set(cacheKey, sorted);
        setCategoryNews(sorted);
      })
      .catch(() => {
        // Fallback: fetch all news and filter client-side
        const idSet = new Set(cat.article_ids);
        catalystApi
          .get<NewsItem[]>(`news/${symbol}/all`)
          .then((res) => {
            const filtered = (res.data || []).filter((n) => idSet.has(n.news_id));
            const sorted = filtered.sort((a, b) => b.trade_date.localeCompare(a.trade_date));
            newsCacheRef.current.set(cacheKey, sorted);
            setCategoryNews(sorted);
          })
          .catch(() => setCategoryNews([]));
      })
      .finally(() => setNewsLoading(false));
  }, [activeCategory, symbol, categories]);

  const keys = Object.keys(categories).filter((k) => categories[k].count > 0);
  if (keys.length === 0) return null;

  function handleSentimentClick(filter: SentimentFilter) {
    if (!activeCategory) return;
    const cat = categories[activeCategory];
    const meta = CATEGORY_META[activeCategory] || { color: '#667eea' };
    setSentimentFilter(filter);
    let ids: string[];
    let color: string;
    if (filter === 'positive') {
      ids = cat.positive_ids;
      color = '#00e676';
    } else if (filter === 'negative') {
      ids = cat.negative_ids;
      color = '#ff5252';
    } else {
      ids = cat.article_ids;
      color = meta.color;
    }
    onCategoryChange(activeCategory, ids, color);
  }

  const activeCat = activeCategory ? categories[activeCategory] : null;

  // Filter displayed news by sentiment
  const displayedNews = sentimentFilter === 'all'
    ? categoryNews
    : categoryNews.filter((n) => n.sentiment === sentimentFilter);

  return (
    <div className="news-category-wrap">
      <div className="news-category-bar">
        {keys.map((key) => {
          const cat = categories[key];
          const meta = CATEGORY_META[key] || { icon: '📌', zh: key, color: '#667eea' };
          const isActive = activeCategory === key;
          return (
            <button
              key={key}
              className={`category-tag ${isActive ? 'category-tag-active' : ''}`}
              style={{
                '--tag-color': meta.color,
                '--tag-color-bg': `${meta.color}18`,
                '--tag-color-bg-active': `${meta.color}30`,
              } as React.CSSProperties}
              onClick={() => {
                if (isActive) {
                  onCategoryChange(null, []);
                } else {
                  setSentimentFilter('all');
                  onCategoryChange(key, cat.article_ids, meta.color);
                }
              }}
            >
              <span className="category-tag-icon">{meta.icon}</span>
              <div className="category-tag-body">
                <span className="category-tag-label">{meta.zh}</span>
                <span className="category-tag-count">{cat.count} {'articles'}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Sentiment sub-filter row — only shown when a category is active */}
      {activeCat && (
        <div className="sentiment-sub-bar">
          <button
            className={`sentiment-sub-btn ${sentimentFilter === 'all' ? 'sentiment-sub-active' : ''}`}
            onClick={() => handleSentimentClick('all')}
          >
            {'All'} <span className="sentiment-sub-count">{activeCat.count}</span>
          </button>
          <button
            className={`sentiment-sub-btn sentiment-sub-up ${sentimentFilter === 'positive' ? 'sentiment-sub-active' : ''}`}
            onClick={() => handleSentimentClick('positive')}
          >
            {'▲ Bullish'} <span className="sentiment-sub-count">{activeCat.positive_ids.length}</span>
          </button>
          <button
            className={`sentiment-sub-btn sentiment-sub-down ${sentimentFilter === 'negative' ? 'sentiment-sub-active' : ''}`}
            onClick={() => handleSentimentClick('negative')}
          >
            {'▼ Bearish'} <span className="sentiment-sub-count">{activeCat.negative_ids.length}</span>
          </button>
        </div>
      )}

      {/* Category news articles shown below */}
      {activeCategory && (
        <div className="category-news-list">
          {newsLoading ? (
            <div className="category-news-loading">
              <div className="range-spinner" />
              <span>Loading articles...</span>
            </div>
          ) : displayedNews.length === 0 ? (
            <div className="category-news-empty">No articles found</div>
          ) : (
            displayedNews.map((item) => (
              <div
                key={item.news_id}
                className={`news-card ${item.sentiment === 'positive' ? 'card-positive' : item.sentiment === 'negative' ? 'card-negative' : 'card-neutral'}`}
              >
                <div className="news-card-top">
                  <span className={`sentiment-pill ${item.sentiment || 'neutral'}`}>
                    {item.sentiment === 'positive' ? 'Bullish' : item.sentiment === 'negative' ? 'Bearish' : 'Neutral'}
                  </span>
                  <a href={item.article_url} target="_blank" rel="noreferrer" className="news-title">
                    {item.title}
                  </a>
                </div>
                {item.key_discussion && (
                  <p className="news-summary">{item.key_discussion}</p>
                )}
                <div className="news-card-footer">
                  <span className="news-publisher">{item.publisher}</span>
                  <span className="news-date-badge">{item.trade_date}</span>
                  <div className="returns-chips">
                    <span className="ret-chip">T+1 {pct(item.ret_t1)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
