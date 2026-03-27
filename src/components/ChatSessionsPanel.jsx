import React, { useEffect, useState } from 'react';

export default function ChatSessionsPanel({
  sessions = [],
  activeSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  collapsed = false,
}) {
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');

  const handleDelete = async (id) => {
    setBusyId(id);
    try {
      await onDeleteSession?.(id);
      if (String(editingId) === String(id)) {
        setEditingId(null);
      }
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (!editingId) return;
    const s = sessions.find((x) => String(x.id) === String(editingId));
    setDraftTitle(s?.title || '');
  }, [editingId, sessions]);

  if (collapsed) return null;

  return (
    <div className="chat-sessions">
      <div className="chat-sessions-header">
        <div className="chat-sessions-title">💾 Chats</div>
        <button className="chat-sessions-new" onClick={onNewSession} title="New chat">＋</button>
      </div>
      <div className="chat-sessions-list">
        {sessions.length === 0 && (
          <div className="chat-sessions-empty">No saved chats yet.</div>
        )}
        {sessions.map((s) => (
          <div key={s.id} className={`chat-session ${String(s.id) === String(activeSessionId) ? 'active' : ''}`}>
            {editingId === s.id ? (
              <div className="chat-session-edit">
                <input
                  className="chat-session-input"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      const next = draftTitle.trim();
                      if (!next) return;
                      await onRenameSession?.(s.id, next);
                      setEditingId(null);
                    }
                    if (e.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                  placeholder="Chat title"
                />
                <button
                  className="chat-session-btn-icon chat-session-save"
                  title="Save"
                  onClick={async () => {
                    const next = draftTitle.trim();
                    if (!next) return;
                    await onRenameSession?.(s.id, next);
                    setEditingId(null);
                  }}
                >
                  ✓
                </button>
              </div>
            ) : (
              <button
                className="chat-session-btn"
                onClick={() => onSelectSession?.(s.id)}
                title={s.title}
              >
                <span className="chat-session-dot">●</span>
                <span className="chat-session-text">{s.title}</span>
              </button>
            )}
            {editingId !== s.id && (
              <button
                className="chat-session-btn-icon"
                title="Rename chat"
                onClick={() => setEditingId(s.id)}
              >
                ✎
              </button>
            )}
            {editingId === s.id && (
              <button
                className="chat-session-del"
                title="Delete chat"
                onClick={() => handleDelete(s.id)}
                disabled={busyId === s.id}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

