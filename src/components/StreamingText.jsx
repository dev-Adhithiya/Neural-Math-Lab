import React, { useMemo } from 'react';
import katex from 'katex';

/**
 * Render a text string with LaTeX math notation.
 * Inline math: $...$ → rendered inline
 * Display math: $$...$$ → rendered as block
 * Also handles markdown bold (**text**) and code (`code`).
 *
 * @param {string} text
 * @returns {string} HTML string
 */
export function renderMathInText(text) {
  if (!text) return '';

  let html = String(text);
  const mathPlaceholders = [];
  const stashMath = (rendered) => {
    const token = `__MATH_${mathPlaceholders.length}__`;
    mathPlaceholders.push(rendered);
    return token;
  };

  // Normalize ChatGPT-style delimiters to $ and $$ for one rendering path.
  html = html
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => `$$${latex}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => `$${latex}$`);

  // Process math before escaping plain text.
  // Display math: $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
    try {
      return stashMath(`<div class="math-display">${katex.renderToString(latex.trim(), {
        displayMode: true,
        throwOnError: false,
      })}</div>`);
    } catch {
      const escaped = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return stashMath(`<div class="math-display math-error">${escaped}</div>`);
    }
  });

  // Inline math: $...$
  html = html.replace(/\$([^\$\n]+?)\$/g, (_, latex) => {
    try {
      return stashMath(katex.renderToString(latex.trim(), {
        displayMode: false,
        throwOnError: false,
      }));
    } catch {
      const escaped = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return stashMath(`<code class="math-error">${escaped}</code>`);
    }
  });

  // Escape only non-math text.
  html = html
    .replace(/&(?!amp;|lt;|gt;|#)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Markdown: **bold**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Markdown: *italic*
  html = html.replace(/(?<!\*)\*([^\*\n]+?)\*(?!\*)/g, '<em>$1</em>');

  // Markdown: _italic_ (avoid matching inside words; keep LaTeX safe because math is rendered earlier)
  html = html.replace(/(^|[\s>])_([^_\n]+?)_([\s<]|$)/g, '$1<em>$2</em>$3');

  // Markdown: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Markdown: ### headers
  html = html.replace(/^### (.+)$/gm, '<h4 class="chat-heading">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="chat-heading">$1</h3>');

  // Markdown: - list items
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Markdown: numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Newlines → <br>
  html = html.replace(/\n/g, '<br />');

  // [GRAPH: ...] tag styling
  html = html.replace(
    /\[GRAPH:\s*([^\]]+)\]/g,
    '<div class="graph-tag">📈 Graphing: <code>$1</code></div>'
  );

  // Restore rendered math after markdown/escaping transforms.
  html = html.replace(/__MATH_(\d+)__/g, (_, idx) => mathPlaceholders[Number(idx)] || '');

  return html;
}

/**
 * StreamingText component — renders AI output with math notation.
 * @param {Object} props
 * @param {string} props.text
 * @param {boolean} [props.isStreaming]
 * @param {string} [props.className]
 */
export default function StreamingText({ text, isStreaming = false, className = '' }) {
  const rendered = useMemo(() => renderMathInText(text), [text]);

  return (
    <div className={`streaming-text ${className} ${isStreaming ? 'is-streaming' : ''}`}>
      <div dangerouslySetInnerHTML={{ __html: rendered }} />
      {isStreaming && <span className="typing-cursor">▊</span>}
    </div>
  );
}
