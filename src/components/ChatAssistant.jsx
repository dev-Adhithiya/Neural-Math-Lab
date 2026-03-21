import React, { useState, useRef, useEffect, useCallback } from 'react';
import { renderMathInText } from './StreamingText.jsx';

/**
 * ChatAssistant — Main AI chat interface.
 * Greets the student, offers quick actions, and acts as a Senior Maths Teacher.
 *
 * @param {Object} props
 * @param {Array}   props.messages     - Chat message array [{role, content, id}]
 * @param {Function} props.onSend      - Called with user message string
 * @param {boolean}  props.isStreaming  - Whether AI is currently responding
 * @param {string}   props.streamingText - Current partial AI response
 * @param {Function} [props.onQuickAction] - Called with action type
 * @param {Function} [props.onImageUpload] - Called with file
 * @param {string}   [props.studentName]
 */
export default function ChatAssistant({
  messages = [],
  onSend,
  onSendWithImage,
  isStreaming,
  streamingText = '',
  onQuickAction,
  onImageUpload,
  onAbort,
  studentName = 'Student',
  routeBadge = null, // null | 'local'
}) {
  const [input, setInput] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [pendingImage, setPendingImage] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (isStreaming) return;
    if (!trimmed && !pendingImage) return;

    if (pendingImage) {
      onSendWithImage?.(trimmed, pendingImage);
      setPendingImage(null);
    } else {
      onSend(trimmed);
    }
    setInput('');
  }, [input, isStreaming, onSend, onSendWithImage, pendingImage]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgItem = items.find((it) => it.type?.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    setUploadError('');
    const file = imgItem.getAsFile();
    if (!file) return;
    setPendingImage(file);
  };

  const handleFileChange = (e) => {
    setUploadError('');
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type?.startsWith('image/')) {
        setUploadError('❌ Only image files are allowed. Please select a PNG/JPG/JPEG/WebP/BMP/GIF image.');
        e.target.value = '';
        return;
      }
      setPendingImage(file);
      e.target.value = '';
    }
  };

  const quickActions = [
    { id: 'plan', icon: '🗓️', label: 'Plan My Session', desc: 'Get a personalized learning path' },
    { id: 'learn', icon: '📚', label: 'Learn a Topic', desc: 'Pick a topic to study' },
    { id: 'prerequisites', icon: '🔗', label: 'Check Prerequisites', desc: 'See what to learn first' },
    { id: 'quiz', icon: '🏆', label: 'Take a Quiz', desc: 'Test your knowledge & earn XP' },
    { id: 'report', icon: '📊', label: 'My Report', desc: 'View your progress report' },
  ];

  return (
    <div className="chat-assistant">
      {/* Chat Header */}
      <div className="chat-header">
        <div className="chat-header-avatar">🧠</div>
        <div className="chat-header-info">
          <h2>Neural Math Lab</h2>
          <span className="chat-header-status">
            {isStreaming ? (
              <><span className="status-dot active"></span> Thinking...</>
            ) : (
              <><span className="status-dot online"></span> Ready to help</>
            )}
          </span>
        </div>
        {routeBadge === 'local' && (
          <div className="route-badge" title="Offline routing: using local Ollama">
            Working Locally
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="chat-welcome">
            <div className="welcome-icon">👋</div>
            <h3>Hello, {studentName}!</h3>
            <p>I'm your Senior Mathematics Teacher. What can I help you with today?</p>
            <div className="quick-actions">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  className="quick-action-btn"
                  onClick={() => onQuickAction?.(action.id)}
                >
                  <span className="qa-icon">{action.icon}</span>
                  <span className="qa-label">{action.label}</span>
                  <span className="qa-desc">{action.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={msg.id || i} className={`chat-message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🧠'}
            </div>
            <div className="message-content">
              {msg.image && (
                <div style={{ marginBottom: '8px' }}>
                  <img src={msg.image} alt="Upload" style={{ maxWidth: '100%', borderRadius: '8px', maxHeight: '250px', objectFit: 'contain' }} />
                </div>
              )}
              <div
                className="message-text"
                dangerouslySetInnerHTML={{ __html: renderMathInText(msg.content) }}
              />
              {msg.xpAward && (
                <div className="xp-notification">
                  +{msg.xpAward.xpAwarded} XP {msg.xpAward.leveledUp && `🎉 Level Up! ${msg.xpAward.newLevelTitle}`}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {isStreaming && streamingText && (
          <div className="chat-message assistant streaming">
            <div className="message-avatar">🧠</div>
            <div className="message-content">
              <div
                className="message-text"
                dangerouslySetInnerHTML={{ __html: renderMathInText(streamingText) }}
              />
              <span className="typing-cursor">▊</span>
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="chat-message assistant">
            <div className="message-avatar">🧠</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-area">
        <button
          className="chat-upload-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Upload handwritten math"
        >
          📷
        </button>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden-input"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
        />
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask me anything about math..."
          rows={1}
          disabled={isStreaming}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={(!input.trim() && !pendingImage) || isStreaming}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
        {isStreaming && (
          <button
            className="chat-stop-btn"
            onClick={() => onAbort?.()}
            title="Stop generating"
            aria-label="Stop generating"
          >
            ⏹
          </button>
        )}
      </div>
      {pendingImage && (
        <div className="attachment-row">
          <div className="attachment-pill" title={pendingImage.name || 'image'}>
            📎 {pendingImage.name || 'pasted-image'}
          </div>
          <button className="attachment-remove" onClick={() => setPendingImage(null)} title="Remove attachment">✕</button>
        </div>
      )}
      {uploadError && <div className="upload-error-inline">{uploadError}</div>}
    </div>
  );
}
