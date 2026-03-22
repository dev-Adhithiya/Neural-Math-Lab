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
  GREETING: `You are a friendly Math Lab Assistant. Your role is to be conversational and helpful, but NOT to teach yet.

IMPORTANT RULE: Do NOT start teaching or explaining math concepts until the user explicitly asks you to teach, explain, or help with a specific topic.

RULES:
- Be warm, encouraging, and professional.
- Ask clarifying questions about what they want to learn.
- Suggest popular topics (Algebra, Geometry, Calculus, Trigonometry, etc.) if they're unsure.
- If they mention a topic they've studied before, acknowledge it and offer to continue.
- Keep responses short and conversational (2-3 sentences max).
- Do NOT provide math explanations, solutions, or teaching yet.
- Wait for the user to clearly request teaching before switching to Tutor mode.

Example good response: "I'd love to help! What math topic are you interested in? Algebra, Geometry, Calculus? Or if you're continuing from before, what were we working on last time?"`,

  TEACHING: `You are a Socratic math tutor. Your goal is to TEACH and EXPLAIN concepts step by step.

IMPORTANT: Do NOT reveal internal chain-of-thought, hidden reasoning, or planning. Provide only the student-facing explanation.

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

IMPORTANT: Do NOT reveal internal chain-of-thought, hidden reasoning, or planning. Show only concise, student-facing solution steps and the final answer.

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

  // Remove hidden reasoning traces that some local models emit.
  text = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/^\s*(thought\s*process|reasoning|internal\s*reasoning)\s*:\s*[\s\S]*?(?=\n\n|$)/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // ── 2. Collapse blank lines, cap at 4 paragraphs for readability ──
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  text = paras.slice(0, 4).join('\n\n').trim();

  if (!text) return 'Could you describe the problem in your own words so I can help you?';

  // Keep response natural; do not force a trailing question.

  return text;
}

/**
 * @typedef {'GREETING'|'TEACHING'|'SOLVER'} TutorMode
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
    this.mode = 'GREETING'; // Start in GREETING mode, not TEACHING
    this.conversationHistory = [];
    this.teachingStarted = false; // Track if user has explicitly requested teaching
    this.currentTopic = null; // Track the current topic being studied
  }

  /** 
   * Switch between GREETING, TEACHING and SOLVER modes.
   * @param {string} mode - 'GREETING' | 'TEACHING' | 'SOLVER'
   */
  setMode(mode) {
    this.mode = mode;
  }

  /**
   * Get the current mode and state.
   * @returns {Object} {mode: string, teachingStarted: boolean, currentTopic: string|null}
   */
  getState() {
    return {
      mode: this.mode,
      teachingStarted: this.teachingStarted,
      currentTopic: this.currentTopic,
    };
  }

  /**
   * Detect if user message contains a request to start teaching.
   * Returns {topic: string|null, shouldTeach: boolean}
   */
  _detectTeachingRequest(userMessage, context = {}) {
    const msg = userMessage.toLowerCase();
    
    // Keywords that indicate user wants to start learning/teaching
    const teachingKeywords = [
      'teach', 'explain', 'learn', 'study', 'help me with', 
      'show me', 'how to', 'how do', 'what is', 'solve',
      'help me solve', 'can you help', 'work through',
      'step by step', 'guide me', 'tutor me', 'walk through'
    ];
    
    const wantToTeach = teachingKeywords.some(kw => msg.includes(kw));
    
    // Try to extract topic from message
    let topic = context.topicId || this.currentTopic;
    
    // Look for topic keywords in the message
    const topicKeywords = {
      'algebra': ['algebra', 'linear equation', 'quadratic', 'polynomial', 'expanding', 'factoring'],
      'geometry': ['geometry', 'triangle', 'circle', 'angle', 'area', 'perimeter', 'volume'],
      'calculus': ['calculus', 'derivative', 'integral', 'limit', 'function', 'differential'],
      'trigonometry': ['trigonometry', 'sine', 'cosine', 'tangent', 'sin', 'cos', 'tan'],
      'statistics': ['statistics', 'probability', 'distribution', 'mean', 'median', 'standard deviation'],
    };
    
    for (const [topicName, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => msg.includes(kw))) {
        topic = topicName;
        break;
      }
    }
    
    return { 
      shouldTeach: wantToTeach || this.teachingStarted, 
      topic 
    };
  }

  /**
   * Check if conversation history indicates a topic was being studied.
   * @returns {string|null}
   */
  _getLastTopicFromHistory() {
    if (this.conversationHistory.length === 0) return null;
    
    // Look through recent messages for topic mentions
    const recentMessages = this.conversationHistory.slice(-10);
    const messageText = recentMessages.map(m => m.content).join(' ').toLowerCase();
    
    const topicKeywords = {
      'algebra': ['algebra', 'linear equation', 'quadratic', 'polynomial'],
      'geometry': ['geometry', 'triangle', 'circle', 'angle'],
      'calculus': ['calculus', 'derivative', 'integral'],
      'trigonometry': ['trigonometry', 'sine', 'cosine'],
      'statistics': ['statistics', 'probability'],
    };
    
    for (const [topicName, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => messageText.includes(kw))) {
        return topicName;
      }
    }
    
    return null;
  }

  _isSimpleGreeting(userMessage = '') {
    const msg = String(userMessage || '').trim().toLowerCase();
    return /^(hi|hello|hey|yo|sup|good\s*(morning|afternoon|evening|night)|ok|okay|thanks|thank you)[!. ]*$/.test(msg);
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

    // Only inject topic in TEACHING or SOLVER mode
    if ((this.mode === 'TEACHING' || this.mode === 'SOLVER') && context.topicId) {
      systemPrompt += `\n\nCurrent topic: ${context.topicId}. Stay focused on this topic.`;
    } else if (this.mode === 'GREETING' && this.currentTopic) {
      // In greeting mode, gently reference the current topic if resuming
      systemPrompt += `\n\nNote: The student has been working on ${this.currentTopic}. Feel free to acknowledge this if relevant.`;
    }

    // Inject grading results for Socratic feedback (only in teaching modes)
    if ((this.mode === 'TEACHING' || this.mode === 'SOLVER') && context.gradingResult) {
      const gr = context.gradingResult;
      systemPrompt += `\n\n--- GRADING CONTEXT (use this for feedback, do NOT reveal raw data) ---
