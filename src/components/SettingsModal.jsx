import React, { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';

export default function SettingsModal({ isOpen, onClose }) {
  const { settings, updateSettings, isLoaded } = useSettings();
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [revealKeys, setRevealKeys] = useState(false);

  const maskedAzureKey = useMemo(() => (settings.azureKey ? '••••••••••••••••' : ''), [settings.azureKey]);
  const maskedGeminiKey = useMemo(() => (settings.geminiKey ? '••••••••••••••••' : ''), [settings.geminiKey]);
  const maskedSearchKey = useMemo(() => (settings.azureSearchKey ? '••••••••••••••••' : ''), [settings.azureSearchKey]);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(settings);
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const set = (key) => (e) => setDraft((p) => ({ ...p, [key]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const next = {
        theme: draft.theme === 'light' ? 'light' : 'dark',
        studentName: (draft.studentName || '').trim() || 'Student',
        aiMode: draft.aiMode === 'offline' ? 'offline' : 'online',
        // BrainSwitch uses Azure + Ollama. (Gemini kept for backward compatibility; unused.)
        provider: 'azure',
        geminiKey: (draft.geminiKey || '').trim(),
        azureEndpoint: (draft.azureEndpoint || '').trim(),
        azureKey: (draft.azureKey || '').trim(),
        azureDeployment: (draft.azureDeployment || '').trim() || 'gpt-4o',

        azureSearchEndpoint: (draft.azureSearchEndpoint || '').trim(),
        azureSearchKey: (draft.azureSearchKey || '').trim(),
        azureSearchIndex: (draft.azureSearchIndex || '').trim(),

        ollamaUrl: (draft.ollamaUrl || '').trim() || 'http://localhost:11434/api/generate',
        ollamaModel: (draft.ollamaModel || '').trim() || 'phi3:mini',
      };
      await updateSettings(next);
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div className="settings-overlay" onMouseDown={handleOverlayClick} role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-panel">
        <div className="settings-header">
          <h2>⚙️ Settings</h2>
          <button className="settings-close" onClick={onClose} title="Close">✕</button>
        </div>

        {!isLoaded && (
          <div className="settings-note">
            Loading saved settings…
          </div>
        )}

        <div className="settings-section">
          <h3>Profile</h3>
          <div className="settings-field">
            <label>Student name</label>
            <input value={draft.studentName || ''} onChange={set('studentName')} placeholder="Student" />
            <div className="settings-hint">This name is used in greetings, reports, and tutor prompts.</div>
          </div>
          <div className="settings-row">
            <label className="settings-radio">
              <input type="radio" name="theme" value="dark" checked={draft.theme !== 'light'} onChange={set('theme')} />
              <span>🌙 Dark mode</span>
            </label>
            <label className="settings-radio">
              <input type="radio" name="theme" value="light" checked={draft.theme === 'light'} onChange={set('theme')} />
              <span>☀️ Light mode</span>
            </label>
          </div>
        </div>

        <div className="settings-section">
          <h3>AI Mode</h3>
          <div className="settings-row">
            <label className="settings-radio">
              <input type="radio" name="aiMode" value="online" checked={draft.aiMode !== 'offline'} onChange={set('aiMode')} />
              <span>Online (Azure)</span>
            </label>
            <label className="settings-radio">
              <input type="radio" name="aiMode" value="offline" checked={draft.aiMode === 'offline'} onChange={set('aiMode')} />
              <span>Local (Ollama)</span>
            </label>
          </div>
          <div className="settings-hint">
            Local AI routes to Ollama when offline. Chat uses <code>phi3:mini</code> (Microsoft); image OCR uses <code>minicpm-v</code> for vision.
          </div>
        </div>

        <div className="settings-section">
          <h3>Online (Azure AI Foundry / Azure OpenAI)</h3>
          <div className="settings-field">
            <label>Azure endpoint</label>
            <input
              value={draft.azureEndpoint || ''}
              onChange={set('azureEndpoint')}
              placeholder="https://YOUR_RESOURCE.openai.azure.com"
            />
          </div>
          <div className="settings-field">
            <label>Azure key</label>
            <input
              value={draft.azureKey || ''}
              onChange={set('azureKey')}
              placeholder={maskedAzureKey || 'Paste your Azure OpenAI key'}
              type={revealKeys ? 'text' : 'password'}
            />
          </div>
          <div className="settings-field">
            <label>Model deployment</label>
            <input
              value={draft.azureDeployment || ''}
              onChange={set('azureDeployment')}
              placeholder="gpt-4o (or gpt-5)"
            />
            <div className="settings-hint">Use your Azure deployment name (e.g., `gpt-4o` or `gpt-5`).</div>
          </div>

          <div className="settings-divider" />

          <h3>Online RAG (Azure AI Search)</h3>
          <div className="settings-field">
            <label>Search endpoint</label>
            <input
              value={draft.azureSearchEndpoint || ''}
              onChange={set('azureSearchEndpoint')}
              placeholder="https://YOUR_SEARCH.search.windows.net"
            />
          </div>
          <div className="settings-field">
            <label>Search key</label>
            <input
              value={draft.azureSearchKey || ''}
              onChange={set('azureSearchKey')}
              placeholder={maskedSearchKey || 'Paste your Azure AI Search key'}
              type={revealKeys ? 'text' : 'password'}
            />
          </div>
          <div className="settings-field">
            <label>Index name</label>
            <input
              value={draft.azureSearchIndex || ''}
              onChange={set('azureSearchIndex')}
              placeholder="math-textbook"
            />
            <div className="settings-hint">This should be the index that contains chunks from `math_textbook.pdf`.</div>
          </div>

          <div className="settings-divider" />

          <h3>Local (Ollama)</h3>
          <div className="settings-field">
            <label>Ollama URL</label>
            <input
              value={draft.ollamaUrl || ''}
              onChange={set('ollamaUrl')}
              placeholder="http://localhost:11434/api/generate"
            />
          </div>
          <div className="settings-field">
            <label>Ollama model</label>
            <input
              value={draft.ollamaModel || ''}
              onChange={set('ollamaModel')}
              placeholder="phi3:mini"
            />
          </div>

          <label className="settings-checkbox">
            <input type="checkbox" checked={revealKeys} onChange={(e) => setRevealKeys(e.target.checked)} />
            <span>Show API keys</span>
          </label>
        </div>

        <div className="settings-footer">
          <button className="settings-btn secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="settings-btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

