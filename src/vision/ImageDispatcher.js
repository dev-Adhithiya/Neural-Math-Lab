/**
 * ImageDispatcher — classify + route uploaded images.
 *
 * Classification model: Ollama `minicpm-v`
 * URL: /api/proxy/ollama/chat
 *
 * Returns one of:
 * - ERROR_NO_MATH
 * - TYPE_SUBMISSION (completed problem / handwritten solution)
 * - TYPE_DOUBT (single question / doubt)
 */

import { getDefaultOllamaProxyUrl } from '../config/api.js';

const OLLAMA_GENERATE_URL = getDefaultOllamaProxyUrl();
export const IMAGE_CLASSIFIER_MODEL = 'minicpm-v';

export const CLASSIFIER_PROMPT = `Analyze this image. If it contains NO math, return 'ERROR_NO_MATH'. If it is a completed problem, return 'TYPE_SUBMISSION'. If it is a single question, return 'TYPE_DOUBT'.`;

export const VISION_SYSTEM_PROMPT = `You are a strict image classifier for a math tutoring app.

OUTPUT RULES (STRICT):
- Output ONLY ONE token: ERROR_NO_MATH, TYPE_SUBMISSION, or TYPE_DOUBT
- No punctuation, no explanation, no extra words.

CLASSIFICATION GUIDANCE:
- ERROR_NO_MATH: no equations, no math symbols, no math text, no graph, no worksheet.
- TYPE_SUBMISSION: worked steps, final answer, or a full solution attempt.
- TYPE_DOUBT: a single question or prompt without a full attempt.`;

export const CLASSIFIER_JSON_PROMPT = `Return ONLY valid JSON in this exact shape:
{"label":"ERROR_NO_MATH|TYPE_SUBMISSION|TYPE_DOUBT"}

No other keys. No explanation.`;

export const VISION_REQUEST_PROMPT = `Act as an expert math examiner and explicitly transcribe the math problem in this image.
- State exactly what the math is (e.g., "This is a word problem about...", "This is a raw formula...", "This is a student's step-by-step solution").
- Extract the exact text, numbers, and formulas involved.
- If it is an equation or formula, write it out perfectly.
Output the full context as a clear string of text.`;

export const OCR_STRICT_TRANSCRIBE_PROMPT = `You are an OCR engine for math screenshots and handwritten work.
Return ONLY the visible text and math expressions from the image, line by line.
Rules:
- Do not explain, classify, or summarize.
- Keep equations exactly as written.
- If a symbol is uncertain, keep the rest and use ? for the uncertain symbol.
- Never answer with refusal text unless nothing is visible.
- If absolutely nothing is readable, return exactly: UNREADABLE`;

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const OCR_LOW_CONFIDENCE_MARKERS = [
  'error_no_content',
  'unclear',
  'unreadable',
  'unable to transcribe',
  'cannot transcribe',
  "can't transcribe",
  'unable to read',
  'cannot read',
  "can't read",
  'could not read',
  'not readable',
  'not clearly visible',
  'too blurry',
  'low resolution',
  'image quality',
  'only available online',
  'please reconnect',
];

export function isLowConfidenceOcrText(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return OCR_LOW_CONFIDENCE_MARKERS.some((marker) => text.includes(marker));
}

