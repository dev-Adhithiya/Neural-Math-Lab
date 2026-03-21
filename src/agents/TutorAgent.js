/**
 * @module TutorAgent
 * @description Main AI brain — Socratic persona with Teaching & Solver modes.
 *
 * Reason-Act-Observe:
 *   REASON  → Inspect mode + topic + user history to build system prompt
 *   ACT     → Stream tokens through the AI provider
 *   OBSERVE → Parse response for math content, hints, grading triggers
 *
 * SocraticStreamer Rule:
 *   In TEACHING mode the tutor NEVER gives the answer directly.
 *   It uses DynamicGrader marks to give feedback like:
 *     "Great logic! You got 8/10. Look at your arithmetic in step 2."
 */
const SYSTEM_PROMPTS = {
  TEACHING: `You are a Socratic math tutor. Your goal is to TEACH and EXPLAIN concepts step by step.

IMPORTANT: include a clear 'Thought Process:' section in every response, showing your reasoning chain in step-by-step form. Finish with a short 'Answer:' section.

RULES (follow exactly, output nothing else):
- FIRST: Explain the concept, key formula, or approach (2-3 sentences of teaching).
- THEN: Ask exactly ONE guiding question to help the student apply what you just taught.
- Do NOT ask questions before teaching.
- Do NOT write scenario planning, role-play, or show alternative options.
- Use $...$ for inline math and $$...$$ for block equations.

When you receive image content:
- If you can read it: explain the concept shown, then ask a guiding question.
- If unclear: politely ask the student to describe or retake the photo.`,


  SOLVER: `You are Neural Math Lab's Math Solver — precise, efficient, and thorough.

IMPORTANT: include a 'Thought Process:' section with an explicit reasoning chain, then a concise 'Answer:' summary.

RULES:
1. Provide the COMPLETE solution with all steps shown clearly.
2. Use LaTeX notation for ALL math: wrap inline math in $...$ and display math in $$...$$.
3. After the solution, provide 2 similar practice problems for the student.
4. When showing functions or geometric concepts, include: [GRAPH: f(x) = expression] for automatic visualization.
5. Highlight key formulas and theorems used.
6. Keep explanations clear but comprehensive.`,

};

function sanitizeTutorOutput(raw) {
  let text = String(raw || '').trim();

  // ── 1. Keep user-facing response content and preserve explicit thought traces.
  // We no longer aggressively strip model-style planning fragments so students can see chain-of-thought.

  // ── 2. Collapse blank lines, cap at 4 paragraphs for readability ──
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  text = paras.slice(0, 4).join('\n\n').trim();

  if (!text) return 'Could you describe the problem in your own words so I can help you?';

  // ── 4. Ensure response ends with exactly one question ──
  const endsWithQ = /\?\s*$/.test(text);
  if (!endsWithQ) {
    text = `${text}\n\nWhat would you like to try first?`;
  } else {
    // Multiple questions → keep only the last to avoid confusing the student
    const qs = text.match(/[^?]*\?/g);
    if (qs && qs.length > 1) {
      text = `${paras.slice(0, 2).join('\n\n')}\n\n${qs[qs.length - 1].trim()}`.trim();
    }
  }

  return text;
}

/**
 * @typedef {'TEACHING'|'SOLVER'} TutorMode
 */

export class TutorAgent {
  /**
   * @param {Object} deps
   * @param {Function} deps.streamChat - from useAI hook
   * @param {Function} [deps.analyzeImage]
   */
  constructor({ streamChat, analyzeImage }) {
    this.streamChat = streamChat;
    this.analyzeImage = analyzeImage;
    this.mode = 'TEACHING';
    this.conversationHistory = [];
  }

  /** Switch between TEACHING and SOLVER modes. */
  setMode(mode) {
    this.mode = mode;
  }

