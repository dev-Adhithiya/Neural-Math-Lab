import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Chart, registerables } from 'chart.js';
import 'hammerjs';
import zoomPlugin from 'chartjs-plugin-zoom';
import { getChartConfig, plotMathFunction } from '../engine/DynamicGraphing.js';

Chart.register(...registerables, zoomPlugin);

/**
 * GraphPlotter — Renders a Chart.js math plot.
 *
 * @param {Object} props
 * @param {Object} props.chartData - From plotMathFunction()
 * @param {string} [props.equation] - Display equation
 * @param {Function} [props.onEquationChange] - Called with (equation, chartData)
 */
export default function GraphPlotter({ chartData, equation, onEquationChange }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [graphError, setGraphError] = useState('');
  const [equationInput, setEquationInput] = useState('');

  const handleResetZoom = useCallback(() => {
    if (chartRef.current && typeof chartRef.current.resetZoom === 'function') {
      chartRef.current.resetZoom();
    }
  }, []);

  useEffect(() => {
    setEquationInput(String(equation || chartData?.equation || '').trim());
  }, [equation, chartData]);

  const canRenderGraph = useCallback((data) => {
    const points = data?.datasets?.[0]?.data;
    if (!Array.isArray(points)) return false;
    return points.some((point) => point && typeof point.y === 'number' && Number.isFinite(point.y));
  }, []);

  const applyEquation = useCallback((rawEquation) => {
    const nextEquation = String(rawEquation || '').trim();
    if (!nextEquation) {
      setGraphError('Enter an equation like x, x^2, x^2 - 4*x + 3, or sin(x).');
      return;
    }

    const nextData = plotMathFunction(nextEquation);
    if (!nextData.parsed || !canRenderGraph(nextData)) {
      setGraphError('Could not parse that equation. Try x, x^2, x^2 - 4*x + 3, sin(x), or cos(x).');
      return;
    }

    setGraphError('');
    onEquationChange?.(nextEquation, nextData);
  }, [onEquationChange, canRenderGraph]);

  useEffect(() => {
    if (!chartData || !canvasRef.current) return;
    setGraphError('');

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    try {
      const config = getChartConfig(chartData);
      chartRef.current = new Chart(canvasRef.current, config);
    } catch (err) {
      console.error('[GraphPlotter] Failed to render chart:', err);
      setGraphError('Graph render failed for this expression. Try a simpler equation format like y = x^2 - 4x + 3.');
    }

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
        <button type="button" className="graph-action-btn" onClick={handleResetZoom}>
          Reset Zoom
        </button>
      </div>
      <div className="graph-controls">
        <label className="graph-input-label">Edit equation</label>
        <div className="graph-input-row">
          <input
            className="graph-input"
            value={equationInput}
            onChange={(e) => setEquationInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyEquation(equationInput);
              }
            }}
            placeholder="x, x^2, x^2 - 4*x + 3, sin(x)"
          />
          <button type="button" className="graph-action-btn graph-action-apply" onClick={() => applyEquation(equationInput)}>
            Apply
          </button>
        </div>
        <div className="graph-presets">
          {['x', 'x^2', 'x^3', 'sin(x)'].map((preset) => (
            <button
              key={preset}
              type="button"
              className="graph-preset-btn"
              onClick={() => {
                setEquationInput(preset);
                applyEquation(preset);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>
      <div className="graph-canvas-container">
        {graphError ? (
          <div className="graph-error">{graphError}</div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
      <div className="graph-help">Scroll to zoom. Hover points for precise coordinates.</div>
    </div>
  );
}
