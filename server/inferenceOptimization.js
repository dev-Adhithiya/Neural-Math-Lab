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
    temperature: 0.6,
    top_p: 0.95,
    top_k: 40,
    min_p: 0.05,
    repeat_penalty: 1.1,
    max_tokens: 8192,
    num_predict: 8192,
    num_ctx: 8192,
  },

  // balanced: Medium complexity, 8-10s target
  balanced: {
    temperature: 0.6,
    top_p: 0.95,
    top_k: 40,
    min_p: 0.05,
    repeat_penalty: 1.1,
    max_tokens: 8192,
    num_predict: 8192,
    num_ctx: 8192,
  },

  // thorough: Complex reasoning (p95), 12-15s target
  thorough: {
    temperature: 0.6,
    top_p: 0.95,
    top_k: 60,
    min_p: 0.05,
    repeat_penalty: 1.1,
    max_tokens: 8192,
    num_predict: 8192,
    num_ctx: 8192,
  },
};

/**
 * Auto-select inference profile based on question complexity heuristic
 */
export function selectInferenceProfile(prompt) {
  // Always prefer thorough as requested: "forget latency, just give full answer"
  return 'thorough';
}

/**
 * Construct optimized system prompt for speed
 */
export function getOptimizedSystemPrompt(profile) {
  const basePrompt = `You are a math tutor. Answer comprehensively and clearly.
Focus on the core insight needed to solve the problem.
Use standard mathematical notation.
For multi-step problems, number each step.`;

  return `${basePrompt}
Show all key working steps.
Explain the reasoning at each stage.
Include intermediate results.`;
}

/**
 * Format student question for optimal model inference
 */
export function formatOptimizedPrompt(question, profile) {
  // Remove whitespace, normalize formatting
  return question.trim().replace(/\s+/g, ' ');
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
