/**
 * @module VisionModule
 * @description Handwriting OCR → LaTeX pipeline.
 *
 * Reason-Act-Observe:
 *   REASON  → Determine available provider (Azure GPT-4o Vision / Gemini / Mathpix)
 *   ACT     → Send image to vision endpoint with math-specific prompt
 *   OBSERVE → Return extracted LaTeX string
 */

/**
 * Process a handwritten math image and extract LaTeX.
 *
 * @param {Blob|File} imageBlob
 * @param {Object} deps
 * @param {Function} deps.analyzeImage - From useAI hook
 * @returns {Promise<{latex: string, confidence: string, steps: string[]}>}
 */
export async function processHandwriting(imageBlob, { analyzeImage }) {
  const base64 = await blobToBase64(imageBlob);

  const prompt = `You are an expert math OCR system. Analyze this handwritten math image and extract:

1. The mathematical expression(s) or equation(s) in LaTeX format.
2. The exact word problem text, if present.
3. If there are multiple steps, list each step separately.
4. Provide a clear description stating EXACTLY what the image contains (e.g., "A word problem about calculating interest", "A raw quadratic equation", or "A student's attempted solution to a geometry problem").

Respond ONLY in this JSON format:
{
  "latex": "The full expression in LaTeX (e.g., \\\\frac{x^2 + 3x}{2} = 5)",
  "steps": ["step 1 in LaTeX", "step 2 in LaTeX"],
  "confidence": "high|medium|low",
  "description": "Brief description in plain English"
}`;

  try {
    const result = await analyzeImage(base64, prompt);
    const lowLevelMessage = String(result || '');
    if (lowLevelMessage.toLowerCase().includes('image ocr is only available online')) {
      throw new Error('Image OCR is only available online. Please switch to Online mode and try again.');
    }

    // Try to parse JSON from the response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const latex = parsed.latex || '';

      return {
        latex: latex || result,
        steps: parsed.steps || [],
        confidence: parsed.confidence || 'medium',
        description: parsed.description || '',
        raw: result,
      };
    }

    // Fallback: treat entire response as LaTeX
    return {
      latex: result,
      steps: [],
      confidence: 'low',
      description: '',
      raw: result,
    };
  } catch (error) {
    console.error('[VisionModule] OCR failed:', error);
    throw new Error(`OCR processing failed: ${error.message}`);
  }
}

/**
 * Process an image using Mathpix API (alternative).
 * @param {Blob|File} imageBlob
 * @returns {Promise<{latex: string}>}
 */
export async function processWithMathpix(imageBlob) {
  const appId = import.meta.env.VITE_MATHPIX_APP_ID;
  const appKey = import.meta.env.VITE_MATHPIX_APP_KEY;

  if (!appId || !appKey) {
    throw new Error('Mathpix API credentials not configured.');
  }

  const base64 = await blobToBase64(imageBlob);

  const res = await fetch('https://api.mathpix.com/v3/text', {
    method: 'POST',
    headers: {
      'app_id': appId,
      'app_key': appKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      src: `data:image/jpeg;base64,${base64}`,
      formats: ['latex_styled'],
      data_options: { include_asciimath: true },
    }),
  });

  const data = await res.json();
  return {
    latex: data.latex_styled || data.text || '',
    confidence: data.confidence ? (data.confidence > 0.9 ? 'high' : 'medium') : 'low',
    steps: [],
    raw: data,
  };
}

/* ────────────────── Utilities ────────────────────────────── */

/**
 * Convert Blob/File to base64 string (without data: prefix).
 * @param {Blob|File} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      // Strip the data:*;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Validate if a string contains valid LaTeX math.
 * @param {string} latex
 * @returns {boolean}
 */
export function isValidLatex(latex) {
  if (!latex || latex.trim().length === 0) return false;
  // Basic validation: check for common LaTeX patterns
  const mathPatterns = /[\\{}^_]|[0-9]+|[a-zA-Z]+/;
  return mathPatterns.test(latex);
}

function isMathLikeLatex(latex) {
  if (!latex || latex.trim().length === 0) return false;
  const s = latex.trim();
  const hasMathGlyph = /[=+\-*/^_()]/.test(s);
  const hasDigit = /\d/.test(s);
  const hasFracOrRoot = /\\frac|\\sqrt|\\sum|\\int|\\pi|\\theta/.test(s);
  return hasMathGlyph || hasDigit || hasFracOrRoot;
}

export default { processHandwriting, processWithMathpix, isValidLatex };
