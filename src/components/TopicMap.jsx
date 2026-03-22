import React, { useMemo } from 'react';
import { TOPICS, getTopic, getPrerequisiteChain } from '../agents/KnowledgeGraph.js';

function buildEdges() {
  const edges = [];
  for (const t of TOPICS) {
    for (const pre of t.prerequisites || []) {
      edges.push([pre, t.id]);
    }
  }
  return edges;
}

function topicInitials(label) {
  return (label || '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function buildLayout() {
  const colsPerRow = Math.min(4, Math.max(3, TOPICS.length));
  const rowHeight = 178;
  const colWidth = 290;
  const margin = { x: 38, y: 36 };
  const node = { w: 248, h: 86 };

  // Grid layout: arrange in 3-column rows
  const positions = new Map();
  const sortedTopics = [...TOPICS].sort((a, b) => {
    const tierDiff = (a.tier || 0) - (b.tier || 0);
    if (tierDiff !== 0) return tierDiff;
    const catDiff = (a.category || '').localeCompare(b.category || '');
    return catDiff !== 0 ? catDiff : (a.label || '').localeCompare(b.label || '');
  });

  sortedTopics.forEach((t, idx) => {
    const row = Math.floor(idx / colsPerRow);
    const col = idx % colsPerRow;
    const x = margin.x + col * colWidth;
    const y = margin.y + row * rowHeight;
    positions.set(t.id, { x, y, tier: t.tier, idx });
  });

  const numRows = Math.ceil(TOPICS.length / colsPerRow);
  const width = margin.x * 2 + colsPerRow * colWidth;
  const height = margin.y * 2 + numRows * rowHeight + node.h;

  return { positions, width, height, node, tierKeys: [0] };
}

function isInSelectedNeighborhood(selectedId, chain, id) {
  if (!selectedId) return false;
  if (id === selectedId) return true;
  if (chain.includes(id)) return true;
  const selected = getTopic(selectedId);
  if (selected?.prerequisites?.includes(id)) return true;
  return false;
}

export default function TopicMap({ selectedTopic, onSelectTopic }) {
  const edges = useMemo(() => buildEdges(), []);
  const selected = selectedTopic ? getTopic(selectedTopic) : null;
  const chain = useMemo(() => (selectedTopic ? getPrerequisiteChain(selectedTopic) : []), [selectedTopic]);
  const layout = useMemo(() => buildLayout(), []);

  const selectedSet = useMemo(() => new Set([...(chain || []), ...(selectedTopic ? [selectedTopic] : [])]), [chain, selectedTopic]);
  const visibleEdges = useMemo(() => {
    if (!selectedTopic) return [];
    // Only show edges on the prerequisite path (chain → selected).
    const allowed = new Set(selectedSet);
    const toSelected = new Set([selectedTopic, ...chain]);
    return edges.filter(([from, to]) => allowed.has(from) && toSelected.has(to) && allowed.has(to));
  }, [edges, selectedTopic, chain, selectedSet]);

  return (
    <div className="topic-map">
      <div className="topic-map-header">
        <h3>🗺️ Math Topic Map</h3>
        <div className="topic-map-subtitle">Select a topic to explore prerequisites</div>
      </div>

      <div className="topic-map-canvas" role="application" aria-label="Math topic map diagram">
        <svg
          className="topic-map-svg"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
        >
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" className="topic-map-arrow" />
            </marker>
          </defs>

          {/* Prerequisite edges - hidden by default, shown only on selection */}
          {(selectedTopic ? visibleEdges : []).map(([from, to], idx) => {
            const a = layout.positions.get(from);
            const b = layout.positions.get(to);
            if (!a || !b) return null;

            const x1 = a.x + layout.node.w;
            const y1 = a.y + layout.node.h / 2;
            const x2 = b.x;
            const y2 = b.y + layout.node.h / 2;

            const midX = (x1 + x2) / 2;
            const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

            const active = selectedSet.has(from) && selectedSet.has(to);
            const dim = selectedTopic ? !active : false;

            return (
              <path
                key={`${from}-${to}-${idx}`}
                d={d}
                markerEnd="url(#arrow)"
                className={`topic-map-link ${active ? 'active' : ''} ${dim ? 'dim' : ''}`}
              />
            );
          })}

          {/* Nodes */}
          {TOPICS.map((t) => {
            const p = layout.positions.get(t.id);
            if (!p) return null;
            const isSelected = t.id === selectedTopic;
            const inPath = selectedSet.has(t.id);
            const dim = selectedTopic && !isInSelectedNeighborhood(selectedTopic, chain, t.id);

            return (
              <g
                key={t.id}
                className={`topic-map-nodeg ${isSelected ? 'selected' : ''} ${inPath ? 'in-path' : ''} ${dim ? 'dim' : ''}`}
                transform={`translate(${p.x}, ${p.y})`}
                onClick={() => onSelectTopic?.(t.id)}
                role="button"
                tabIndex={0}
              >
                <rect className="topic-map-rect" width={layout.node.w} height={layout.node.h} rx="8" />
                <rect className="topic-map-badge" x="10" y="10" width="34" height="34" rx="8" />
                <text className="topic-map-badge-text" x="27" y="32" textAnchor="middle" fontSize="12" fontWeight="500">
                  {topicInitials(t.label) || '•'}
                </text>
                <text className="topic-map-title" x="54" y="33" fontSize="15" fontWeight="700">
                  {t.label}
                </text>
                <text className="topic-map-meta" x="54" y="58" fontSize="12">
                  {t.category} • T{t.tier}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="topic-map-detail">
        {selected ? (
          <>
            <h4>{selected.label}</h4>
            <div className="topic-map-detail-row">
              <span className="pill">Category: {selected.category}</span>
              <span className="pill">Tier: {selected.tier}</span>
              <span className="pill">Prereqs: {selected?.prerequisites?.length ?? 0}</span>
            </div>
            {!selected?.prerequisites || selected.prerequisites.length === 0 ? (
              <p className="topic-map-detail-text">No prerequisites. You can start here anytime.</p>
            ) : (
              <>
                <p className="topic-map-detail-text">
                  Prerequisite chain (ordered): {chain.map((id) => getTopic(id)?.label || id).join(' → ')}
                </p>
                <div className="topic-map-mini">
                  {edges
                    .filter(([from, to]) => to === selected.id || chain.includes(to) || chain.includes(from))
                    .slice(0, 16)
                    .map(([from, to], idx) => (
                      <div className="topic-map-edge" key={`${from}-${to}-${idx}`}>
                        <span className="edge-from">{getTopic(from)?.label || from}</span>
                        <span className="edge-arrow">→</span>
                        <span className="edge-to">{getTopic(to)?.label || to}</span>
                      </div>
                    ))}
                </div>
                <div className="topic-map-detail-text">
                  Tip: choose <b>AI Chat</b> then click a topic to start: “I want to learn about …”
                </div>
              </>
            )}
          </>
        ) : (
          <div className="topic-map-empty">Select a topic to view its map details.</div>
        )}
      </div>
    </div>
  );
}