export async function preprocessForOcr(imageBlob, options = {}) {
  const {
    maxSize = 1024,
    contrast = 1.18,
    sharpen = true,
    outputMime = 'image/jpeg',
    outputQuality = 0.92,
  } = options || {};

  // 1. Load image and optionally downscale large images
  const bmp = await createImageBitmap(imageBlob);
  const MAX_SIZE = Math.max(256, Number(maxSize) || 1024);
  let width = bmp.width;
  let height = bmp.height;

  if (width > MAX_SIZE || height > MAX_SIZE) {
    const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  // Draw scaled image
  ctx.drawImage(bmp, 0, 0, width, height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;

  // Contrast boost
  const contrastValue = Number(contrast);
  const contrastScale = Number.isFinite(contrastValue) ? contrastValue : 1.18;
  const intercept = 128 * (1 - contrastScale);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, data[i] * contrastScale + intercept));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * contrastScale + intercept));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * contrastScale + intercept));
  }

  if (sharpen) {
    // Sharpen kernel helps on blurry handwriting; can hurt clean screenshots, so it is optional.
    const w = canvas.width;
    const h = canvas.height;
    const src = new Uint8ClampedArray(data);
    const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];

    const idx = (x, y) => (y * w + x) * 4;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const out = [0, 0, 0];
        let ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const p = idx(x + kx, y + ky);
            const kv = k[ki++];
            out[0] += src[p] * kv;
            out[1] += src[p + 1] * kv;
            out[2] += src[p + 2] * kv;
          }
        }
        const p0 = idx(x, y);
        data[p0] = Math.max(0, Math.min(255, out[0]));
        data[p0 + 1] = Math.max(0, Math.min(255, out[1]));
        data[p0 + 2] = Math.max(0, Math.min(255, out[2]));
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, outputQuality));
  return blob || imageBlob;
}

function normalizeClass(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (t.includes('ERROR_NO_MATH')) return 'ERROR_NO_MATH';
  if (t.includes('TYPE_SUBMISSION')) return 'TYPE_SUBMISSION';
  if (t.includes('TYPE_DOUBT')) return 'TYPE_DOUBT';
  // Heuristic fallbacks (moondream can be chatty)
  if (t.includes('SUBMISSION') || t.includes('SOLUTION') || t.includes('WORKED') || t.includes('ANSWER')) return 'TYPE_SUBMISSION';
  if (t.includes('QUESTION') || t.includes('ASK') || t.includes('DOUBT') || t.includes('?')) return 'TYPE_DOUBT';
  return null;
}

