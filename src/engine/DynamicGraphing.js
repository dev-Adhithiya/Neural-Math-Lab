/**
 * @module DynamicGraphing
 * @description Tool-calling function for math visualization.
 *
 * Auto-triggered when TutorAgent includes [GRAPH: f(x) = ...] in its response.
 */

import { parse } from 'mathjs';

const UNICODE_SUPERSCRIPTS = {
  '\u00b9': '1',
  '\u00b2': '2',
  '\u00b3': '3',
  '\u2070': '0',
  '\u2074': '4',
  '\u2075': '5',
  '\u2076': '6',
  '\u2077': '7',
  '\u2078': '8',
  '\u2079': '9',
};

function normalizeSuperscriptPowers(input = '') {
  let result = String(input || '');

  result = result.replace(/([\w)\]])([\u00b9\u00b2\u00b3])/g, (_, base, power) => {
    const mapped = UNICODE_SUPERSCRIPTS[power] || '';
    return mapped ? `${base}^${mapped}` : base;
  });

  result = result.replace(/([\w)\]])([\u2070\u2074-\u2079]+)/g, (_, base, powers) => {
    const mapped = powers
      .split('')
      .map((char) => UNICODE_SUPERSCRIPTS[char] || '')
      .join('');
    return mapped ? `${base}^${mapped}` : base;
  });

  return result;
}