  /**
   * Build the message array with system prompt, grading context, and conversation history.
   * @param {string} userMessage
   * @param {Object} [context]
   * @param {string} [context.studentName]
   * @param {string} [context.topicId]
   * @param {Object} [context.gradingResult] - From GraderAgent
   * @param {Array}  [context.previousMistakes]
   * @returns {Array<{role:string, content:string}>}
   */
  _buildMessages(userMessage, context = {}) {
    let systemPrompt = SYSTEM_PROMPTS[this.mode];

    // Inject student name
    if (context.studentName) {
      systemPrompt += `\n\nThe student's name is "${context.studentName}". Use this exact spelling and do not change it.`;
    }

    // Inject current topic
    if (context.topicId) {
      systemPrompt += `\n\nCurrent topic: ${context.topicId}. Stay focused on this topic.`;
    }

    // Inject grading results for Socratic feedback
    if (context.gradingResult) {
      const gr = context.gradingResult;
      systemPrompt += `\n\n--- GRADING CONTEXT (use this for feedback, do NOT reveal raw data) ---
Student scored: ${gr.score}/${gr.maxScore}
Step results: ${JSON.stringify(gr.stepResults)}
Overall feedback areas: ${gr.feedback || 'None'}
--- Use this to give encouraging, specific feedback about their work. ---`;
    }

    // Inject previous mistakes for personalized teaching
    if (context.previousMistakes?.length > 0) {
      const mistakesSummary = context.previousMistakes
        .slice(0, 5)
        .map((m) => `• ${m.description} (${m.topicId})`)
        .join('\n');
      systemPrompt += `\n\n--- KNOWN WEAK AREAS (address gently) ---\n${mistakesSummary}`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: userMessage },
    ];

    return messages;
  }

  /**
   * Send a message and stream the response.
   * @param {string} userMessage
   * @param {Object} context
   * @param {Object} callbacks
   * @param {Function} callbacks.onToken
   * @param {Function} [callbacks.onDone]
   * @param {Function} [callbacks.onError]
   * @param {Function} [callbacks.onGraphDetected] - Called with equation when [GRAPH:...] is found
   * @returns {Promise<string>}
   */
  async chat(userMessage, context = {}, callbacks = {}) {
    const messages = this._buildMessages(userMessage, context);

    // Track conversation
    this.conversationHistory.push({ role: 'user', content: userMessage });

    let fullResponse = '';

    const response = await this.streamChat(messages, {
      preferLocal: true,
      onToken: (token) => {
        fullResponse += token;
        callbacks.onToken?.(token);

        // Detect graph commands in the stream
        const graphMatch = fullResponse.match(/\[GRAPH:\s*([^\]]+)\]/);
        if (graphMatch && !this._lastGraphMatch) {
          this._lastGraphMatch = graphMatch[1];
          callbacks.onGraphDetected?.(graphMatch[1].trim());
        }
      },
      onDone: (text) => {
        const clean = sanitizeTutorOutput(text);
        this.conversationHistory.push({ role: 'assistant', content: clean });
        // Keep history manageable — last 20 turns
        if (this.conversationHistory.length > 40) {
          this.conversationHistory = this.conversationHistory.slice(-40);
        }
        this._lastGraphMatch = null;
        callbacks.onDone?.(clean);
      },
      onError: callbacks.onError,
      temperature: this.mode === 'TEACHING' ? 0.8 : 0.4,
      maxTokens: 2048,
    });

    return response;
  }

  /** Clear conversation history (new session). */
  resetConversation() {
    this.conversationHistory = [];
    this._lastGraphMatch = null;
  }

  /**
   * Replace conversation history with already-rendered chat messages.
   * Excludes system messages; keeps only user/assistant roles.
   * @param {Array<{role:string, content:string}>} msgs
   */
  setConversationHistory(msgs = []) {
    this.conversationHistory = (msgs || [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .slice(-40)
      .map((m) => ({ role: m.role, content: String(m.content || '') }));
    this._lastGraphMatch = null;
  }
}

/**
 * Generate a greeting message for the chat assistant.
 * @param {string} studentName
 * @returns {string}
 */
export function generateGreeting(studentName) {
  return `👋 Hello, **${studentName}**! I'm your Neural Math Lab tutor — think of me as your Senior Mathematics Teacher.

Here's how I can help you today:

🗓️ **Plan your session** — I'll analyze your progress and suggest a personalized learning path based on your strengths and areas to improve.

📚 **Learn a topic** — Pick any math topic and I'll guide you through it step-by-step using the Socratic method.

🔗 **Check prerequisites** — Wondering what you need before tackling Calculus? I'll map out the path for you.

📷 **Check your work** — Upload a photo of your handwritten math and I'll help you find and fix mistakes.

🏆 **Take a quiz** — Test your knowledge and earn XP!

What would you like to do? 😊`;
}

export default TutorAgent;
