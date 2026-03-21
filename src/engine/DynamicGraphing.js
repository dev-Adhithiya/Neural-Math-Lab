/**
 * @module DynamicGraphing
 * @description Tool-calling function for math visualization.
 *
 * Reason-Act-Observe:
 *   REASON  → Parse equation string from AI response
 *   ACT     → Evaluate the function across a range using mathjs
 *   OBSERVE → Return {labels, datasets} ready for Chart.js
 *
 * Auto-triggered when TutorAgent includes [GRAPH: f(x) = ...] in its response.
 */

import { evaluate, parse } from 'mathjs';

/**
 * Plot a mathematical function and return Chart.js-compatible data.
 *
 * @param {string} equation - e.g. "x^2 + 2*x - 3", "sin(x)", "2*x + 1"
 * @param {Object} [options]
 * @param {number} [options.xMin=-10]
 * @param {number} [options.xMax=10]
 * @param {number} [options.steps=200]
 * @param {string} [options.color]
 * @returns {{ labels: number[], datasets: Object[], equation: string, parsed: boolean }}
 */
export function plotMathFunction(equation, options = {}) {
  const { xMin = -10, xMax = 10, steps = 200, color } = options;

  // Clean up the equation
  let cleanEq = equation
    .replace(/f\s*\(\s*x\s*\)\s*=\s*/i, '')
    .replace(/y\s*=\s*/i, '')
    .trim();

  const labels = [];
  const data = [];
  const step = (xMax - xMin) / steps;
  let parsed = true;

  try {
    // Validate the expression parses correctly
    parse(cleanEq);

    for (let x = xMin; x <= xMax; x += step) {
      labels.push(Math.round(x * 100) / 100);
      try {
        const y = evaluate(cleanEq, { x });
        // Clamp extreme values for display
        if (typeof y === 'number' && isFinite(y) && Math.abs(y) < 1e6) {
          data.push(Math.round(y * 1000) / 1000);
        } else {
          data.push(null);
        }
      } catch {
        data.push(null);
      }
    }
  } catch (err) {
    console.warn('[DynamicGraphing] Failed to parse equation:', cleanEq, err);
    parsed = false;
    // Return empty data
    for (let x = xMin; x <= xMax; x += step) {
      labels.push(Math.round(x * 100) / 100);
      data.push(null);
    }
  }

  return {
    labels,
    datasets: [
      {
        label: `f(x) = ${cleanEq}`,
        data,
        borderColor: color || '#00d4ff',
        backgroundColor: (color || '#00d4ff') + '20',
        borderWidth: 2.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
        spanGaps: false,
      },
    ],
    equation: cleanEq,
    parsed,
  };
}

/**
 * Plot multiple functions on the same chart.
 * @param {string[]} equations
 * @param {Object} [options]
 * @returns {{ labels: number[], datasets: Object[], equations: string[] }}
 */
export function plotMultipleFunctions(equations, options = {}) {
  const colors = ['#00d4ff', '#a855f7', '#f59e0b', '#10b981', '#ef4444', '#3b82f6'];
  const results = equations.map((eq, i) =>
    plotMathFunction(eq, { ...options, color: colors[i % colors.length] })
  );

  return {
    labels: results[0]?.labels || [],
    datasets: results.flatMap((r) => r.datasets),
    equations: results.map((r) => r.equation),
  };
}

/**
 * Chart.js configuration object for math plots.
 * @param {Object} chartData - From plotMathFunction
 * @returns {Object} Chart.js config
 */
export function getChartConfig(chartData) {
  return {
    type: 'line',
    data: {
      labels: chartData.labels,
      datasets: chartData.datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeInOutQuart' },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'x', color: '#94a3b8', font: { family: 'Inter' } },
          grid: { color: '#1e293b' },
          ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 11 } },
        },
        y: {
          title: { display: true, text: 'f(x)', color: '#94a3b8', font: { family: 'Inter' } },
          grid: { color: '#1e293b' },
          ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 11 } },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#e2e8f0', font: { family: 'Inter' } },
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          borderColor: '#334155',
          borderWidth: 1,
        },
      },
    },
  };
}

/**
 * Detect [GRAPH: ...] patterns from AI text and extract equations.
 * @param {string} text
 * @returns {string[]} Array of equations found
 */
export function extractGraphCommands(text) {
  const regex = /\[GRAPH:\s*([^\]]+)\]/gi;
  const equations = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    equations.push(match[1].trim());
  }
  return equations;
}
