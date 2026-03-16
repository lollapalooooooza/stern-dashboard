"use client";
import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { catalystApi } from '../api';

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
  onHover: (date: string | null, ohlc?: HoverData) => void;
  onRangeSelect?: (range: RangeSelection | null) => void;
  onArticleSelect?: (article: ArticleSelection | null) => void;
  onDayClick?: (date: string) => void;
}

const SENTIMENT_COLOR: Record<string, string> = {
  positive: '#00e676',
  negative: '#ff5252',
  neutral: '#00e5ff',
};

export default function CandlestickChart({ symbol, lockedNewsId, highlightedArticleIds, highlightColor, onHover, onRangeSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [rawOhlc, setRawOhlc] = useState<OHLCRow[]>([]);
  const [rawParticles, setRawParticles] = useState<Particle[]>([]);
  const [viewSize, setViewSize] = useState(140);
  const [viewEnd, setViewEnd] = useState<number | null>(null);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setViewSize(140);
    setViewEnd(null);

    Promise.all([
      catalystApi.get<OHLCRow[]>(`stocks/${symbol}/ohlc`),
      catalystApi.get<Particle[]>(`news/${symbol}/particles`),
    ])
      .then(([ohlcRes, particlesRes]) => {
        setRawOhlc(ohlcRes.data || []);
        setRawParticles(particlesRes.data || []);
      })
      .catch((err) => console.error('Chart error:', err))
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    if (!rawOhlc.length) return;
    const total = rawOhlc.length;
    const safeView = Math.min(viewSize, total);
    const end = Math.max(safeView, Math.min(viewEnd ?? total, total));
    const start = Math.max(0, end - safeView);
    const sliced = rawOhlc.slice(start, end);
    const startDate = sliced[0]?.date;
    const endDate = sliced[sliced.length - 1]?.date;
    const filteredParticles = rawParticles.filter((p) => (!startDate || p.d >= startDate) && (!endDate || p.d <= endDate));
    drawChart(sliced, filteredParticles);
    if (viewEnd !== end) setViewEnd(end);
  }, [rawOhlc, rawParticles, viewSize, viewEnd, lockedNewsId, highlightedArticleIds, highlightColor]);

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

    g.append('g')
      .call(d3.axisLeft(y).ticks(6).tickFormat((d) => `$${Number(d).toFixed(0)}`))
      .selectAll('text')
      .style('fill', '#666')
      .style('font-size', '12px');

    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.timeFormat('%b %y') as any))
      .selectAll('text')
      .style('fill', '#666')
      .style('font-size', '12px');

    g.append('g')
      .call(d3.axisLeft(y).ticks(8).tickSize(-width).tickFormat(() => ''))
      .selectAll('line')
      .style('stroke', '#1a2030');

    const candleWidth = Math.max(1.5, (width / data.length) * 0.65);

    const candles = g.selectAll('.candle').data(data).enter().append('g').attr('class', 'candle');

    candles.append('line')
      .attr('x1', (d) => x(d.date))
      .attr('x2', (d) => x(d.date))
      .attr('y1', (d) => y(d.high))
      .attr('y2', (d) => y(d.low))
      .attr('stroke', (d) => (d.close >= d.open ? '#00e676' : '#ff5252'));

    candles.append('rect')
      .attr('x', (d) => x(d.date) - candleWidth / 2)
      .attr('y', (d) => y(Math.max(d.open, d.close)))
      .attr('width', candleWidth)
      .attr('height', (d) => Math.max(1, Math.abs(y(d.open) - y(d.close))))
      .attr('fill', (d) => (d.close >= d.open ? '#00e676' : '#ff5252'));

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
      for (const [dateStr, items] of byDate) {
        const day = data.find((d) => d.dateStr === dateStr);
        if (!day) continue;
        items.forEach((p, idx) => {
          const px = margin.left + x(day.date);
          const py = margin.top + y(day.low) + 8 + idx * 6;
          const radius = p.id === lockedNewsId ? 4.5 : highlighted?.has(p.id) ? 4 : 3;
          const color = highlighted?.has(p.id) && highlightColor ? highlightColor : SENTIMENT_COLOR[p.s || 'neutral'] || '#666';
          ctx.globalAlpha = p.id === lockedNewsId || highlighted?.has(p.id) ? 1 : 0.6;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(px * dpr, py * dpr, radius * dpr, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      ctx.globalAlpha = 1;
    }

    const bisect = d3.bisector<typeof data[0], Date>((d) => d.date).left;
    const crossV = g.append('line').style('stroke', '#333').style('stroke-width', 0.5).style('stroke-dasharray', '4,3').style('display', 'none');
    const crossH = g.append('line').style('stroke', '#333').style('stroke-width', 0.5).style('stroke-dasharray', '4,3').style('display', 'none');

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
        if (!event.selection) return;
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
        crossV.attr('x1', x(d.date)).attr('x2', x(d.date)).attr('y1', 0).attr('y2', height).style('display', null);
        crossH.attr('x1', 0).attr('x2', width).attr('y1', my).attr('y2', my).style('display', null);
        onHover(d.dateStr, {
          date: d.dateStr,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          change: d.change,
        });
      })
      .on('mouseleave.hover', function () {
        crossV.style('display', 'none');
        crossH.style('display', 'none');
        onHover(null);
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      });
  }

  const canPanLeft = viewEnd !== null && viewEnd - viewSize > 0;
  const canPanRight = viewEnd !== null && rawOhlc.length > 0 && viewEnd < rawOhlc.length;

  return (
    <div ref={containerRef} className="chart-container">
      <div className="chart-toolbar">
        <div className="chart-toolbar-group">
          <button className="chart-tool-btn" onClick={() => setViewSize((s) => Math.min(rawOhlc.length || s, s + 30))}>− Zoom Out</button>
          <button className="chart-tool-btn" onClick={() => setViewSize((s) => Math.max(40, s - 30))}>+ Zoom In</button>
        </div>
        <div className="chart-toolbar-group">
          <button className="chart-tool-btn" disabled={!canPanLeft} onClick={() => setViewEnd((v) => v === null ? v : Math.max(viewSize, v - 30))}>← Earlier</button>
          <button className="chart-tool-btn" disabled={!canPanRight} onClick={() => setViewEnd((v) => v === null ? v : Math.min(rawOhlc.length, v + 30))}>Later →</button>
        </div>
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
    </div>
  );
}
