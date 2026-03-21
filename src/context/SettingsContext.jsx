import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAllSettings, getProfile, setSetting, updateProfile } from '../store/localVault.js';

const SettingsContext = createContext(null);

function getEnvDefaults() {
  return {
    theme: 'dark', // 'dark' | 'light'
    studentName: import.meta.env.VITE_STUDENT_NAME || 'Student',
    aiMode: 'online', // 'online' | 'offline'
    provider: (import.meta.env.VITE_GEMINI_KEY ? 'gemini' : 'azure'), // 'gemini' | 'azure'
    geminiKey: import.meta.env.VITE_GEMINI_KEY || '',
    azureEndpoint: import.meta.env.VITE_AZURE_OPENAI_ENDPOINT || '',
    azureKey: import.meta.env.VITE_AZURE_OPENAI_KEY || '',
    azureDeployment: import.meta.env.VITE_AZURE_DEPLOYMENT || 'gpt-4o',

    // Online-only RAG (Azure AI Search)
    azureSearchEndpoint: import.meta.env.VITE_AZURE_SEARCH_ENDPOINT || '',
    azureSearchKey: import.meta.env.VITE_AZURE_SEARCH_KEY || '',
    azureSearchIndex: import.meta.env.VITE_AZURE_SEARCH_INDEX || '',

    // Local provider (Ollama)
    ollamaUrl: import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434/api/generate',
    ollamaModel: import.meta.env.VITE_OLLAMA_MODEL || 'phi3:mini',
  };
}

function mergeSettings(defaults, stored, profile) {
  const merged = { ...defaults, ...stored };
  if (profile?.name) merged.studentName = profile.name;
  // Auto-pick provider if user has one key but not the other
  if (merged.provider !== 'azure' && merged.provider !== 'gemini') {
    merged.provider = merged.geminiKey ? 'gemini' : 'azure';
  }
  return merged;
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => getEnvDefaults());
  const [isLoaded, setIsLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [stored, profile] = await Promise.all([getAllSettings(), getProfile()]);
    const defaults = getEnvDefaults();
    setSettings(mergeSettings(defaults, stored, profile));
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const theme = settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
  }, [settings.theme]);

  const updateSettings = useCallback(async (updates) => {
    setSettings((prev) => ({ ...prev, ...updates }));

    const writes = [];
    for (const [key, value] of Object.entries(updates || {})) {
      if (key === 'studentName') continue; // stored in profile
      writes.push(setSetting(key, value));
    }

    if (typeof updates?.studentName === 'string') {
      const name = updates.studentName.trim() || 'Student';
      writes.push(updateProfile({ name }));
    }

    await Promise.all(writes);
  }, []);

  const value = useMemo(() => ({ settings, updateSettings, reload, isLoaded }), [settings, updateSettings, reload, isLoaded]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

