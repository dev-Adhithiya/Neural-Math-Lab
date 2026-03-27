/**
 * Math Tutor AI - Inference Parameter Optimization
 * Reduces model latency while maintaining response quality
 * 
 * Strategy: Aggressive parameter tuning for math domain
 * - Reduced token output
 * - Optimized sampling
 * - Focused prompting
 * - Response streaming
 */

export const INFERENCE_PROFILES = {
  // Fast: Simple questions, 2-3s target
  fast: {
    temperature: 0.3,          // Lower = more deterministic (faster)
    top_p: 0.85,              // Reduce diversity
    top_k: 20,                // Limit vocabulary pool
    min_p: 0.01,              // Kill low-probability tokens early
    repeat_penalty: 1.2,      // Avoid repetition (saves tokens)
    max_tokens: 200,          // Short responses for simple questions
    num_predict: 200,
  },

  // balanced: Medium complexity, 8-10s target
  balanced: {
    temperature: 0.4,
    top_p: 0.9,
    top_k: 40,
    min_p: 0.0,
    repeat_penalty: 1.1,
    max_tokens: 500,
    num_predict: 500,
  },

  // thorough: Complex reasoning (p95), 12-15s target
  thorough: {
    temperature: 0.5,
    top_p: 0.92,
    top_k: 60,
    min_p: 0.0,
    repeat_penalty: 1.05,
    max_tokens: 1200,
    num_predict: 1200,
  },
};

/**
 * Auto-select inference profile based on question complexity heuristic
 */
export function selectInferenceProfile(prompt: string): string {
  const wordCount = prompt.split(/\s+/).length;
  const hasMultiSteps = /step|process|show|derive|prove|explain|why|how/i.test(prompt);
  const isComplex = /integral|derivative|matrix|system.*equation|limit|series|convergence/i.test(prompt);

  if (isComplex && wordCount > 50) return 'thorough';
  if (hasMultiSteps || wordCount > 30) return 'balanced';
  return 'fast';
}

/**
 * Construct optimized system prompt for speed
 */
export function getOptimizedSystemPrompt(profile: string): string {
  const basePrompt = `You are a math tutor. Answer concisely and clearly.
Focus on the core insight needed to solve the problem.
Use standard mathematical notation.
For multi-step problems, number each step.
Be direct - avoid lengthy preambles.`;

  if (profile === 'fast') {
    return `${basePrompt}
Keep responses under 150 words.
Provide only essential steps.`;
  }

  if (profile === 'thorough') {
    return `${basePrompt}
Show all key working steps.
Explain the reasoning at each stage.
Include intermediate results.`;
  }

  return basePrompt;
}

/**
 * Format student question for optimal model inference
 */
export function formatOptimizedPrompt(question: string, profile: string): string {
  // Remove whitespace, normalize formatting
  const clean = question.trim().replace(/\s+/g, ' ');
  
  // For simple questions, add direct instruction
  if (profile === 'fast') {
    return `${clean}\n\nAnswer briefly.`;
  }
  
  return clean;
}

/**
 * Determine optimal model based on available options
 */
export const MODEL_VARIANTS = {
  // Fastest: Smaller parameter models
  fast_models: [
    'deepseek-r1:1.5b',       // ~3s average
    'neural-chat:7b',          // ~2-3s
    'mistral:7b',              // ~2s
  ],
  
  // Balanced: Good speed/quality tradeoff
  balanced_models: [
    'deepseek-r1:7b',          // ~4-8s average
    'llama2:7b',               // ~3-5s
    'neural-chat-v3.1:7b',     // ~3-5s
  ],
  
  // Thorough: Reasoning models (slower, better quality)
  thorough_models: [
    'deepseek-r1:7b',          // ~5-22s (reasoning overhead)
    'openhermes:7b',           // ~5-10s
  ],
};

/**
 * Quantized model versions (4x faster, minimal quality loss)
 */
export const QUANTIZED_MODELS = {
  // Q4_0 = 4-bit quantization (50% VRAM, ~15% speed boost)
  'deepseek-r1:7b-q4_0': 'Q4_0 quantized - 4-5s avg latency',
  'deepseek-r1:7b-q5_0': 'Q5_0 quantized - 3-4s avg latency',
  
  // These variants provide better speed/quality balance
  'mistral:7b-q4_0': 'Mistral Q4 - fast, good math',
  'neural-chat:7b-q4_0': 'Neural Chat Q4 - optimized for tutoring',
};

export default {
  INFERENCE_PROFILES,
  selectInferenceProfile,
  getOptimizedSystemPrompt,
  formatOptimizedPrompt,
  MODEL_VARIANTS,
  QUANTIZED_MODELS,
};
