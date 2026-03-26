"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { catalystApi } from '../api';

// Global cache so data persists when switching tabs
const chartCache = new Map<string, { ohlc: OHLCRow[]; particles: Particle[] }>();

interface OHLCRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Particle {
  id: string;
  d: string;
  s: string | null;
  r: string | null;
  t: string;
  rt1: number | null;
}

interface HoverData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
}

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

interface Props {
  symbol: string;
  lockedNewsId?: string | null;
  highlightedArticleIds?: string[] | null;
  highlightColor?: string | null;
  selectedRange?: { startDate: string; endDate: string } | null;
  onHover: (date: string | null, ohlc?: HoverData) => void;
  onRangeSelect?: (range: RangeSelection | null) => void;
  onArticleSelect?: (article: ArticleSelection | null) => void;
  onDayClick?: (date: string) => void;
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: '#16a34a',
  negative: '#dc2626',
  neutral: '#2563eb',
};

const MIN_VIEW_COUNT = 20;

export default function CandlestickChart({ symbol, lockedNewsId, highlightedArticleIds, highlightColor, selectedRange, onHover, onRangeSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [rawOhlc, setRawOhlc] = useState<OHLCRow[]>([]);
  const [rawParticles, setRawParticles] = useState<Particle[]>([]);
  const requestSeqRef = useRef(0);
  const summaryCacheRef = useRef<Map<string, string>>(new Map());
  const [viewStart, setViewStart] = useState(0);
  const [viewCount, setViewCount] = useState<number | null>(null);

  useEffect(() => {
    if (!symbol) return;
    const reqId = ++requestSeqRef.current;

    // Check cache first — instant render
    const cached = chartCache.get(symbol);
    if (cached) {
      setRawOhlc(cached.ohlc);
      setRawParticles(cached.particles);
      setViewCount(cached.ohlc.length || null);
      setViewStart(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setRawOhlc([]);
    setRawParticles([]);
    setViewCount(null);
    setViewStart(0);

    // Race: show OHLC as soon as it arrives, don't wait for particles
    const ohlcPromise = catalystApi.get<OHLCRow[]>(`stocks/${symbol}/ohlc`);
    const particlesPromise = catalystApi.get<Particle[]>(`news/${symbol}/particles`);

    // Show chart as soon as OHLC is ready (don't block on particles)
    ohlcPromise
      .then((ohlcRes) => {
        if (reqId !== requestSeqRef.current) return;
        const nextOhlc = ohlcRes.data || [];
        if (nextOhlc.length > 0) {
          setRawOhlc(nextOhlc);
          setViewCount(nextOhlc.length);
          setViewStart(0);
          setLoading(false);
        }
      })
      .catch(() => {});

    // Then load particles separately
    Promise.all([ohlcPromise, particlesPromise])
      .then(([ohlcRes, particlesRes]) => {
        if (reqId !== requestSeqRef.current) return;
        const nextOhlc = ohlcRes.data || [];
        const nextParticles = particlesRes.data || [];
        chartCache.set(symbol, { ohlc: nextOhlc, particles: nextParticles });
        setRawOhlc(nextOhlc);
        setRawParticles(nextParticles);
        setViewCount(nextOhlc.length || null);
        setViewStart(0);
      })
      .catch((err) => {
        if (reqId !== requestSeqRef.current) return;
        console.error('Chart error:', err);
        // Retry once after 1.5 seconds
        setTimeout(() => {
          if (reqId !== requestSeqRef.current) return;
          Promise.all([
            catalystApi.get<OHLCRow[]>(`stocks/${symbol}/ohlc`),
            catalystApi.get<Particle[]>(`news/${symbol}/particles`),
          ]).then(([ohlcRes, particlesRes]) => {
            if (reqId !== requestSeqRef.current) return;
            const nextOhlc = ohlcRes.data || [];
            const nextParticles = particlesRes.data || [];
            chartCache.set(symbol, { ohlc: nextOhlc, particles: nextParticles });
            setRawOhlc(nextOhlc);
            setRawParticles(nextParticles);
            setViewCount(nextOhlc.length || null);
            setViewStart(0);
          }).catch(() => {});
        }, 1500);
      })
      .finally(() => {
        if (reqId === requestSeqRef.current) setLoading(false);
      });
  }, [symbol]);

  const visibleOhlc = useMemo(() => {
    if (!rawOhlc.length) return [];
    const count = viewCount ?? rawOhlc.length;
    return rawOhlc.slice(viewStart, viewStart + count);
  }, [rawOhlc, viewStart, viewCount]);

  useEffect(() => {
    if (visibleOhlc.length) {
      const startDate = visibleOhlc[0]?.date;
      const endDate = visibleOhlc[visibleOhlc.length - 1]?.date;
      const filteredParticles = rawParticles.filter((p) => (!startDate || p.d >= startDate) && (!endDate || p.d <= endDate));
      drawChart(visibleOhlc, filteredParticles);
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [visibleOhlc, rawParticles, lockedNewsId, highlightedArticleIds, highlightColor]);

  function drawChart(rawData: OHLCRow[], particles: Particle[]) {
    const svgEl = svgRef.current;
    const canvasEl = canvasRef.current;
    const container = containerRef.current;
    if (!svgEl || !canvasEl || !container || rawData.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const fullWidth = container.clientWidth;
    const fullHeight = container.clientHeight || 560;
    const margin = { top: 16, right: 40, bottom: 26, left: 48 };
    const width = fullWidth - margin.left - margin.right;
    const height = fullHeight - margin.top - margin.bottom;

    svg.attr('width', fullWidth).attr('height', fullHeight);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const data = rawData.map((d, i) => ({
      date: new Date(d.date),
      dateStr: d.date,
      open: +d.open,
      high: +d.high,
      low: +d.low,
      close: +d.close,
      change: i > 0 ? ((+d.close - +rawData[i - 1].close) / +rawData[i - 1].close) * 100 : 0,
    }));

    const x = d3.scaleTime().domain(d3.extent(data, (d) => d.date) as [Date, Date]).range([0, width]);
    const y = d3.scaleLinear()
      .domain([d3.min(data, (d) => d.low)! * 0.92, d3.max(data, (d) => d.high)! * 1.03])
      .range([height, 0]);

    const yAxis = g.append('g')
      .call(d3.axisLeft(y).ticks(6).tickFormat((d) => `$${Number(d).toFixed(0)}`));

    yAxis.selectAll('text')
      .style('fill', 'rgba(154, 163, 178, 0.58)')
      .style('font-size', '11px');
    yAxis.selectAll('.domain, .tick line').remove();

    const xAxis = g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %y') as any));

    xAxis.selectAll('text')
      .style('fill', 'rgba(154, 163, 178, 0.42)')
      .style('font-size', '11px');
    xAxis.selectAll('.domain, .tick line').remove();

    const grid = g.append('g')
      .call(d3.axisLeft(y).ticks(8).tickSize(-width).tickFormat(() => ''));

    grid.selectAll('line')
      .style('stroke', 'rgba(255,255,255,0.045)')
      .style('stroke-width', 1);
    grid.selectAll('.domain').remove();

    const defs = svg.append('defs');
    const areaGradient = defs.append('linearGradient')
      .attr('id', 'sd-line-area-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    areaGradient.append('stop').attr('offset', '0%').attr('stop-color', '#00e676').attr('stop-opacity', 0.12);
    areaGradient.append('stop').attr('offset', '55%').attr('stop-color', '#00e676').attr('stop-opacity', 0.04);
    areaGradient.append('stop').attr('offset', '100%').attr('stop-color', '#00e676').attr('stop-opacity', 0);

    const line = d3.line<typeof data[number]>()
      .x((d) => x(d.date))
      .y((d) => y(d.close))
      .curve(d3.curveMonotoneX);

    const area = d3.area<typeof data[number]>()
      .x((d) => x(d.date))
      .y0(height)
      .y1((d) => y(d.close))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'url(#sd-line-area-gradient)')
      .attr('d', area);

    if (selectedRange) {
      const selectedData = data.filter((d) => d.dateStr >= selectedRange.startDate && d.dateStr <= selectedRange.endDate);
      if (selectedData.length >= 2) {
        const rangeAreaGradient = defs.append('linearGradient')
          .attr('id', 'sd-selected-range-gradient')
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '0%')
          .attr('y2', '100%');
        rangeAreaGradient.append('stop').attr('offset', '0%').attr('stop-color', '#24e07a').attr('stop-opacity', 0.22);
        rangeAreaGradient.append('stop').attr('offset', '100%').attr('stop-color', '#24e07a').attr('stop-opacity', 0.03);
        g.append('path')
          .datum(selectedData)
          .attr('fill', 'url(#sd-selected-range-gradient)')
          .attr('d', area);
      }
    }

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(0, 230, 118, 0.15)')
      .attr('stroke-width', 6)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', line);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#17d96c')
      .attr('stroke-width', 2.25)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', line);

    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = fullWidth * dpr;
    canvasEl.height = fullHeight * dpr;
    canvasEl.style.width = `${fullWidth}px`;
    canvasEl.style.height = `${fullHeight}px`;
    const ctx = canvasEl.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      const byDate = new Map<string, Particle[]>();
      particles.forEach((p) => {
        const arr = byDate.get(p.d) || [];
        arr.push(p);
        byDate.set(p.d, arr);
      });
      const highlighted = highlightedArticleIds ? new Set(highlightedArticleIds) : null;
      const particleBottomLimit = margin.top + height - 34;
      for (const [dateStr, items] of byDate) {
        const day = data.find((d) => d.dateStr === dateStr);
        if (!day) continue;
        items.forEach((p, idx) => {
          const px = margin.left + x(day.date);
          const desiredPy = margin.top + y(day.close) + 10 + idx * 6;
          const py = Math.min(desiredPy, particleBottomLimit);
          const overflow = Math.max(0, desiredPy - particleBottomLimit);
          const densityAlpha = overflow > 0 ? Math.max(0.1, 0.34 - overflow / 42) : 0.34;
          const isHighlighted = !!highlighted?.has(p.id);
          const radius = p.id === lockedNewsId ? 4.5 : isHighlighted ? 4 : 3;
          const color = isHighlighted && highlightColor ? highlightColor : SENTIMENT_COLOR[p.s || 'neutral'] || '#666';
          ctx.globalAlpha = highlighted ? (p.id === lockedNewsId || isHighlighted ? 0.98 : 0.14) : (p.id === lockedNewsId ? 0.98 : densityAlpha);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px * dpr, py * dpr, radius * dpr, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      ctx.globalAlpha = 1;
    }

    const bisect = d3.bisector<typeof data[0], Date>((d) => d.date).left;
    const hoverBand = g.append('rect').attr('y', 0).attr('height', height).attr('rx', 10).attr('fill', 'rgba(255,255,255,0.04)').attr('stroke', 'rgba(255,255,255,0.04)').style('display', 'none').style('pointer-events', 'none');
    const crossV = g.append('line').style('stroke', 'rgba(255,255,255,0.18)').style('stroke-width', 0.5).style('stroke-dasharray', '4,3').style('display', 'none');
    const crossH = g.append('line').style('stroke', 'rgba(255,255,255,0.12)').style('stroke-width', 0.5).style('stroke-dasharray', '4,3').style('display', 'none');
    const hoverGlow = g.append('circle').attr('r', 10).attr('fill', 'rgba(23, 217, 108, 0.18)').style('display', 'none');
    const hoverDot = g.append('circle').attr('r', 3.5).attr('fill', '#17d96c').attr('stroke', 'rgba(6, 12, 18, 0.95)').attr('stroke-width', 1.2).style('display', 'none');

    function snapToData(px: number) {
      const xDate = x.invert(px);
      const idx = bisect(data, xDate, 1);
      const d0 = data[idx - 1];
      const d1 = data[idx];
      if (!d0) return data[0];
      return d1 && xDate.getTime() - d0.date.getTime() > d1.date.getTime() - xDate.getTime() ? d1 : d0;
    }

    const brush = d3.brushX<unknown>()
      .extent([[0, 0], [width, height]])
      .on('end', function (event) {
        if (!event.selection) {
          if (event.sourceEvent && selectedRange) {
            onRangeSelect?.(null);
          }
          return;
        }
        const [x0, x1] = event.selection as [number, number];
        const d0 = snapToData(x0);
        const d1 = snapToData(x1);
        if (d0.dateStr === d1.dateStr) {
          d3.select(this).call(brush.move as any, null);
          return;
        }
        const priceChange = ((d1.close - d0.open) / d0.open) * 100;
        onRangeSelect?.({ startDate: d0.dateStr, endDate: d1.dateStr, priceChange });
      });

    const brushG = g.append('g').attr('class', 'brush').call(brush);
    brushG.selectAll('.selection').attr('fill', '#667eea').attr('fill-opacity', 0.14).attr('stroke', '#667eea');

    brushG.select('.overlay')
      .style('cursor', 'crosshair')
      .on('mousemove.hover', function (event) {
        const [mx, my] = d3.pointer(event);
        const d = snapToData(mx);
        const cx = x(d.date);
        hoverBand.attr('x', Math.max(0, cx - 26)).attr('width', 52).style('display', null);
        crossV.attr('x1', cx).attr('x2', cx).attr('y1', 0).attr('y2', height).style('display', null);
        crossH.attr('x1', 0).attr('x2', width).attr('y1', my).attr('y2', my).style('display', null);
        hoverGlow.attr('cx', cx).attr('cy', y(d.close)).style('display', null);
        hoverDot.attr('cx', cx).attr('cy', y(d.close)).style('display', null);
        onHover(d.dateStr, {
          date: d.dateStr,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          change: d.change,
        });
        const tooltip = tooltipRef.current;
        if (tooltip) {
          const cached = summaryCacheRef.current.get(d.dateStr);
          const renderTip = (summary?: string) => {
            tooltip.innerHTML = `<div class="chart-hover-tip-date">${d.dateStr}</div><div class="chart-hover-tip-summary">${summary || 'Price moved on mixed market/news factors.'}</div><div class="chart-hover-tip-change ${d.change >= 0 ? 'up' : 'down'}">${d.change >= 0 ? '+' : ''}${d.change.toFixed(2)}%</div>`;
            tooltip.style.display = 'block';
            tooltip.style.left = `${Math.min(fullWidth - 240, Math.max(16, margin.left + cx + 14))}px`;
            tooltip.style.top = `${Math.max(18, margin.top + y(d.close) - 18)}px`;
          };
          if (cached) renderTip(cached);
          else {
            renderTip();
            catalystApi.get(`news/${symbol}?date=${d.dateStr}`).then((res) => {
              const top = res.data?.[0];
              const summary = top?.key_discussion || top?.title || 'Price moved on mixed market/news factors.';
              summaryCacheRef.current.set(d.dateStr, summary);
              if (tooltip.style.display !== 'none') renderTip(summary);
            }).catch(() => {});
          }
        }
      })
      .on('mouseleave.hover', function () {
        hoverBand.style('display', 'none');
        crossV.style('display', 'none');
        crossH.style('display', 'none');
        hoverGlow.style('display', 'none');
        hoverDot.style('display', 'none');
        onHover(null);
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      });
  }

  const total = rawOhlc.length;
  const currentCount = viewCount ?? total;
  const canPanLeft = viewStart > 0;
  const canPanRight = total > 0 && viewStart + currentCount < total;

  function handleZoomIn() {
    if (total <= 1) return;
    const minCount = Math.min(20, total);
    const nextCount = Math.max(minCount, Math.floor(currentCount * 0.7));
    const center = viewStart + currentCount / 2;
    const maxStart = Math.max(0, total - nextCount);
    setViewCount(nextCount);
    setViewStart(Math.max(0, Math.min(maxStart, Math.round(center - nextCount / 2))));
  }

  function handleZoomOut() {
    if (total <= 1) return;
    const nextCount = Math.min(total, Math.ceil(currentCount / 0.72));
    const center = viewStart + currentCount / 2;
    const maxStart = Math.max(0, total - nextCount);
    setViewCount(nextCount);
    setViewStart(Math.max(0, Math.min(maxStart, Math.round(center - nextCount / 2))));
  }

  return (
    <div ref={containerRef} className="chart-container">
      <div className="chart-toolbar chart-toolbar-minimal">
        <button className="chart-toolbar-btn" onClick={handleZoomIn} title="Zoom in" aria-label="Zoom in">＋</button>
        <button className="chart-toolbar-btn" onClick={handleZoomOut} title="Zoom out" aria-label="Zoom out">－</button>
      </div>
      {loading && (
        <div className="chart-loading-skeleton">
          <div className="chart-skeleton-bars">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="chart-skeleton-bar" style={{ height: `${30 + Math.random() * 50}%`, animationDelay: `${i * 0.05}s` }} />
            ))}
          </div>
          <span className="chart-skeleton-text">Loading chart data...</span>
        </div>
      )}
      <svg ref={svgRef}></svg>
      <canvas ref={canvasRef} className="particle-layer" />
      <div ref={tooltipRef} className="particle-tooltip" style={{ display: 'none' }} />
      {total > MIN_VIEW_COUNT && (
        <div className="chart-timeline-overlay" aria-hidden="true">
          <input
            className="chart-timeline-slider chart-timeline-slider-minimal"
            type="range"
            min={0}
            max={Math.max(0, total - Math.min(currentCount, total))}
            step={1}
            value={Math.min(viewStart, Math.max(0, total - currentCount))}
            onChange={(e) => {
              const newStart = Number(e.target.value);
              // If at full zoom, zoom to ~60% first so slider is useful
              if (currentCount >= total) {
                const newCount = Math.max(MIN_VIEW_COUNT, Math.floor(total * 0.6));
                setViewCount(newCount);
                setViewStart(Math.min(newStart, Math.max(0, total - newCount)));
              } else {
                setViewStart(newStart);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
