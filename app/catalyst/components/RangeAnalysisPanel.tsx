"use client";
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { catalystApi } from '../api';
import { showToast } from './Toast';

interface RangeAnalysis {
  symbol: string;
  start_date: string;
  end_date: string;
  price_change_pct: number;
  open_price: number;
  close_price: number;
  high_price: number;
  low_price: number;
  news_count: number;
  trading_days: number;
  question?: string;
  analysis_mode?: 'ai' | 'local' | 'gemini' | string;
  analysis: {
    summary: string;
    key_events: string[];
    bullish_factors: string[];
    bearish_factors: string[];
    trend_analysis: string;
  };
  error?: string;
}

interface Props {
  symbol: string;
  startDate: string;
  endDate: string;
  question?: string;
  onClear: () => void;
}

export default function RangeAnalysisPanel({ symbol, startDate, endDate, question, onClear }: Props) {
  const [data, setData] = useState<RangeAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setData(null);

    showToast('Range analysis started...', 'info');

    // Try catalyst backend first (for price data context), then use Gemini for AI analysis
    fetchAnalysis(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.error) {
          setError(result.error);
          showToast('Analysis returned an error', 'error');
        } else {
          setData(result);
          showToast('Range analysis complete', 'success');
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError('Analysis failed');
          showToast('Analysis failed', 'error');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [symbol, startDate, endDate, question]);

  async function fetchAnalysis(signal: AbortSignal): Promise<RangeAnalysis> {
    // Step 1: Try catalyst backend for structured data
    let catalystData: RangeAnalysis | null = null;
    try {
      const res = await catalystApi.post<RangeAnalysis>(
        'analysis/range',
        { symbol, start_date: startDate, end_date: endDate, question },
        { signal }
      );
      catalystData = res.data;
      // If catalyst backend returned a good analysis, use it
      if (catalystData && catalystData.analysis?.summary && !catalystData.error) {
        return catalystData;
      }
    } catch (err) {
      if (axios.isCancel(err)) throw err;
      // Catalyst backend failed — fall through to Gemini
    }

    // Step 2: Use Gemini as AI fallback/primary
    const priceContext = catalystData
      ? `Price data for ${symbol} from ${startDate} to ${endDate}: Open $${catalystData.open_price?.toFixed(2)}, Close $${catalystData.close_price?.toFixed(2)}, High $${catalystData.high_price?.toFixed(2)}, Low $${catalystData.low_price?.toFixed(2)}, Change ${catalystData.price_change_pct?.toFixed(2)}%, Trading days: ${catalystData.trading_days}, News articles: ${catalystData.news_count}`
      : `Analyzing ${symbol} stock from ${startDate} to ${endDate}`;

    const geminiQuestion = question || "What's driving the price movement in this period?";

    const geminiPrompt = `${priceContext}\n\nQuestion: ${geminiQuestion}\n\nProvide your analysis in the following JSON format (respond ONLY with valid JSON, no markdown):\n{"summary":"2-3 sentence overview","key_events":["event1","event2"],"bullish_factors":["factor1","factor2"],"bearish_factors":["factor1","factor2"],"trend_analysis":"1-2 sentence trend summary"}`;

    try {
      const geminiRes = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: geminiPrompt,
          symbol,
          context: priceContext,
        }),
        signal,
      });

      const geminiData = await geminiRes.json();
      const answerText = geminiData.answer || '';

      // Try to parse structured JSON from Gemini response
      let analysis = { summary: '', key_events: [] as string[], bullish_factors: [] as string[], bearish_factors: [] as string[], trend_analysis: '' };
      try {
        // Extract JSON from response (might be wrapped in markdown code block)
        const jsonMatch = answerText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          analysis = {
            summary: parsed.summary || '',
            key_events: parsed.key_events || [],
            bullish_factors: parsed.bullish_factors || [],
            bearish_factors: parsed.bearish_factors || [],
            trend_analysis: parsed.trend_analysis || '',
          };
        }
      } catch {
        // If JSON parsing fails, use the raw text as summary
        analysis.summary = answerText;
      }

      return {
        symbol,
        start_date: startDate,
        end_date: endDate,
        price_change_pct: catalystData?.price_change_pct ?? 0,
        open_price: catalystData?.open_price ?? 0,
        close_price: catalystData?.close_price ?? 0,
        high_price: catalystData?.high_price ?? 0,
        low_price: catalystData?.low_price ?? 0,
        news_count: catalystData?.news_count ?? 0,
        trading_days: catalystData?.trading_days ?? 0,
        question,
        analysis_mode: 'gemini',
        analysis,
      };
    } catch (err) {
      if (signal.aborted) throw err;
      // If Gemini also fails, return catalyst data with error or a basic error
      if (catalystData) return { ...catalystData, error: catalystData.error || undefined } as RangeAnalysis;
      throw new Error('Both catalyst backend and Gemini AI failed');
    }
  }

  const changePct = data?.price_change_pct ?? 0;
  const isUp = changePct >= 0;

  return (
    <div className="news-panel range-panel">
      <div className="news-panel-header">
        <h2>Range Analysis</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {data?.analysis_mode === 'gemini' && (
            <span style={{ fontSize: 10, color: '#667eea', background: '#667eea18', padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>Gemini AI</span>
          )}
          <button className="range-clear-btn" onClick={onClear}>Clear</button>
        </div>
      </div>

      {loading ? (
        <div className="news-list" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
          <div className="range-spinner" />
          <span style={{ color: '#aab', fontSize: 15 }}>AI Analyzing {startDate} to {endDate}...</span>
          <div className="ai-loading-skeleton">
            <div className="skeleton-line" style={{ width: '90%' }} />
            <div className="skeleton-line" style={{ width: '75%' }} />
            <div className="skeleton-line" style={{ width: '60%' }} />
            <div className="skeleton-line" style={{ width: '80%' }} />
          </div>
        </div>
      ) : error ? (
        <div className="news-empty">{error}</div>
      ) : data ? (
        <div className="news-list range-analysis-vertical">
          {/* Question asked */}
          {question && (
            <div className="range-question-card">
              <span className="range-question-icon">?</span>
              <span className="range-question-text">{question}</span>
            </div>
          )}

          {/* Price summary card */}
          {(data.open_price > 0 || data.close_price > 0) && (
            <div className="range-price-card">
              <div className="range-dates">{data.start_date} to {data.end_date}</div>
              <div className="range-price-row">
                <span className="range-price">${data.open_price.toFixed(2)} → ${data.close_price.toFixed(2)}</span>
                <span className={`range-change ${isUp ? 'up' : 'down'}`}>
                  {isUp ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              </div>
              <div className="range-meta">
                {data.trading_days} trading days · {data.news_count} news articles
              </div>
            </div>
          )}

          {/* Summary */}
          {data.analysis.summary && (
            <div className="range-section">
              <p className="range-summary">{data.analysis.summary}</p>
            </div>
          )}

          {/* Key events */}
          {data.analysis.key_events?.length > 0 && (
            <div className="range-section">
              <h3 className="range-section-title">Key Events</h3>
              <ul className="range-events">
                {data.analysis.key_events.map((evt, i) => (
                  <li key={i}>{evt}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Bullish factors */}
          {data.analysis.bullish_factors?.length > 0 && (
            <div className="range-section">
              <h3 className="range-section-title">Bullish Factors</h3>
              {data.analysis.bullish_factors.map((f, i) => (
                <div key={i} className="reason up">
                  <span className="reason-icon">+</span> {f}
                </div>
              ))}
            </div>
          )}

          {/* Bearish factors */}
          {data.analysis.bearish_factors?.length > 0 && (
            <div className="range-section">
              <h3 className="range-section-title">Bearish Factors</h3>
              {data.analysis.bearish_factors.map((f, i) => (
                <div key={i} className="reason down">
                  <span className="reason-icon">-</span> {f}
                </div>
              ))}
            </div>
          )}

          {/* Trend analysis */}
          {data.analysis.trend_analysis && (
            <div className="range-section">
              <h3 className="range-section-title">Trend Analysis</h3>
              <p className="range-trend">{data.analysis.trend_analysis}</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
