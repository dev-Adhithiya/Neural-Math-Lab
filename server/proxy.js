import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import ResponseCache from './responseCache.js';
import { INFERENCE_PROFILES, selectInferenceProfile, getOptimizedSystemPrompt, formatOptimizedPrompt } from './inferenceOptimization.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PROXY_PORT || 8787);
const STRICT_MODE_DEFAULT = String(process.env.STRICT_MODE || 'true').toLowerCase() === 'true';
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || '').trim();

// Initialize response cache (500 entries, 1-hour TTL)
const responseCache = new ResponseCache(500, 3600000);

const allowedOrigins = CORS_ORIGIN
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOptions = allowedOrigins.length === 0 || allowedOrigins.includes('*')
  ? {}
  : { origin: allowedOrigins };

app.use(cors(corsOptions));
app.use(express.json({ limit: '30mb' }));

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

const SAFETY_RE = {
  violence: /(kill|bomb|weapon|attack|harm\s+someone)/i,
  self_harm: /(suicide|self-harm|kill myself|cut myself)/i,
  hate: /(racial slur|hate\s+\w+\s+people|nazi)/i,
  sexual: /(explicit sex|sexual content with minor|child porn)/i,
  cyber_abuse: /(credit card cvv|steal password|phishing|bypass auth)/i,
};

function detectSafetyCategories(text) {
  if (!text) return [];
  const out = [];
  if (SAFETY_RE.violence.test(text)) out.push('violence');
  if (SAFETY_RE.self_harm.test(text)) out.push('self_harm');
  if (SAFETY_RE.hate.test(text)) out.push('hate');
  if (SAFETY_RE.sexual.test(text)) out.push('sexual');
  if (SAFETY_RE.cyber_abuse.test(text)) out.push('cyber_abuse');
  return out;
}

const PROMPT_INJECTION_MARKERS = [
  'ignore previous instructions',
  'reveal system prompt',
  'developer message',
  'jailbreak',
  'pretend to be',
  'bypass safety',
  'show chain of thought',
  'exfiltrate',
];

function detectPromptInjection(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  for (let i = 0; i < PROMPT_INJECTION_MARKERS.length; i++) {
    if (lower.indexOf(PROMPT_INJECTION_MARKERS[i]) !== -1) return true;
  }
  return false;
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
  const rawImages = Array.isArray(req.body?.images)
    ? req.body.images.filter((img) => typeof img === 'string' && img.trim().length > 0)
    : [];
  const hasImages = rawImages.length > 0;
  const canUsePromptCache = !hasImages;

  try {
    // ========== OPTIMIZATION 1: Check response cache ==========
    const cachedResponse = canUsePromptCache ? responseCache.get(userPrompt) : null;
    if (canUsePromptCache && cachedResponse) {
      const cacheData = {
        model: req.body?.model || process.env.OLLAMA_MODEL || 'deepseek-r1:7b',
        response: cachedResponse,
        cached: true,
        eval_count: 0,
        load_duration: 0,
        prompt_eval_count: 0,
        prompt_eval_duration: 0,
        eval_duration: 0,
        done: true
      };
      res.set('X-Cache', 'HIT');
      if (req.body?.stream !== false) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.write(JSON.stringify(cacheData) + '\n');
        return res.end();
      }
      return res.json(cacheData);
    }

    // ========== OPTIMIZATION 2: Select inference profile ==========
    const profile = hasImages ? 'vision-pass-through' : selectInferenceProfile(userPrompt);
    const inferenceOptions = hasImages
      ? null
      : (INFERENCE_PROFILES[profile] || INFERENCE_PROFILES.balanced);

    // ========== OPTIMIZATION 3: Get optimized system prompt ==========
    const systemPrompt = hasImages ? '' : getOptimizedSystemPrompt(profile);
    const optimizedUser = hasImages ? userPrompt : formatOptimizedPrompt(userPrompt, profile);
    const modelStr = req.body?.model || process.env.OLLAMA_MODEL || 'deepseek-r1:7b';

    let body;
    if (hasImages) {
      // Vision calls must preserve the original prompt and carry image payloads through untouched.
      body = {
        model: modelStr,
        prompt: userPrompt,
        stream: req.body?.stream !== false,
        keep_alive: req.body?.keep_alive || '10m',
        images: rawImages,
        options: {
          temperature: 0,
          num_gpu: 1,
          ...req.body?.options,
        },
      };
    } else {
      let formattedPrompt = `${systemPrompt}\n\nUser: ${optimizedUser}`;
      let isRaw = false;

      // We no longer bypass CoT for deepseek-r1 because it needs space to think,
      // and bypassing it causes hallucinations/cutoffs.
      if (modelStr.includes('deepseek-r1') && profile === 'ultra-fast-disabled') {
        isRaw = true;
        formattedPrompt = `<｜begin of sentence｜>${systemPrompt}<｜User｜>${optimizedUser}<｜Assistant｜><think>\n</think>\n`;
      }

      body = {
        model: modelStr,
        system: isRaw ? undefined : systemPrompt,
        prompt: formattedPrompt,
        raw: isRaw,
        stream: req.body?.stream !== false,
        keep_alive: req.body?.keep_alive || '10m',
        options: {
          ...inferenceOptions,
          ...req.body?.options,  // Allow client overrides
        },
      };
    }

    // ========== OPTIMIZATION 4: Add request timeout ==========
    const controller = new AbortController();
    const timeoutMs = req.body?.timeout || 300000;  // 5m timeout to allow deepseek-r1 to finish long thoughts
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
      if (canUsePromptCache && data?.response) {
        responseCache.set(userPrompt, data.response);
        data.cached = false;
      }
      return res.json(data);
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Cache', canUsePromptCache ? 'MISS' : 'BYPASS');
    res.setHeader('X-Inference-Profile', profile);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let lastPolicyCheckLength = 0;

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
          
          // Only check policy every 100 characters to prevent O(N^2) CPU burn on streams
          if (accumulated.length - lastPolicyCheckLength > 100 || parsed.done) {
            lastPolicyCheckLength = accumulated.length;
            const outPolicy = evaluatePolicy(accumulated, Boolean(req.body?.strictMode ?? STRICT_MODE_DEFAULT));
            if (outPolicy.blocked) {
              const blockedChunk = {
                model: body.model,
                response: '\n\n[Blocked by safety policy]\n',
                done: true,
              };
              res.write(`${JSON.stringify(blockedChunk)}\n`);
              if (canUsePromptCache) {
                responseCache.set(userPrompt, '[Blocked by safety policy]');  // Cache blocked response too
              }
              return res.end();
            }
          }
        }

        res.write(`${JSON.stringify(parsed)}\n`);
      }
    }

    // ========== Cache final response after completion ==========
    if (canUsePromptCache && accumulated) {
      responseCache.set(userPrompt, accumulated);
    }

    res.end();
  } catch (err) {
    const isTimeout = err?.name === 'AbortError';
    const statusCode = isTimeout ? 504 : 500;
    const errorMsg = isTimeout ? 'Inference timeout (>5m)' : err?.message || 'Ollama proxy failure';
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
  console.log(`[proxy] cors origins: ${allowedOrigins.length === 0 || allowedOrigins.includes('*') ? 'allow-all' : allowedOrigins.join(', ')}`);
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
