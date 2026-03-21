/**
 * BrainSwitch — Unified Hybrid AI Provider (Azure + Ollama)
 *
 * GOAL:
 * - One interface: askAgent(prompt, image)
 * - Smart routing: navigator.onLine + heuristics (vision, final exam/grading)
 * - Identical streaming UX: TextDecoder-based chunk piping for both backends
 * - Online-only RAG: Azure AI Search grounding
 *
 * SECURITY NOTE:
 * This implementation calls Azure/Ollama directly from the browser, which exposes keys in the client.
 * For production, proxy requests via a backend and use managed identity / server-side secrets.
 */

const DEFAULTS = {
  azureApiVersion: '2024-02-01',
  maxTokens: 2048,
  temperature: 0.7,

  // Local (Ollama)
  ollamaUrl: 'http://localhost:11434/api/generate',
  ollamaModel: 'phi3:mini',
};

export class BrainSwitch {
  /**
   * @param {Object} config
   * @param {string} [config.azureEndpoint]
   * @param {string} [config.azureKey]
   * @param {string} [config.azureDeployment]  - gpt-4o / gpt-5 (deployment name)
   * @param {string} [config.azureApiVersion]
   *
   * @param {string} [config.azureSearchEndpoint] - e.g. https://<svc>.search.windows.net
   * @param {string} [config.azureSearchKey]
   * @param {string} [config.azureSearchIndex]
   *
   * @param {string} [config.ollamaUrl]
   * @param {string} [config.ollamaModel]
   *
   * @param {'online'|'offline'|'auto'} [config.mode]
   */
  constructor(config = {}) {
    this.config = { ...DEFAULTS, ...config };
    this.abortController = null;
    this.lastRoute = null; // 'azure' | 'ollama'
  }

  setConfig(next = {}) {
    this.config = { ...this.config, ...next };
  }

  abort() {
    try {
      this.abortController?.abort();
    } catch {
      // ignore
    }
  }

  /**
   * Unified interface requested by hackathon.
   * @param {string} prompt
   * @param {string|null} imageBase64 - raw base64 (no data: prefix) or null
   * @param {Object} [opts]
   * @param {boolean} [opts.isFinalExam]
   * @param {boolean} [opts.forceAzure]
   * @param {Function} [opts.onRoute] - (route: 'azure'|'ollama') => void
   * @param {Function} [opts.onBadge] - (badge: null|'local') => void
   * @param {Object} [opts.generation]
   * @param {number} [opts.generation.maxTokens]
   * @param {number} [opts.generation.temperature]
   * @yields {string}
   */
  async *askAgent(prompt, imageBase64 = null, opts = {}) {
    const route = this._decideRoute({ prompt, imageBase64, opts });
    this.lastRoute = route;
    opts.onRoute?.(route);
    opts.onBadge?.(route === 'ollama' ? 'local' : null);

    if (route === 'ollama') {
      yield* this._streamOllama(prompt, opts);
      return;
    }

    const groundedMessages = await this._buildAzureMessages(prompt, imageBase64, opts);
    yield* this._streamAzureChat(groundedMessages, opts);
  }

  /**
   * Adapter used by TutorAgent (messages[] -> stream).
   * @param {Array<{role:string, content:string}>} messages
   * @param {Object} [opts]
   * @yields {string}
   */
  async *streamChat(messages, opts = {}) {
    const isFinalExam = opts.isFinalExam ?? this._looksLikeFinalExam(messages, '');
    const route = this._decideRoute({ prompt: '', imageBase64: null, opts: { ...opts, isFinalExam } });
    this.lastRoute = route;
    opts.onBadge?.(route === 'ollama' ? 'local' : null);

    if (route === 'ollama') {
      const prompt = this._messagesToPrompt(messages);
      yield* this._streamOllama(prompt, opts);
      return;
    }

    const grounded = await this._injectRagIntoMessages(messages).catch(() => messages);
    yield* this._streamAzureChat(grounded, opts);
  }

  /**
   * Vision/OCR path. If offline, returns a graceful fallback string.
   * @param {string} base64Image
   * @param {string} prompt
   */
  async analyzeImage(base64Image, prompt) {
    const route = this._decideRoute({ prompt, imageBase64: base64Image, opts: { forceAzure: true } });
    this.lastRoute = route;
    if (route === 'ollama') {
      return '⚠️ Image OCR is only available online. Please reconnect to use Vision.';
    }

    const messages = await this._buildAzureMessages(prompt, base64Image, { forceAzure: true });
    // Use non-streaming for vision convenience.
    return this._azureNonStreaming(messages);
  }

  /* ───────────────────────── Routing ───────────────────────── */

  _decideRoute({ prompt, imageBase64, opts }) {
    const mode = this.config.mode || 'auto';
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const isOnline = mode === 'online' ? true : mode === 'offline' ? false : online;

    const hasImage = Boolean(imageBase64);
    const isFinalExam = Boolean(opts?.isFinalExam) || this._looksLikeFinalExam(null, prompt);

    // Smart routing rules: prefer local Ollama for speed, Azure only when needed
    if (opts?.forceAzure) return isOnline ? 'azure' : 'ollama';
    if (opts?.preferLocal) return 'ollama';
    if (!isOnline) return 'ollama';
    if (hasImage) return 'azure';      // OCR requires Azure Vision
    if (isFinalExam) return 'azure';   // Final exams use Azure for reliability

    return 'ollama';  // Default to local for fast response times
  }

  _looksLikeFinalExam(messages, prompt) {
    const text = `${prompt || ''}\n${(messages || []).map((m) => `${m.role}: ${m.content}`).join('\n')}`.toLowerCase();
    return (
      text.includes('final exam')
      || text.includes('grading context')
      || text.includes('grade this')
      || text.includes('marks')
      || text.includes('rubric')
      || text.includes('step-by-step breakdown')
    );
  }

