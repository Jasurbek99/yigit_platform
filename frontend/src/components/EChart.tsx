import { useRef, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Skeleton } from 'antd';

interface IEChartProps {
  option: EChartsOption;
  height?: number;
  loading?: boolean;
  onEvents?: Record<string, (...args: unknown[]) => void>;
}

/**
 * Thin wrapper around echarts-for-react.
 * Adds: loading skeleton, auto-resize on sidebar collapse via ResizeObserver.
 */
export function EChart({ option, height = 320, loading = false, onEvents }: IEChartProps) {
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

  return (
    <div ref={wrapperRef} style={{ width: '100%' }}>
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