export async function bridgeToPhi3(extractedText, { ollamaUrl = OLLAMA_GENERATE_URL, model = 'qwen2.5-math' } = {}) {
  const prompt = `Based on this extracted text from a photo, determine the math topic and ask the user a Socratic question to help them start solving it.

RULES:
- ONE concept at a time.
- End with exactly ONE simple question.
- Use $...$ or $$...$$ for any math.

EXTRACTED TEXT:
${extractedText}`.trim();

  const res = await fetch(ollamaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.4,
        num_gpu: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama phi3 ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return String(json?.response || '').trim();
}

export async function classifyImageWithMoondream(imageBlob, { ollamaUrl = OLLAMA_GENERATE_URL } = {}) {
  const b64 = await blobToBase64(imageBlob);
  const res = await fetch(ollamaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_CLASSIFIER_MODEL,
      prompt: `${VISION_SYSTEM_PROMPT}\n\n${CLASSIFIER_PROMPT}\n\n${CLASSIFIER_JSON_PROMPT}`,
      stream: false,
      images: [b64],
      options: {
        temperature: 0,
        num_gpu: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama vision ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const raw = String(json?.response || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const cls = normalizeClass(parsed?.label || '');
      if (cls) return cls;
    } catch {
      // ignore
    }
  }
  // Final fallback: attempt freeform normalization, else default to DOUBT (never hard-fail).
  return normalizeClass(raw) || 'TYPE_DOUBT';
}

export async function extractMathWithMoondream(imageBlob, { ollamaUrl = OLLAMA_GENERATE_URL, prompt = VISION_REQUEST_PROMPT } = {}) {
  const b64 = await blobToBase64(imageBlob);
  const res = await fetch(ollamaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_CLASSIFIER_MODEL,
      prompt,
      stream: false,
      images: [b64],
      options: {
        temperature: 0,
        num_gpu: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama OCR ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return { text: String(json?.response || '').trim(), raw: json };
}

export async function extractMathWithRetries(imageBlob, { ollamaUrl = OLLAMA_GENERATE_URL } = {}) {
  const attempts = [];
  let fallbackText = '';
  let fallbackRaw = null;
  let fallbackSource = 'none';

  const runAttempt = async (label, blobFactory, prompt) => {
    try {
      const candidateBlob = await blobFactory();
      const extracted = await extractMathWithMoondream(candidateBlob, { ollamaUrl, prompt });
      const text = String(extracted?.text || '').trim();
      const lowConfidence = isLowConfidenceOcrText(text);

      attempts.push({
        label,
        promptMode: prompt === OCR_STRICT_TRANSCRIBE_PROMPT ? 'strict-transcribe' : 'legacy-transcribe',
        text,
        lowConfidence,
      });

      if (!fallbackText && text) {
        fallbackText = text;
        fallbackRaw = extracted?.raw || null;
        fallbackSource = label;
      }

      if (text && !lowConfidence) {
        return {
          text,
          raw: extracted?.raw || null,
          source: label,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        label,
        promptMode: prompt === OCR_STRICT_TRANSCRIBE_PROMPT ? 'strict-transcribe' : 'legacy-transcribe',
        text: '',
        lowConfidence: true,
        error: String(error?.message || error || 'OCR attempt failed'),
      });
    }

    return null;
  };

  const attemptOrder = [
    {
      label: 'original',
      prompt: OCR_STRICT_TRANSCRIBE_PROMPT,
      buildBlob: async () => imageBlob,
    },
    {
      label: 'original-legacy',
      prompt: VISION_REQUEST_PROMPT,
      buildBlob: async () => imageBlob,
    },
    {
      label: 'preprocess-soft',
      prompt: OCR_STRICT_TRANSCRIBE_PROMPT,
      buildBlob: async () => preprocessForOcr(imageBlob, {
        contrast: 1.06,
        sharpen: false,
        outputMime: 'image/png',
      }),
    },
    {
      label: 'preprocess-strong',
      prompt: OCR_STRICT_TRANSCRIBE_PROMPT,
      buildBlob: async () => preprocessForOcr(imageBlob),
    },
    {
      label: 'preprocess-strong-legacy',
      prompt: VISION_REQUEST_PROMPT,
      buildBlob: async () => preprocessForOcr(imageBlob),
    },
  ];

  for (const attempt of attemptOrder) {
    const ok = await runAttempt(attempt.label, attempt.buildBlob, attempt.prompt);
    if (ok) return ok;
  }

  return {
    text: fallbackText,
    raw: fallbackRaw,
    source: fallbackSource,
    attempts,
  };
}

export function getLastMessageType(chatMessages = []) {
  const last = [...chatMessages].reverse().find((m) => m?.role === 'assistant' || m?.role === 'user');
  const text = String(last?.content || '').toLowerCase();
  if (text.includes('mcq') || text.includes('submit quiz') || text.includes('quiz')) return 'quiz';
  if (text.includes('hint') || text.includes('try again') || text.includes('guiding question')) return 'socratic';
  return 'general';
}

/**
 * Dispatch logic.
 * @param {File|Blob} imageBlob
 * @param {Object} ctx
 * @param {Array<{role:string, content:string}>} ctx.chatMessages
 * @param {Function} ctx.onNoMath
 * @param {Function} ctx.onSubmission
 * @param {Function} ctx.onDoubt
 */
export async function dispatchImage(imageBlob, ctx) {
  const cls = await classifyImageWithMoondream(imageBlob, ctx?.ollama || {});
  if (cls === 'ERROR_NO_MATH') {
    await ctx?.onNoMath?.();
    return { classification: cls, action: 'toast' };
  }

  const lastType = getLastMessageType(ctx?.chatMessages || []);

  if (cls === 'TYPE_SUBMISSION') {
    await ctx?.onSubmission?.({ imageBlob, lastType });
    return { classification: cls, action: 'submission', lastType };
  }

  await ctx?.onDoubt?.({ imageBlob, lastType });
  return { classification: cls, action: 'doubt', lastType };
}

