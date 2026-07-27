import { useRef, useEffect } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart, PieChart, BarChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { Skeleton } from 'antd';

// Tree-shaken echarts build. Importing the full `echarts` / `echarts-for-react`
// pulled the entire library (~1 MB) into the BossDashboard chunk. Register only
// the modules our charts actually use — line/pie/bar series, axis grid, tooltip,
// legend, and both renderers. Canvas is the default; SVG is used for many-small-
// charts pages (e.g. the team KPI leaderboard's 60+ per-card sparklines) where a
// canvas context per instance is too heavy for low-end clients. If a chart starts
// rendering blank, a needed module is missing here (e.g. add a new series type).
// The `EChartsOption` type import is erased at build time and adds nothing.
echarts.use([LineChart, PieChart, BarChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer, SVGRenderer]);

interface IEChartProps {
  option: EChartsOption;
  height?: number;
  loading?: boolean;
  onEvents?: Record<string, (...args: unknown[]) => void>;
  /**
   * Accessible name for screen readers. Required for content charts;
   * pass `decorative` instead for sparklines / chrome.
   */
  ariaLabel?: string;
  /**
   * Mark the chart as decorative — the surrounding context already conveys
   * the data (e.g. a sparkline next to a numeric KPI). Adds aria-hidden.
   */
  decorative?: boolean;
  /**
   * Renderer to use. Defaults to 'canvas'. Use 'svg' on pages that mount many
   * small charts at once (e.g. per-row sparklines) to avoid one canvas context
   * per instance — lighter on low-end / public-network clients.
   */
  renderer?: 'canvas' | 'svg';
}

/**
 * Thin wrapper around echarts-for-react.
 * Adds: loading skeleton, auto-resize on sidebar collapse via ResizeObserver.
 */
export function EChart({ option, height = 320, loading = false, onEvents, ariaLabel, decorative, renderer = 'canvas' }: IEChartProps) {
  const chartRef = useRef<ReactEChartsCore>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver(() => {
      chartRef.current?.getEchartsInstance()?.resize();
    });
    observer.observe(wrapper);

    return () => observer.disconnect();
  }, []);

  if (loading) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Skeleton.Image style={{ width: '100%', height }} active />
      </div>
    );
  }

  const a11yProps = decorative
    ? { 'aria-hidden': true as const }
    : ariaLabel
      ? { role: 'img', 'aria-label': ariaLabel }
      : {};

  return (
    <div ref={wrapperRef} style={{ width: '100%' }} {...a11yProps}>
      <ReactEChartsCore
        echarts={echarts}
        ref={chartRef}
        option={option}
        style={{ height, width: '100%' }}
        opts={{ renderer }}
        notMerge
        lazyUpdate
        onEvents={onEvents}
      />
    </div>
  );
}
