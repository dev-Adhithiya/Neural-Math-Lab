/**
 * @module useAI
 * @description Custom React hook that manages AI provider mode (online/offline)
 * and exposes a streaming chat interface.
 *
 * Reason-Act-Observe:
 *   REASON  → Determine if online or offline provider should be used
 *   ACT     → Call streamChat on the selected provider
 *   OBSERVE → Yield tokens to the onToken callback for real-time rendering
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { BrainSwitch } from '../providers/BrainSwitch.js';

/**
 * @typedef {Object} UseAIReturn
 * @property {'online'|'offline'} mode
 * @property {Function} setMode
 * @property {boolean} isStreaming
 * @property {boolean} isModelLoading
 * @property {Function} streamChat
 * @property {Function} analyzeImage
 * @property {Function} abort
 */

/**
 * @returns {UseAIReturn}
 */
export function useAI(appSettings = {}) {
  const [mode, setMode] = useState(appSettings.aiMode === 'online' ? 'online' : 'offline');  // Default to offline (local Ollama)
  const [isStreaming, setIsStreaming] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [routeBadge, setRouteBadge] = useState(null); // null | 'local'
  const providerRef = useRef(null);
  const abortRef = useRef(false);

  // Re-create provider when mode changes
  useEffect(() => {
    providerRef.current = new BrainSwitch({
      mode,
      azureEndpoint: appSettings.azureEndpoint || '',
      azureKey: appSettings.azureKey || '',
      azureDeployment: appSettings.azureDeployment || 'gpt-4o',

      azureSearchEndpoint: appSettings.azureSearchEndpoint || '',
      azureSearchKey: appSettings.azureSearchKey || '',
      azureSearchIndex: appSettings.azureSearchIndex || '',

      ollamaUrl: appSettings.ollamaUrl || 'http://localhost:11434/api/generate',
      ollamaModel: appSettings.ollamaModel || 'phi3:mini',
    });
  }, [
    mode,
    appSettings.azureEndpoint,
    appSettings.azureKey,
    appSettings.azureDeployment,
    appSettings.azureSearchEndpoint,
    appSettings.azureSearchKey,
    appSettings.azureSearchIndex,
    appSettings.ollamaUrl,
    appSettings.ollamaModel,
  ]);

  // If settings changed externally, sync mode
  useEffect(() => {
    const next = appSettings.aiMode === 'offline' ? 'offline' : 'online';
    setMode(next);
  }, [appSettings.aiMode]);

  /**
   * Stream a chat completion, calling onToken for each token.
   *
   * @param {Array<{role:string, content:string}>} messages
   * @param {Object} [options]
   * @param {Function} options.onToken  - Called with each streamed token
   * @param {Function} [options.onDone] - Called when stream completes
   * @param {Function} [options.onError]
   * @param {number}   [options.temperature]
   * @param {number}   [options.maxTokens]
   * @returns {Promise<string>} Full concatenated response
   */
  const streamChat = useCallback(async (messages, options = {}) => {
    const { onToken, onDone, onError, ...rest } = options;
    const provider = providerRef.current || new BrainSwitch({ mode });
    abortRef.current = false;
    setIsStreaming(true);
    setRouteBadge(null);

    let fullText = '';
    let tokenBuffer = '';
    let lastFlush = performance.now();
    const flushBuffer = () => {
      if (!tokenBuffer) return;
      fullText += tokenBuffer;
      onToken?.(tokenBuffer);
      tokenBuffer = '';
      lastFlush = performance.now();
    };

    try {
      for await (const token of provider.streamChat(messages, {
        ...rest,
        onBadge: (badge) => setRouteBadge(badge),
      })) {
        if (abortRef.current) break;

        tokenBuffer += token;
        const now = performance.now();

        // Send tokens in small batches to reduce rerender churn and improve perceived latency.
        if (tokenBuffer.length >= 4 || now - lastFlush > 40) {
          flushBuffer();
        }
      }

      flushBuffer();
      onDone?.(fullText);
    } catch (err) {
      console.error('[useAI] stream error:', err);
      onError?.(err);
    } finally {
      setIsStreaming(false);
      setIsModelLoading(false);
    }

    return fullText;
  }, [mode]);

  /**
   * Analyze an image (OCR / handwriting).
   * @param {string} base64Image
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  const analyzeImage = useCallback(async (base64Image, prompt) => {
    const provider = providerRef.current || new BrainSwitch({ mode });
    return provider.analyzeImage(base64Image, prompt);
  }, [mode]);

  /** Abort the current stream */
  const abort = useCallback(() => {
    abortRef.current = true;
    providerRef.current?.abort?.();
    setIsStreaming(false);
  }, []);

  return {
    mode,
    setMode,
    isStreaming,
    isModelLoading,
    routeBadge,
    streamChat,
    analyzeImage,
    abort,
  };
}

export default useAI;
