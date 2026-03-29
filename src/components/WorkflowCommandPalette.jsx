import React, { useEffect, useMemo, useState } from 'react';

export default function WorkflowCommandPalette({
  isOpen,
  query,
  onQueryChange,
  commands,
  onRun,
  onClose,
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((cmd) => {
      return [cmd.label, cmd.group, cmd.hint]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle));
    });
  }, [commands, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const selected = filtered[activeIndex];
        if (!selected) return;
        onRun(selected);
        onClose();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, filtered, isOpen, onClose, onRun]);

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="command-palette-head">
          <span className="command-kbd">Ctrl/Cmd + K</span>
          <input
            className="command-input"
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Launch workflow, navigate views, or run prompts..."
          />
        </div>

        <div className="command-list">
          {filtered.length === 0 && (
            <div className="command-empty">No matching commands. Try "workflow", "quiz", or "focus".</div>
          )}

          {filtered.map((cmd, index) => (
            <button
              key={cmd.id}
              className={`command-item ${index === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                onRun(cmd);
                onClose();
              }}
            >
              <span className="command-item-label">{cmd.label}</span>
              <span className="command-item-meta">{cmd.group}</span>
              {cmd.hint && <span className="command-item-hint">{cmd.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
