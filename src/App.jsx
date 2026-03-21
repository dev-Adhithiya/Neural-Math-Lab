import React from 'react';
import MathWorkspace from './components/MathWorkspace.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { SettingsProvider } from './context/SettingsContext.jsx';
import { useSettings } from './context/SettingsContext.jsx';
import './styles/index.css';

/**
 * App — Root component for Neural Math Lab.
 */
export default function App() {
  const [showSettings, setShowSettings] = React.useState(false);

  return (
    <SettingsProvider>
      <AppShell showSettings={showSettings} setShowSettings={setShowSettings} />
    </SettingsProvider>
  );
}

function AppShell({ showSettings, setShowSettings }) {
  const { settings, updateSettings } = useSettings();
  const isLight = settings.theme === 'light';

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <span className="app-logo-icon">🧠</span>
          <h1>Neural Math Lab</h1>
        </div>
        <div className="app-header-actions">
          <label className="theme-toggle" title="Toggle theme">
            <input
              type="checkbox"
              checked={isLight}
              onChange={(e) => updateSettings({ theme: e.target.checked ? 'light' : 'dark' })}
            />
            <span className="theme-toggle-track">
              <span className="theme-toggle-thumb">{isLight ? '☀️' : '🌙'}</span>
            </span>
          </label>
          <button
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
            aria-label="Settings"
          >
            ⚙️
          </button>
        </div>
      </header>

      <MathWorkspace />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
