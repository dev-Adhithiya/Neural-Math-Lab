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
import { getDefaultOllamaProxyUrl } from '../config/api.js';

function createThoughtFilter() {
  let inHiddenBlock = false;
  let pending = '';
  const maxTagCarry = 16;

  return {
    push(chunk) {
      if (!chunk) return '';
      pending += String(chunk);

      let out = '';
      while (pending.length > 0) {
        if (!inHiddenBlock) {
          const lower = pending.toLowerCase();
          const iThink = lower.indexOf('<think>');
          const iThinking = lower.indexOf('<thinking>');

          let start = -1;
          let tagLen = 0;
          if (iThink >= 0 && (iThinking < 0 || iThink < iThinking)) {
            start = iThink;
            tagLen = '<think>'.length;
          } else if (iThinking >= 0) {
            start = iThinking;
            tagLen = '<thinking>'.length;
          }

          if (start < 0) {
            // Keep a small carry to safely match tags split across chunks.
            const emitLen = Math.max(0, pending.length - maxTagCarry);
            if (emitLen === 0) break;
            out += pending.slice(0, emitLen);
            pending = pending.slice(emitLen);
            continue;
          }

          out += pending.slice(0, start);
          pending = pending.slice(start + tagLen);
          inHiddenBlock = true;
          continue;
        }

        const lower = pending.toLowerCase();
        const iEndThink = lower.indexOf('</think>');
        const iEndThinking = lower.indexOf('</thinking>');

        let end = -1;
        let endLen = 0;
        if (iEndThink >= 0 && (iEndThinking < 0 || iEndThink < iEndThinking)) {
          end = iEndThink;
          endLen = '</think>'.length;
        } else if (iEndThinking >= 0) {
          end = iEndThinking;
          endLen = '</thinking>'.length;
        }

        if (end < 0) {
          // Drop most hidden text but keep a tiny tail to detect closing tag split.
          if (pending.length > maxTagCarry) {
            pending = pending.slice(-maxTagCarry);
          }
          break;
        }

        pending = pending.slice(end + endLen);
        inHiddenBlock = false;
      }

      return out;
    },
    flush() {
      // Emit remaining visible tail only when not inside a hidden block.
      if (inHiddenBlock) return '';
      const tail = pending;
      pending = '';
      return tail;
    },
  };
}

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

      ollamaUrl: appSettings.ollamaUrl || getDefaultOllamaProxyUrl(),
      ollamaModel: appSettings.ollamaModel || 'deepseek-r1:7b',
      strictMode: appSettings.strictMode !== false,
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
    appSettings.strictMode,
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
    const thoughtFilter = createThoughtFilter();
    let tokenBuffer = '';
    let lastFlush = performance.now();
    const flushBuffer = () => {
      if (!tokenBuffer) return;
      const delta = thoughtFilter.push(tokenBuffer);
      if (delta) {
        fullText += delta;
        onToken?.(delta);
      }
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
        if (tokenBuffer.length >= 3 || now - lastFlush > 24) {
          flushBuffer();
        }
      }

      flushBuffer();
      const finalTail = thoughtFilter.flush();
      if (finalTail) {
        fullText += finalTail;
        onToken?.(finalTail);
      }
      onDone?.(fullText, { aborted: abortRef.current === true });
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