function normalizeEquation(equation = '') {
  let cleanEq = String(equation || '')
    .replace(/`/g, '')
    .replace(/\$/g, '')
    .replace(/\\left|\\right/gi, '')
    .replace(/\\cdot|\\times/gi, '*')
    .replace(/\\div/gi, '/')
    .replace(/[\u00d7]/g, '*')
    .replace(/[\u00f7]/g, '/')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\\sin/gi, 'sin')
    .replace(/\\cos/gi, 'cos')
    .replace(/\\tan/gi, 'tan')
    .replace(/\\log/gi, 'log')
    .replace(/\\ln/gi, 'ln')
    .replace(/\\sqrt/gi, 'sqrt')
    .trim();

  // Convert common LaTeX fractions to explicit division.
  for (let i = 0; i < 4; i += 1) {
    const replaced = cleanEq.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)');
    if (replaced === cleanEq) break;
    cleanEq = replaced;
  }

  cleanEq = normalizeSuperscriptPowers(cleanEq)
    .replace(/[{}]/g, '')
    .replace(/f\s*\(\s*x\s*\)\s*=\s*/i, '')
    .replace(/y\s*=\s*/i, '')
    .trim();

  // If equation is in form expression = 0, graph only the left-hand side.
  if (cleanEq.includes('=')) {
    const parts = cleanEq.split('=');
    if (parts.length === 2) {
      const lhs = parts[0].trim();
      const rhs = parts[1].trim();
      if (lhs && rhs === '0') {
        cleanEq = lhs;
      }
    }
  }

  return cleanEq;
}

function trimGraphNarration(expr = '') {
  return String(expr || '')
    .replace(/^(?:graph|plot|draw|show)\s*:?\s*/i, '')
    .replace(/\s+(?:where|with|for|showing|including)\b[\s\S]*$/i, '')
    .replace(/,\s*(?:showing|with|where)\b[\s\S]*$/i, '')
    .replace(/[,:;]\s*$/g, '')
    .replace(/[.;]\s*$/g, '')
    .trim();
}

function canParseExpression(expr = '') {
  const candidate = normalizeEquation(trimGraphNarration(expr));
  if (!candidate) return false;
  try {
    parse(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Plot a mathematical function and return Chart.js-compatible data.
 *
 * @param {string} equation - e.g. "x^2 + 2*x - 3", "sin(x)", "2*x + 1"
 * @param {Object} [options]
 * @param {number} [options.xMin=-10]
 * @param {number} [options.xMax=10]
 * @param {number} [options.steps=160]
 * @param {string} [options.color]
 * @returns {{ labels: number[], datasets: Object[], equation: string, parsed: boolean }}
 */
export function plotMathFunction(equation, options = {}) {
  const { xMin = -10, xMax = 10, steps = 160, color } = options;

  const cleanEq = normalizeEquation(equation);
  const labels = [];
  const data = [];
  const pointCount = Math.max(40, Number(steps) || 160);
  const delta = (xMax - xMin) / pointCount;
  let parsed = true;

  try {
    if (!cleanEq) throw new Error('Empty equation');

    // Compile once to reduce per-point compute cost.
    const compiled = parse(cleanEq).compile();

    for (let i = 0; i <= pointCount; i += 1) {
      const x = xMin + delta * i;
      const roundedX = Math.round(x * 1000) / 1000;
      labels.push(Math.round(roundedX * 100) / 100);

      try {
        const y = compiled.evaluate({ x: roundedX });
        if (typeof y === 'number' && Number.isFinite(y) && Math.abs(y) < 1e6) {
          data.push({ x: roundedX, y: Math.round(y * 1000) / 1000 });
        } else {
          data.push({ x: roundedX, y: null });
        }
      } catch {
        data.push({ x: roundedX, y: null });
      }
    }
  } catch (err) {
    console.warn('[DynamicGraphing] Failed to parse equation:', cleanEq, err);
    parsed = false;

    for (let i = 0; i <= pointCount; i += 1) {
      const x = xMin + delta * i;
      const roundedX = Math.round(x * 1000) / 1000;
      labels.push(Math.round(roundedX * 100) / 100);
      data.push({ x: roundedX, y: null });
    }
  }

  return {
    labels,
    datasets: [
      {
        label: `f(x) = ${cleanEq || String(equation || '').trim()}`,
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
  const hasHammer = typeof window !== 'undefined' && typeof window.Hammer !== 'undefined';

  return {
    type: 'line',
    data: {
      datasets: chartData.datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      animation: { duration: 350, easing: 'easeOutQuart' },
      interaction: {
        mode: 'nearest',
        intersect: false,
      },
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
        zoom: {
          pan: {
            enabled: hasHammer,
            mode: 'xy',
            modifierKey: 'ctrl',
          },
          zoom: {
            wheel: {
              enabled: true,
              speed: 0.08,
            },
            pinch: {
              enabled: hasHammer,
            },
            mode: 'xy',
          },
        },
        decimation: {
          enabled: true,
          algorithm: 'min-max',
          samples: 120,
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
  const regex = /\[GRAPH:\s*([\s\S]*?)\]/gi;
  const equations = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    equations.push(match[1].trim());
  }

  return equations;
}

/**
 * Infer a graphable equation from model output when [GRAPH: ...] is missing.
 * @param {string} text
 * @returns {string|null}
 */
export function extractBestGraphEquation(text) {
  const tagged = extractGraphCommands(text);
  if (tagged.length > 0) {
    const cleanedTagged = normalizeEquation(trimGraphNarration(tagged[0]));
    if (canParseExpression(cleanedTagged)) {
      return cleanedTagged;
    }
  }

  const raw = String(text || '').replace(/\$/g, '');

  const explicit = raw.match(/(?:f\s*\(\s*x\s*\)|y)\s*=\s*([^\n.;]+)/i);
  if (explicit?.[1]) {
    const candidate = normalizeEquation(trimGraphNarration(explicit[1]));
    if (canParseExpression(candidate)) {
      return candidate;
    }
  }

  const quadratic = raw.match(/([+-]?(?:\d+(?:\.\d+)?)?\s*x\^2(?:\s*[+-]\s*(?:\d+(?:\.\d+)?)?\s*x)?(?:\s*[+-]\s*\d+(?:\.\d+)?)?)(?:\s*=\s*0)?/i);
  if (quadratic?.[1]) {
    const candidate = normalizeEquation(quadratic[1].replace(/\s+/g, ''));
    if (canParseExpression(candidate)) {
      return candidate;
    }
  }

  // Generic fallback: inspect line fragments and return first parsable x-expression.
  const fragments = raw
    .split(/\n|\r|;/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);

  for (const fragment of fragments) {
    if (!/[xX]/.test(fragment)) continue;
    const withoutPrefix = fragment.replace(/^.*?:\s*/, '').trim();
    const candidate = normalizeEquation(trimGraphNarration(withoutPrefix));
    if (canParseExpression(candidate)) {
      return candidate;
    }
  }

  return null;
}
