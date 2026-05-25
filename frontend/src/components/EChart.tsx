import { useRef, useEffect } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { Skeleton } from 'antd';

// Tree-shaken echarts build. Importing the full `echarts` / `echarts-for-react`
// pulled the entire library (~1 MB) into the BossDashboard chunk. Register only
// the modules our charts actually use — line series, axis grid, tooltip, legend,
// canvas renderer. If a chart starts rendering blank, a needed module is missing
// here (e.g. add BarChart for bar series, or add a component). The `EChartsOption`
// type import is erased at build time and adds nothing to the bundle.
echarts.use([LineChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

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
}

/**
 * Thin wrapper around echarts-for-react.
 * Adds: loading skeleton, auto-resize on sidebar collapse via ResizeObserver.
 */
export function EChart({ option, height = 320, loading = false, onEvents, ariaLabel, decorative }: IEChartProps) {
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
        notMerge
        lazyUpdate
        onEvents={onEvents}
      />
    </div>
  );
}
