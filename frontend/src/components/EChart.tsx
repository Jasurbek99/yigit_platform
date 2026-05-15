import { useRef, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Skeleton } from 'antd';

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
  const chartRef = useRef<ReactECharts>(null);
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
      <ReactECharts
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
