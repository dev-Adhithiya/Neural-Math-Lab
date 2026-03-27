import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import ResponseCache from './responseCache.js';
import { INFERENCE_PROFILES, selectInferenceProfile, getOptimizedSystemPrompt, formatOptimizedPrompt } from './inferenceOptimization.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PROXY_PORT || 8787);
const STRICT_MODE_DEFAULT = String(process.env.STRICT_MODE || 'true').toLowerCase() === 'true';

// Initialize response cache (500 entries, 1-hour TTL)
const responseCache = new ResponseCache(500, 3600000);

app.use(cors());
app.use(express.json({ limit: '8mb' }));

function extractText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((x) => extractText(x)).join(' ');
  if (typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.content) return extractText(value.content);
  }
  return '';
}

function detectSafetyCategories(text) {
  const t = String(text || '').toLowerCase();
  const out = [];
  if (/(kill|bomb|weapon|attack|harm\s+someone)/i.test(t)) out.push('violence');
  if (/(suicide|self-harm|kill myself|cut myself)/i.test(t)) out.push('self_harm');
  if (/(racial slur|hate\s+\w+\s+people|nazi)/i.test(t)) out.push('hate');
  if (/(explicit sex|sexual content with minor|child porn)/i.test(t)) out.push('sexual');
  if (/(credit card cvv|steal password|phishing|bypass auth)/i.test(t)) out.push('cyber_abuse');
  return out;
}

function detectPromptInjection(text) {
  const t = String(text || '').toLowerCase();
  const markers = [
    'ignore previous instructions',
    'reveal system prompt',
    'developer message',
    'jailbreak',
    'pretend to be',
    'bypass safety',
    'show chain of thought',
    'exfiltrate',
  ];
  return markers.some((m) => t.includes(m));
}

function evaluatePolicy(text, strictMode) {
  const categories = detectSafetyCategories(text);
  const injection = detectPromptInjection(text);

  const blocked = strictMode && (injection || categories.length > 0);
  return {
    blocked,
    injection,
    categories,
    strictMode,
  };
}

function policyMessage(result, stage = 'request') {
  const details = [];
  if (result.injection) details.push('prompt_injection');
  details.push(...result.categories);
  const list = details.length > 0 ? details.join(', ') : 'policy_violation';
  return {
    error: `Blocked by policy at ${stage}.`,
    categories: list,
    strictMode: result.strictMode,
  };
}

function policyGuard(req, res, next) {
  const strictMode = req.body?.strictMode ?? STRICT_MODE_DEFAULT;
  const text = [
    req.body?.prompt,
    extractText(req.body?.messages),
    req.body?.query,
  ].filter(Boolean).join('\n');

  const result = evaluatePolicy(text, Boolean(strictMode));
  req.policy = result;

  if (result.blocked) {
    return res.status(400).json(policyMessage(result, 'input'));
  }

  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, strictModeDefault: STRICT_MODE_DEFAULT });
});

// ========== Cache Management Endpoints ==========

app.get('/api/cache/stats', (_req, res) => {
  const stats = responseCache.getStats();
  res.json({
    ...stats,
    hitRate: `~${((stats.size / stats.maxSize) * 100).toFixed(1)}% utilization`,
  });
});

app.delete('/api/cache/clear', (_req, res) => {
  responseCache.clear();
  res.json({ success: true, message: 'Response cache cleared' });
});

app.get('/api/cache/entries', (_req, res) => {
  const stats = responseCache.getStats();
  res.json({
    count: stats.entries.length,
    entries: stats.entries.slice(0, 20), // Show most recent 20
  });
});

// ========== Inference Optimization Endpoint ==========

app.get('/api/inference/profiles', (_req, res) => {
  res.json({
    available_profiles: Object.keys(INFERENCE_PROFILES),
    profiles: INFERENCE_PROFILES,
    description: 'Use selectInferenceProfile(prompt) to auto-select based on complexity',
  });
});

app.post('/api/proxy/rag/search', policyGuard, async (req, res) => {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_KEY;
  const index = process.env.AZURE_SEARCH_INDEX;

  if (!endpoint || !apiKey || !index) {
    return res.status(500).json({ error: 'Azure Search env vars are missing on proxy server.' });
  }

  try {
    const query = String(req.body?.query || '');
    const top = Number(req.body?.top || 4);
    const url = `${endpoint.replace(/\/+$/, '')}/indexes/${encodeURIComponent(index)}/docs/search?api-version=2023-11-01`;

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({ search: query, top, queryType: 'simple' }),
    });

    const json = await r.json();
    if (!r.ok) return res.status(r.status).json(json);
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'RAG proxy failure' });
  }
});

