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
                  placeholder="Chat title"
                />
                <button
                  className="chat-session-del"
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
                className="chat-session-del"
                title="Rename chat"
                onClick={() => setEditingId(s.id)}
              >
                ✎
              </button>
            )}
            <button
              className="chat-session-del"
              title="Delete chat"
              onClick={async () => {
                setBusyId(s.id);
                try {
                  await onDeleteSession?.(s.id);
                } finally {
                  setBusyId(null);
                }
              }}
              disabled={busyId === s.id}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