Student scored: ${gr.score}/${gr.maxScore}
Step results: ${JSON.stringify(gr.stepResults)}
Overall feedback areas: ${gr.feedback || 'None'}
--- Use this to give encouraging, specific feedback about their work. ---`;
    }

    // Inject previous mistakes for personalized teaching (only in teaching modes)
    if ((this.mode === 'TEACHING' || this.mode === 'SOLVER') && context.previousMistakes?.length > 0) {
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
    // In an active teaching conversation, short greetings should get a quick natural reply
    // instead of re-running a full math answer from context.
    if (this.teachingStarted && this._isSimpleGreeting(userMessage)) {
      const topicText = this.currentTopic ? ` ${this.currentTopic}` : ' this topic';
      const quickReply = `Hey! Want to continue with${topicText}, try a new problem, or switch topics?`;
      this.conversationHistory.push({ role: 'user', content: userMessage });
      this.conversationHistory.push({ role: 'assistant', content: quickReply });
      if (this.conversationHistory.length > 40) {
        this.conversationHistory = this.conversationHistory.slice(-40);
      }
      callbacks.onDone?.(quickReply);
      return quickReply;
    }

    // Check if user is requesting to start teaching
    const { shouldTeach, topic } = this._detectTeachingRequest(userMessage, context);
    
    // Update mode if transition is needed
    if (!this.teachingStarted && shouldTeach) {
      this.teachingStarted = true;
      this.setMode('TEACHING');
      if (topic) {
        this.currentTopic = topic;
      }
    } else if (this.teachingStarted && !this.mode.includes('TEACHING') && !this.mode.includes('SOLVER')) {
      // If teaching has started, make sure we're in a teaching mode
      this.setMode('TEACHING');
    }
    
    // If still in greeting mode and we have chat history, check if there's a topic to resume
    if (this.mode === 'GREETING' && this.conversationHistory.length > 0 && !this.currentTopic) {
      const lastTopic = this._getLastTopicFromHistory();
      if (lastTopic) {
        this.currentTopic = lastTopic;
      }
    }
    
    const messages = this._buildMessages(userMessage, context);

    // Track conversation
    this.conversationHistory.push({ role: 'user', content: userMessage });

    let fullResponse = '';

    const response = await this.streamChat(messages, {
      // Route preference must respect the selected AI mode.
      preferLocal: context.aiMode === 'offline',
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
    this.teachingStarted = false;
    this.currentTopic = null;
    this.setMode('GREETING');
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
    
    // If there's existing conversation history, check if teaching was already happening
    if (this.conversationHistory.length > 0) {
      // Look for teaching-related keywords in messages to infer if teaching has started
      const allText = this.conversationHistory.map(m => m.content).join(' ').toLowerCase();
      const teachingIndicators = ['explained', 'taught', 'formula', 'step by step', 'solution', 'answer:', 'proof'];
      this.teachingStarted = teachingIndicators.some(indicator => allText.includes(indicator));
      
      // Try to detect topic from history
      const lastTopic = this._getLastTopicFromHistory();
      if (lastTopic) {
        this.currentTopic = lastTopic;
      }
      
      // If teaching has started, switch to teaching mode
      if (this.teachingStarted) {
        this.setMode('TEACHING');
      }
    }
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
