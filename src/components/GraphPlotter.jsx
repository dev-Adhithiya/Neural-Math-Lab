import React, { useRef, useEffect } from 'react';
import { Chart, registerables } from 'chart.js';
import { getChartConfig } from '../engine/DynamicGraphing.js';

Chart.register(...registerables);

/**
 * GraphPlotter — Renders a Chart.js math plot.
 *
 * @param {Object} props
 * @param {Object} props.chartData - From plotMathFunction()
 * @param {string} [props.equation] - Display equation
 */
export default function GraphPlotter({ chartData, equation }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartData || !canvasRef.current) return;

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const config = getChartConfig(chartData);
    chartRef.current = new Chart(canvasRef.current, config);

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [chartData]);

  if (!chartData) return null;

  return (
    <div className="graph-plotter">
      <div className="graph-header">
        <span className="graph-icon">📈</span>
        <span className="graph-equation">
          {equation || chartData.datasets?.[0]?.label || 'Graph'}
        </span>
      </div>
      <div className="graph-canvas-container">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