  _messagesToPrompt(messages) {
    return (messages || [])
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n')
      .trim();
  }

  /* ───────────────────────── Online (Azure) ───────────────────────── */

  async _buildAzureMessages(prompt, imageBase64, opts) {
    const rag = await this._tryRag(prompt).catch(() => null);
    const system = rag?.context
      ? `You are a helpful math tutor.\n\nGROUNDING CONTEXT (from math_textbook.pdf via Azure AI Search):\n${rag.context}\n\nUse the context when relevant; if it doesn't apply, ignore it.`
      : 'You are a helpful math tutor.';

    if (imageBase64) {
      return [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ];
    }

    return [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ];
  }

  async _injectRagIntoMessages(messages) {
    const lastUser = [...(messages || [])].reverse().find((m) => m.role === 'user');
    const query = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const rag = await this._tryRag(query).catch(() => null);
    if (!rag?.context) return messages;

    const ragSystem = {
      role: 'system',
      content: `GROUNDING CONTEXT (from math_textbook.pdf via Azure AI Search):\n${rag.context}\n\nUse the context when relevant; if it doesn't apply, ignore it.`,
    };

    // Keep existing system prompt (TutorAgent rules) and insert RAG after it.
    const out = [...(messages || [])];
    const firstSystemIdx = out.findIndex((m) => m.role === 'system');
    if (firstSystemIdx >= 0) {
      out.splice(firstSystemIdx + 1, 0, ragSystem);
      return out;
    }
    return [ragSystem, ...out];
  }

  async _tryRag(query) {
    const { azureSearchEndpoint, azureSearchKey, azureSearchIndex } = this.config;
    if (!azureSearchEndpoint || !azureSearchKey || !azureSearchIndex) return null;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

    const url = `${azureSearchEndpoint.replace(/\/+$/, '')}/indexes/${encodeURIComponent(azureSearchIndex)}/docs/search?api-version=2023-11-01`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': azureSearchKey,
      },
      body: JSON.stringify({
        search: query,
        top: 4,
        queryType: 'simple',
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const docs = json?.value || [];

    const snippets = docs
      .map((d, i) => {
        const text = d.content || d.text || d.chunk || d.pageContent || '';
        const title = d.title || d.filename || d.source || `Result ${i + 1}`;
        return text ? `- ${title}: ${String(text).slice(0, 1200)}` : null;
      })
      .filter(Boolean)
      .join('\n');

    if (!snippets) return null;
    return { context: snippets };
  }

  async *_streamAzureChat(messages, opts) {
    const { azureEndpoint, azureKey, azureDeployment, azureApiVersion } = this.config;
    if (!azureEndpoint || !azureKey || !azureDeployment) {
      throw new Error('Azure settings missing (endpoint/key/deployment). Open Settings (⚙️).');
    }

    const maxTokens = opts?.generation?.maxTokens ?? opts.maxTokens ?? this.config.maxTokens;
    const temperature = opts?.generation?.temperature ?? opts.temperature ?? this.config.temperature;

    const url = `${azureEndpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=${encodeURIComponent(azureApiVersion || DEFAULTS.azureApiVersion)}`;
    this.abortController = new AbortController();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': azureKey,
      },
      signal: this.abortController.signal,
      body: JSON.stringify({
        messages,
        stream: true,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      throw new Error(`Azure API ${res.status}: ${await res.text()}`);
    }

    yield* this._parseOpenAISSE(res);
  }

  async _azureNonStreaming(messages) {
    const { azureEndpoint, azureKey, azureDeployment, azureApiVersion } = this.config;
    if (!azureEndpoint || !azureKey || !azureDeployment) {
      throw new Error('Azure settings missing (endpoint/key/deployment). Open Settings (⚙️).');
    }
    const url = `${azureEndpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(azureDeployment)}/chat/completions?api-version=${encodeURIComponent(azureApiVersion || DEFAULTS.azureApiVersion)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': azureKey,
      },
      body: JSON.stringify({
        messages,
        stream: false,
        temperature: this.config.temperature,
        max_tokens: 1024,
      }),
    });
    if (!res.ok) throw new Error(`Azure API ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json?.choices?.[0]?.message?.content || '';
  }

  async *_parseOpenAISSE(res) {
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
        } catch {
          // ignore partial chunks
        }
      }
    }
  }

  /* ───────────────────────── Local (Ollama) ───────────────────────── */

  async *_streamOllama(prompt, opts) {
    const url = this.config.ollamaUrl || DEFAULTS.ollamaUrl;
    const model = this.config.ollamaModel || DEFAULTS.ollamaModel;

    this.abortController = new AbortController();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: this.abortController.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: {
          temperature: opts?.generation?.temperature ?? opts.temperature ?? this.config.temperature,
          num_gpu: 1,
        },
      }),
    });

    if (!res.ok) {
      const rawText = await res.text();
      const message = rawText || `status ${res.status}`;

      if (/model requires more system memory/i.test(message)) {
        throw new Error(
          `Ollama memory error: ${message}. Please switch to a smaller model (e.g., phi3:tiny) in Settings or select online mode.`
        );
      }

      if (/runner process has terminated/i.test(message) || /cuda error/i.test(message)) {
        throw new Error(
          `Ollama runtime error: ${message}. Try restarting the Ollama daemon, reducing model size, or switching to online provider.`
        );
      }

      throw new Error(`Ollama ${res.status}: ${message}`);
    }

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
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          if (json?.response) yield json.response;
          if (json?.done) return;
        } catch {
          // If Ollama sends partial JSON line, keep buffering.
          buffer = `${trimmed}\n${buffer}`;
        }
      }
    }
  }
}

export default BrainSwitch;

