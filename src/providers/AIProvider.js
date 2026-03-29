/**
 * @module AIProvider
 * @description Hybrid Online/Offline AI Provider for Neural Math Lab.
 *
 * Implements the Reason-Act-Observe pattern:
 *   REASON  → Select provider (Azure OpenAI / Gemini / Transformers.js)
 *   ACT     → Stream tokens via SSE (online) or async generator (offline)
 *   OBSERVE → Yield each token to the UI for real-time rendering
 *
 * @example
 *   const provider = createAIProvider('online', { provider: 'azure', ... });
 *   for await (const token of provider.streamChat(messages)) { ... }
 */

/* ───────────────────────── Online Provider ───────────────────────── */

export class OnlineProvider {
  /**
   * @param {Object} config
   * @param {'azure'|'gemini'} config.provider
   * @param {string} config.endpoint  - Azure resource URL (azure) or unused (gemini)
   * @param {string} config.apiKey
   * @param {string} [config.deployment] - Azure deployment name
   */
  constructor(config) {
    this.provider = config.provider || 'gemini';
    this.endpoint = config.endpoint || '';
    this.apiKey = config.apiKey || '';
    this.deployment = config.deployment || 'gpt-4o';
  }

  /**
   * Stream chat completions token-by-token via SSE.
   * @param {Array<{role:string, content:string}>} messages
   * @param {Object} [opts]
   * @param {number} [opts.temperature=0.7]
   * @param {number} [opts.maxTokens=2048]
   * @yields {string} Individual tokens
   */
  async *streamChat(messages, opts = {}) {
    if (this.provider === 'azure') {
      yield* this._streamAzure(messages, opts);
    } else {
      yield* this._streamGemini(messages, opts);
    }
  }

  /** Azure OpenAI SSE stream */
  async *_streamAzure(messages, opts) {
    const url = `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=2024-02-01`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': this.apiKey },
      body: JSON.stringify({
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2048,
      }),
    });

    if (!res.ok) throw new Error(`Azure API ${res.status}: ${await res.text()}`);
    yield* this._parseSSE(res);
  }

  /** Google Gemini SSE stream */
  async *_streamGemini(messages, opts) {
    const model = opts.model || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemInstruction = messages.find((m) => m.role === 'system');

    const body = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 2048,
      },
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
    yield* this._parseGeminiSSE(res);
  }

  /** Parse standard OpenAI-style SSE */
  async *_parseSSE(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch { /* incomplete JSON chunk — skip */ }
      }
    }
  }

  /** Parse Gemini SSE format */
  async *_parseGeminiSSE(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch { /* incomplete chunk */ }
      }
    }
  }

  /**
   * Vision request — send an image for OCR / analysis.
   * @param {string} base64Image - Base64-encoded image data
   * @param {string} prompt
   * @returns {Promise<string>} Extracted text / LaTeX
   */
  async analyzeImage(base64Image, prompt) {
    if (this.provider === 'azure') {
      return this._azureVision(base64Image, prompt);
    }
    return this._geminiVision(base64Image, prompt);
  }

  async _azureVision(base64Image, prompt) {
    const url = `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=2024-02-01`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': this.apiKey },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });
    const json = await res.json();
    return json.choices?.[0]?.message?.content || '';
  }

  async _geminiVision(base64Image, prompt) {
    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
            ],
          },
        ],
      }),
    });
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

/* ───────────────────────── Offline Provider ──────────────────────── */

export class OfflineProvider {
  constructor() {
    this.pipeline = null;
    this.loading = false;
    this.ready = false;
  }

  /** Load Phi-3 via Transformers.js with WebGPU */
  async initialize(onProgress) {
    if (this.ready || this.loading) return;
    this.loading = true;
    try {
      // Lazy load transformers only when needed, with fallback
      let transformersModule;
      try {
        // Use dynamic import with optional chaining fallback
        transformersModule = await import('@xenova/transformers').catch(() => null);
      } catch (e) {
        console.warn('⚠️ Transformers library not available, using cloud AI only', e.message);
        this.ready = false;
        return;
      }
      
      if (!transformersModule) {
        console.warn('⚠️ Transformers library not available, using cloud AI only');
        this.ready = false;
        return;
      }
      
      const { pipeline, env } = transformersModule;
      env.allowLocalModels = false;
      this.pipeline = await pipeline('text-generation', 'Xenova/phi-1_5', {
        device: typeof navigator !== 'undefined' && navigator.gpu ? 'webgpu' : 'wasm',
        progress_callback: onProgress,
      });
      this.ready = true;
    } catch (e) {
      console.error('❌ Failed to initialize transformers:', e);
      this.ready = false;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Stream tokens from the local model.
   * @param {Array<{role:string, content:string}>} messages
   * @param {Object} [opts]
   * @yields {string}
   */
  async *streamChat(messages, opts = {}) {
    if (!this.ready) {
      yield '⏳ Loading local AI model… Please wait.\n';
      await this.initialize();
    }

    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n') + '\nassistant:';

    const output = await this.pipeline(prompt, {
      max_new_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.7,
      do_sample: true,
    });

    const generated = output[0].generated_text.slice(prompt.length);
    // Simulate streaming by yielding word-by-word without artificial blocking if possible
    const words = generated.split(/(\s+)/);
    for (const word of words) {
      if (word.trim()) yield word;
      else if (word) yield word; // spaces
    }
  }

  /** Offline vision is not supported — provide a graceful fallback */
  async analyzeImage() {
    return '⚠️ Image analysis requires an online AI provider. Please switch to Online mode for handwriting OCR.';
  }
}

/* ───────────────────────── Factory ────────────────────────────────── */

/**
 * Create an AI provider instance.
 * @param {'online'|'offline'} mode
 * @param {Object} [config] - Required for online mode
 * @returns {OnlineProvider|OfflineProvider}
 */
export function createAIProvider(mode = 'online', config = {}) {
  if (mode === 'offline') return new OfflineProvider();

  // Auto-detect provider from available env vars
  const provider = config.provider
    || (config.apiKey || import.meta.env.VITE_GEMINI_KEY ? 'gemini' : 'azure');

  return new OnlineProvider({
    provider,
    endpoint: config.endpoint || import.meta.env.VITE_AZURE_OPENAI_ENDPOINT || '',
    apiKey: config.apiKey || (provider === 'gemini'
      ? import.meta.env.VITE_GEMINI_KEY
      : import.meta.env.VITE_AZURE_OPENAI_KEY) || '',
    deployment: config.deployment || import.meta.env.VITE_AZURE_DEPLOYMENT || 'gpt-4o',
  });
}