app.post('/api/proxy/ollama/chat', policyGuard, async (req, res) => {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
  const userPrompt = req.body?.prompt || '';

  try {
    // ========== OPTIMIZATION 1: Check response cache ==========
    const cachedResponse = responseCache.get(userPrompt);
    if (cachedResponse) {
      const cacheData = {
        model: req.body?.model || process.env.OLLAMA_MODEL || 'deepseek-r1:7b',
        response: cachedResponse,
        cached: true,
        eval_count: 0,
        load_duration: 0,
        prompt_eval_count: 0,
        prompt_eval_duration: 0,
        eval_duration: 0,
      };
      res.set('X-Cache', 'HIT');
      return res.json(cacheData);
    }

    // ========== OPTIMIZATION 2: Select inference profile ==========
    const profile = selectInferenceProfile(userPrompt);
    const inferenceOptions = INFERENCE_PROFILES[profile] || INFERENCE_PROFILES.balanced;
    
    // ========== OPTIMIZATION 3: Get optimized system prompt ==========
    const systemPrompt = getOptimizedSystemPrompt(profile);
    const formattedPrompt = `${systemPrompt}\n\nUser: ${formatOptimizedPrompt(userPrompt, profile)}`;

    const body = {
      model: req.body?.model || process.env.OLLAMA_MODEL || 'deepseek-r1:7b',
      prompt: formattedPrompt,
      stream: req.body?.stream !== false,
      keep_alive: req.body?.keep_alive || '10m',
      options: {
        ...inferenceOptions,
        ...req.body?.options,  // Allow client overrides
      },
    };

    // ========== OPTIMIZATION 4: Add request timeout ==========
    const controller = new AbortController();
    const timeoutMs = req.body?.timeout || 25000;  // 25s timeout (instead of waiting forever)
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const r = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).send(txt);
    }

    if (!body.stream) {
      const data = await r.json();
      const outPolicy = evaluatePolicy(data?.response || '', Boolean(req.body?.strictMode ?? STRICT_MODE_DEFAULT));
      if (outPolicy.blocked) return res.status(400).json(policyMessage(outPolicy, 'output'));
      
      // ========== OPTIMIZATION 5: Cache successful response ==========
      if (data?.response) {
        responseCache.set(userPrompt, data.response);
        data.cached = false;
      }
      return res.json(data);
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Inference-Profile', profile);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (parsed?.response) {
          accumulated += parsed.response;
          const outPolicy = evaluatePolicy(accumulated, Boolean(req.body?.strictMode ?? STRICT_MODE_DEFAULT));
          if (outPolicy.blocked) {
            const blockedChunk = {
              model: body.model,
              response: '\n\n[Blocked by safety policy]\n',
              done: true,
            };
            res.write(`${JSON.stringify(blockedChunk)}\n`);
            responseCache.set(userPrompt, '[Blocked by safety policy]');  // Cache blocked response too
            return res.end();
          }
        }

        res.write(`${JSON.stringify(parsed)}\n`);
      }
    }

    // ========== Cache final response after completion ==========
    if (accumulated) {
      responseCache.set(userPrompt, accumulated);
    }

    res.end();
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    const statusCode = isTimeout ? 504 : 500;
    const errorMsg = isTimeout ? 'Inference timeout (>25s)' : err?.message || 'Ollama proxy failure';
    res.status(statusCode).json({ error: errorMsg, timeout: isTimeout });
  }
});

app.post('/api/proxy/azure/chat', policyGuard, async (req, res) => {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-01';

  if (!endpoint || !apiKey || !deployment) {
    return res.status(500).json({ error: 'Azure OpenAI env vars are missing on proxy server.' });
  }

  try {
    const stream = req.body?.stream !== false;
    const url = `${endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

    const body = {
      messages: req.body?.messages || [],
      stream,
      temperature: req.body?.temperature ?? 0.4,
      max_tokens: req.body?.max_tokens ?? 2048,
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).send(txt);
    }

    if (!stream) {
      const json = await r.json();
      const responseText = json?.choices?.[0]?.message?.content || '';
      const outPolicy = evaluatePolicy(responseText, Boolean(req.body?.strictMode ?? STRICT_MODE_DEFAULT));
      if (outPolicy.blocked) return res.status(400).json(policyMessage(outPolicy, 'output'));
      return res.json(json);
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();

        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const token = parsed?.choices?.[0]?.delta?.content || '';
        if (token) {
          accumulated += token;
          const outPolicy = evaluatePolicy(accumulated, Boolean(req.body?.strictMode ?? STRICT_MODE_DEFAULT));
          if (outPolicy.blocked) {
            const blocked = {
              choices: [{ delta: { content: '\n\n[Blocked by safety policy]\n' } }],
            };
            res.write(`data: ${JSON.stringify(blocked)}\n\n`);
            res.write('data: [DONE]\n\n');
            return res.end();
          }
        }

        res.write(`data: ${JSON.stringify(parsed)}\n\n`);
      }
    }

    res.end();
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Azure proxy failure' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[proxy] running on http://localhost:${PORT}`);
  console.log(`[cache] initialized: ${responseCache.getStats().maxSize} entries, 1-hour TTL`);
  console.log(`[optimization] inference profiles enabled: fast/balanced/thorough`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[proxy] SIGTERM received, shutting down gracefully...');
  responseCache.destroy();
  server.close(() => {
    console.log('[proxy] server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[proxy] SIGINT received, shutting down gracefully...');
  responseCache.destroy();
  server.close(() => {
    console.log('[proxy] server closed');
    process.exit(0);
  });
});
