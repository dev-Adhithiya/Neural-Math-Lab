import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatAssistant from './ChatAssistant.jsx';
import TopicSelector from './TopicSelector.jsx';
import ModeToggle from './ModeToggle.jsx';
import LevelBadge from './LevelBadge.jsx';
import MarksDashboard from './MarksDashboard.jsx';
import GraphPlotter from './GraphPlotter.jsx';
import StudentReport from './StudentReport.jsx';
import SidebarNav from './SidebarNav.jsx';
import TopicMap from './TopicMap.jsx';
import ChatSessionsPanel from './ChatSessionsPanel.jsx';
import QuizView from './QuizView.jsx';
import PlanView from './PlanView.jsx';
import MistakesPanel from './MistakesPanel.jsx';
import { useAI } from '../hooks/useAI.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { TutorAgent, generateGreeting } from '../agents/TutorAgent.js';
import { gradeWork } from '../agents/GraderAgent.js';
import { getAnnotatedTopics, buildProgressMap } from '../agents/KnowledgeGraph.js';
import { generateSessionPlan, planToMessage } from '../agents/ProactivePlanner.js';
import { generateReport } from '../agents/StudentReportGenerator.js';
import { calculateLevel, awardParticipation, awardStepByStep, getCurrentLevel } from '../engine/GamificationEngine.js';
import { plotMathFunction, extractGraphCommands } from '../engine/DynamicGraphing.js';
import { simplify } from 'mathjs';
import { processHandwriting } from '../vision/VisionModule.js';
import { extractMathWithMoondream, preprocessForOcr, bridgeToPhi3, classifyImageWithMoondream } from '../vision/ImageDispatcher.js';
import { TOPICS, getTopic, getPrerequisiteChain } from '../agents/KnowledgeGraph.js';
import {
  getProfile, getPrerequisiteProgress, getExamHistory,
  saveChatMessage, getMistakes, saveExamResult,
  createChatSession, getChatSessions, getChatHistory, deleteChatSession, updateSessionTimestamp, updateSessionTitle,
  resetAllData,
} from '../store/localVault.js';

function normalizeMathAnswer(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\$+/g, '')
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/−/g, '-')
    .replace(/\^\{([^}]+)\}/g, '^$1');
}

function areMathAnswersEquivalent(studentAnswer, expectedAnswer) {
  const student = normalizeMathAnswer(studentAnswer);
  const expected = normalizeMathAnswer(expectedAnswer);
  if (!student || !expected) return false;
  if (student === expected) return true;

  try {
    const diff = simplify(`(${student})-(${expected})`);
    const simplifiedDiff = normalizeMathAnswer(diff.toString());
    if (simplifiedDiff === '0') return true;

    const compiled = diff.compile();
    const sampleXs = [-3, -1, 0, 1, 2, 4];
    const allCloseToZero = sampleXs.every((x) => {
      const v = Number(compiled.evaluate({ x }));
      return Number.isFinite(v) && Math.abs(v) < 1e-8;
    });
    return allCloseToZero;
  } catch {
    return false;
  }
}

function getTopTopicsFromHistory(exams = []) {
  const map = new Map();
  for (const e of exams || []) {
    if (!e?.topicId || !e?.maxScore) continue;
    const item = map.get(e.topicId) || { topicId: e.topicId, score: 0, maxScore: 0, attempts: 0 };
    item.score += Number(e.score || 0);
    item.maxScore += Number(e.maxScore || 0);
    item.attempts += 1;
    map.set(e.topicId, item);
  }

  return [...map.values()]
    .map((x) => ({ ...x, accuracy: x.maxScore > 0 ? Math.round((x.score / x.maxScore) * 100) : 0 }))
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 4);
}

function isEphemeralSessionId(id) {
  return typeof id === 'string' && id.startsWith('local-');
}

function isGenericSessionTitle(title) {
  const normalized = String(title || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'main chat') return true;
  if (/^local chat(\s+\d+)?$/.test(normalized)) return true;
  if (normalized.startsWith('chat ')) return true;
  return false;
}

function isLowSignalPrompt(prompt) {
  const normalized = String(prompt || '').trim().toLowerCase();
  return /^(hi|hello|hey|yo|hola|sup|good\s+(morning|afternoon|evening|night))[\s!.?]*$/.test(normalized);
}

function buildSessionTitleFromPrompt(prompt) {
  const cleaned = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const withoutOuterQuotes = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  if (!withoutOuterQuotes) return null;
  if (withoutOuterQuotes.length <= 52) return withoutOuterQuotes;
  return `${withoutOuterQuotes.slice(0, 49).trimEnd()}...`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * MathWorkspace — Main application workspace.
 * Orchestrates all components: chat, topics, grading, graphing, reports.
 */
export default function MathWorkspace() {
  const { settings, updateSettings } = useSettings();

  // ── State ──
  const [messages, setMessages] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [tutorMode, setTutorMode] = useState('GREETING'); // Start in GREETING mode, not TEACHING
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [annotatedTopics, setAnnotatedTopics] = useState([]);
  const [levelInfo, setLevelInfo] = useState(null);
  const [gradingResult, setGradingResult] = useState(null);
  const [examHistory, setExamHistory] = useState([]);
  const [chartData, setChartData] = useState(null);
  const [chartEquation, setChartEquation] = useState('');
  const [report, setReport] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [imagePreview, setImagePreview] = useState(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [activeView, setActiveView] = useState('chat'); // chat | quiz | plan | prereq | report | map | mistakes
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [ephemeralMessagesBySession, setEphemeralMessagesBySession] = useState({});
  const [isEphemeralMode, setIsEphemeralMode] = useState(false);
  const [prereqTopicId, setPrereqTopicId] = useState('polynomials');
  const [toast, setToast] = useState('');
  const [isTutorReady, setIsTutorReady] = useState(false);
  const [sidePrompt, setSidePrompt] = useState('');

  const showToast = useCallback((message, duration = 4600) => {
    setToast(message);
    if (typeof duration === 'number' && duration > 0) {
      setTimeout(() => setToast(''), duration);
    }
  }, []);
  const switchToEphemeralMode = useCallback((reason = null) => {
    const localId = `local-main`;
    setIsEphemeralMode(true);
    setChatSessions((prev) => {
      const existingLocal = prev.find((s) => String(s.id) === localId);
      if (existingLocal) return prev;
      return [{ id: localId, title: 'Local Chat', createdAt: new Date().toISOString() }, ...prev.filter((s) => !isEphemeralSessionId(s.id))];
    });
    setActiveSessionId(localId);
    if (reason) {
      showToast('⚠️ Browser storage is unavailable. Switched to temporary chat mode (data will not persist).', 7600);
      console.warn('[MathWorkspace] Ephemeral mode reason:', reason);
    }
  }, [showToast]);

  // ── AI Hook ──
  const { mode: aiMode, setMode: setAIModeInternal, isStreaming, streamChat, analyzeImage, routeBadge, abort } = useAI(settings);
  const topTopics = React.useMemo(() => getTopTopicsFromHistory(examHistory), [examHistory]);

  const setAIMode = useCallback((nextMode) => {
    setAIModeInternal(nextMode);
    updateSettings({ aiMode: nextMode });
  }, [setAIModeInternal, updateSettings]);

  // ── Tutor Agent ──
  const tutorRef = useRef(null);

  useEffect(() => {
    tutorRef.current = new TutorAgent({ streamChat, analyzeImage });
    tutorRef.current.setMode(tutorMode);
    setIsTutorReady(true);
  }, [streamChat, analyzeImage, tutorMode]);

  // ── Initialize on mount ──
  useEffect(() => {
    async function init() {
      let profileLoaded = false;

      // One-time fresh session support (use ?fresh=true to clear all stored data)
      try {
        const query = (typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null);
        const isFresh = query?.get('fresh') === 'true' || query?.get('reset') === 'true';
        if (isFresh) {
          await resetAllData();
          await updateSettings({ aiMode: 'offline' });
          showToast('✅ Fresh start: cleared cache + switched to offline AI mode', 7000);
        }
      } catch (freshErr) {
        console.warn('⚠️ Fresh-start init failed:', freshErr);
      }

      try {
        await getProfile();
        profileLoaded = true;
      } catch (profileError) {
        console.warn('⚠️ Could not load profile from IndexedDB. Falling back to defaults.', profileError);
        // Continue startup with defaults as best-effort.
      }

      try {
        const sessions = await getChatSessions();
        let activeId = sessions[0]?.id ?? null;
        if (!activeId) {
          activeId = await createChatSession('Main Chat');
        }
        setActiveSessionId(activeId);
        setChatSessions(await getChatSessions());

        const chatHistoryRows = await getChatHistory(activeId);
        const restored = (chatHistoryRows || []).map((m) => ({ role: m.role, content: m.content, id: m.id || `${m.timestamp}-${Math.random()}` }));
        setMessages(restored);
        if (tutorRef.current) {
          tutorRef.current.resetConversation?.();
          tutorRef.current.setConversationHistory?.(restored);
        }
      } catch (error) {
        console.error('❌ Failed to initialize persistent chat store:', error);
        switchToEphemeralMode(error?.message || 'init chat store failed');
        setMessages([]);
        if (tutorRef.current) {
          tutorRef.current.resetConversation?.();
          tutorRef.current.setConversationHistory?.([]);
        }
      }

      try {
        const progress = await getPrerequisiteProgress();
        const progressMap = buildProgressMap(progress);
        setAnnotatedTopics(getAnnotatedTopics(progressMap));
      } catch (error) {
        console.warn('⚠️ Failed to load prerequisite progress:', error);
        setAnnotatedTopics(getAnnotatedTopics(buildProgressMap([])));
      }

      try {
        const level = await getCurrentLevel();
        setLevelInfo(level);
      } catch (error) {
        console.warn('⚠️ Failed to load level info:', error);
        setLevelInfo(calculateLevel(0));
      }

      try {
        const examRows = await getExamHistory();
        setExamHistory((examRows || []).slice(0, 10));
      } catch (error) {
        console.warn('⚠️ Failed to load exam history:', error);
        setExamHistory([]);
      }

      if (!profileLoaded) {
        showToast('⚠️ Profile storage unavailable. Running with defaults in temporary mode.', 7000);
      }
    }
    init();
  }, [showToast, switchToEphemeralMode]);

  // Load chat history when session changes
  useEffect(() => {
    if (!activeSessionId) return;

    if (isEphemeralMode || isEphemeralSessionId(activeSessionId)) {
      const restored = ephemeralMessagesBySession[activeSessionId] || [];
      setMessages(restored);
      tutorRef.current?.resetConversation?.();
      tutorRef.current?.setConversationHistory?.(restored);
      return;
    }

    (async () => {
      try {
        const chatHistoryRows = await getChatHistory(activeSessionId);
        const restored = (chatHistoryRows || []).map((m) => ({ role: m.role, content: m.content, id: m.id || `${m.timestamp}-${Math.random()}` }));
        setMessages(restored);
        tutorRef.current?.resetConversation?.();
        tutorRef.current?.setConversationHistory?.(restored);
      } catch (error) {
        console.warn('⚠️ Failed to restore chat history:', error);
        switchToEphemeralMode(error?.message || 'restore chat history failed');
      }
    })();
  }, [activeSessionId, ephemeralMessagesBySession, isEphemeralMode, switchToEphemeralMode]);

  useEffect(() => {
    if (!activeSessionId || !isEphemeralSessionId(activeSessionId)) return;
    setEphemeralMessagesBySession((prev) => ({ ...prev, [activeSessionId]: messages }));
  }, [messages, activeSessionId]);

  // ── Refresh topics and level ──
  const refreshData = useCallback(async () => {
    try {
      const progress = await getPrerequisiteProgress();
      const progressMap = buildProgressMap(progress);
      setAnnotatedTopics(getAnnotatedTopics(progressMap));
    } catch {
      setAnnotatedTopics(getAnnotatedTopics(buildProgressMap([])));
    }

    try {
      const level = await getCurrentLevel();
      setLevelInfo(level);
    } catch {
      setLevelInfo(calculateLevel(0));
    }

    try {
      const examRows = await getExamHistory();
      setExamHistory((examRows || []).slice(0, 10));
    } catch {
      setExamHistory([]);
    }
  }, []);

  // ── Send message ──
  const handleSend = useCallback(async (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;

    const maybeAutoTitleFromPrompt = async (prompt) => {
      if (!activeSessionId || isLowSignalPrompt(prompt)) return;

      const priorUserCount = messages.reduce((count, m) => {
        return m.role === 'user' ? count + 1 : count;
      }, 0);
      if (priorUserCount > 0) return;

      const nextTitle = buildSessionTitleFromPrompt(prompt);
      if (!nextTitle) return;

      const currentSession = chatSessions.find((s) => String(s.id) === String(activeSessionId));
      if (!currentSession || !isGenericSessionTitle(currentSession.title)) return;

      if (isEphemeralMode || isEphemeralSessionId(activeSessionId)) {
        setChatSessions((prev) => prev.map((s) => (
          String(s.id) === String(activeSessionId) ? { ...s, title: nextTitle } : s
        )));
        return;
      }

      try {
        await updateSessionTitle(activeSessionId, nextTitle);
        setChatSessions(await getChatSessions());
      } catch {
        switchToEphemeralMode('auto title update failed');
      }
    };

    if (!tutorRef.current || !isTutorReady) {
      showToast('Tutor is still initializing. Please retry in a second.');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: '⏳ Tutor is still initializing. Please send that again in a moment.',
        id: Date.now() + 1,
      }]);
      return;
    }

    if (aiMode === 'online' && (!settings.azureEndpoint || !settings.azureKey || !settings.azureDeployment)) {
      showToast('Online mode is missing Azure settings. Switched to Local mode.', 6000);
      setAIMode('offline');
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: '⚠️ Online mode needs Azure endpoint/key/deployment in Settings. I switched to Local mode so chat can continue.',
        id: Date.now() + 1,
      }]);
    }

    const isGreetingOnly = /^(hi|hello|hey|good (morning|afternoon|evening|night))[\s!.]*$/i.test(trimmed);
    if (messages.length === 0 && isGreetingOnly) {
      const now = new Date();
      const h = now.getHours();
      const tod = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
      const assistantMsg = {
        role: 'assistant',
        content: `${tod}, **${settings.studentName || 'Student'}**.\n\nWhat would you like to do next?\n- **Plan** a session\n- Take a **Quiz**\n- Start **AI Chat**\n- View the **Math Topic Map**\n\nReply with: plan / quiz / chat / map`,
        id: Date.now() + 1,
      };
      setMessages((prev) => [...prev, { role: 'user', content: trimmed, id: Date.now() }, assistantMsg]);
      if (activeSessionId && !(isEphemeralMode || isEphemeralSessionId(activeSessionId))) {
        try {
          await saveChatMessage({ role: 'user', content: trimmed, sessionId: activeSessionId });
          await saveChatMessage({ role: 'assistant', content: assistantMsg.content, sessionId: activeSessionId });
          await updateSessionTimestamp(activeSessionId);
        } catch {
          switchToEphemeralMode('saving greeting exchange failed');
        }
      }
      return;
    }

    const userMsg = { role: 'user', content: trimmed, id: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setStreamingText('');
    await maybeAutoTitleFromPrompt(trimmed);

    if (activeSessionId && !(isEphemeralMode || isEphemeralSessionId(activeSessionId))) {
      try {
        await saveChatMessage({ role: 'user', content: trimmed, sessionId: activeSessionId });
        await updateSessionTimestamp(activeSessionId);
      } catch {
        switchToEphemeralMode('saving user message failed');
      }
    }

    let mistakes = [];
    try {
      mistakes = await getMistakes();
    } catch {
      mistakes = [];
      switchToEphemeralMode('loading mistakes failed');
    }

    try {
      await tutorRef.current.chat(trimmed, {
        studentName: settings.studentName || 'Student',
        topicId: selectedTopic,
        previousMistakes: mistakes.slice(-5),
        gradingResult,
        aiMode,
      }, {
        onToken: (token) => {
          setStreamingText((prev) => prev + token);
        },
        onDone: async (fullText) => {
          const assistantMsg = { role: 'assistant', content: fullText, id: Date.now() + 1 };

          // Sync the tutorMode with the TutorAgent's internal mode
          if (tutorRef.current) {
            const agentState = tutorRef.current.getState();
            setTutorMode(agentState.mode);
            if (agentState.currentTopic && !selectedTopic) {
              setSelectedTopic(agentState.currentTopic);
            }
          }

          // Check for graphs
          const graphEqs = extractGraphCommands(fullText);
          if (graphEqs.length > 0) {
            const data = plotMathFunction(graphEqs[0]);
            setChartData(data);
            setChartEquation(graphEqs[0]);
          }

          // Award participation XP (best-effort only in temporary mode)
          try {
            const xpResult = await awardParticipation();
            if (xpResult.leveledUp) {
              assistantMsg.xpAward = xpResult;
            }
          } catch {
            switchToEphemeralMode('awarding participation XP failed');
          }

          setMessages((prev) => [...prev, assistantMsg]);
          setStreamingText('');
          if (activeSessionId && !(isEphemeralMode || isEphemeralSessionId(activeSessionId))) {
            try {
              await saveChatMessage({ role: 'assistant', content: fullText, sessionId: activeSessionId });
              await updateSessionTimestamp(activeSessionId);
            } catch {
              switchToEphemeralMode('saving assistant message failed');
            }
          }
          try {
            await refreshData();
          } catch {
            // Non-blocking refresh failure
          }
        },
        onError: (err) => {
          const msg = String(err?.message || '');
          const isAborted = err?.name === 'AbortError'
            || msg.toLowerCase().includes('aborted')
            || msg.toLowerCase().includes('abort');

          const errorMsg = {
            role: 'assistant',
            content: isAborted
              ? '⏹ Response stopped.'
              : `⚠️ Error: ${err.message}. Please open Settings (⚙️) and verify your provider and model settings.`,
            id: Date.now() + 1,
          };
          setMessages((prev) => [...prev, errorMsg]);
          setStreamingText('');

          if (!isAborted) {
            showToast(`AI error: ${err.message}. Check Settings and try again.`, 7600);
          }
        },
        onGraphDetected: (equation) => {
          const data = plotMathFunction(equation);
          setChartData(data);
          setChartEquation(equation);
        },
      });
    } catch (err) {
      console.error('[MathWorkspace] Error:', err);
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `⚠️ I hit an unexpected error: ${err?.message || 'unknown error'}. Please try again.`,
        id: Date.now() + 1,
      }]);
      showToast(`Unexpected chat error: ${err?.message || 'unknown error'}`, 7000);
    }
  }, [settings.studentName, settings.azureEndpoint, settings.azureKey, settings.azureDeployment, selectedTopic, gradingResult, refreshData, activeSessionId, messages, aiMode, isTutorReady, setAIMode, showToast, isEphemeralMode, switchToEphemeralMode, chatSessions]);

  // ── Quick Actions ──
  const handleQuickAction = useCallback(async (actionId) => {
    switch (actionId) {
      case 'plan': {
        setActiveView('plan');
        const plan = await generateSessionPlan();
        const planMsg = planToMessage(plan);
        const msg = { role: 'assistant', content: planMsg, id: Date.now() };
        setMessages((prev) => [...prev, msg]);
        break;
      }
      case 'learn':
        setActiveView('chat');
        setShowSidebar(true);
        const learnMsg = {
          role: 'assistant',
          content: `📚 Great! Check the **Topics** panel on the left — pick any unlocked topic and I'll guide you through it step by step!\n\nIf you see a 🔒 locked topic, I can tell you what prerequisites you need first.`,
          id: Date.now(),
        };
        setMessages((prev) => [...prev, learnMsg]);
        break;
      case 'prerequisites':
        setActiveView('prereq');
        handleSend('What prerequisites do I need to learn Calculus? Show me the full path.');
        break;
      case 'quiz':
        setActiveView('quiz');
        handleSend('Give me a quiz on ' + (selectedTopic || 'a topic I should practice') + '.');
        break;
      case 'report': {
        setActiveView('report');
        const rpt = await generateReport();
        setReport(rpt);
        setShowReport(true);
        break;
      }
      default:
        break;
    }
  }, [selectedTopic, handleSend]);

  // ── Image Upload (OCR) Pipeline ──
  const handleSendWithImage = useCallback(async (text, file) => {
    const trimmed = String(text || '').trim();
    const previewUrl = URL.createObjectURL(file);
    
    // STEP 1: Show the photo in the chat immediately, but show a "Scanning" state.
    const userContent = trimmed || 'Uploaded an image';
    const userMsg = { role: 'user', content: userContent, image: previewUrl, id: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessingImage(true);
    setStreamingText(''); // Empty string shows the CSS typing indicator dots instead of fake text

    try {
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      const allowOnlineVision = isOnline && settings.aiMode !== 'offline';

      let extractedText = "";

      // STEP 2: OCR — try to extract text from the image.
      if (!allowOnlineVision) {
          // Offline: moondream is a small vision model and often fails to read
          // printed/handwritten math. We try our best, but never block on failure.
          try {
            const pre = await preprocessForOcr(file);
            const result = await extractMathWithMoondream(pre, { ollamaUrl: settings.ollamaUrl });
            extractedText = result?.text || '';
          } catch (ocrErr) {
            console.warn('[MathWorkspace] Offline OCR failed, forwarding anyway:', ocrErr.message);
          }
      } else {
          const result = await processHandwriting(file, { analyzeImage });
          extractedText = result?.latex || result?.text || '';
      }

      // STEP 3: Gatekeeper — online mode only.
      // In offline mode moondream regularly misses printed/handwritten math even on clear images.
      // Never block the student offline — pass it to the agent regardless and let it ask for help.
      const ocrFailed = !extractedText || extractedText.includes("ERROR_NO_CONTENT") || extractedText.trim() === "";

      if (ocrFailed && allowOnlineVision) {
         // Online OCR genuinely found nothing — likely not a math image.
         setIsProcessingImage(false);
         showToast("Oops! I can't find any math in this photo. Try a clearer shot!");
         setMessages((prev) => [...prev, {
            role: 'assistant',
            content: "Oops! I can't find any math in this photo. Try a clearer shot!",
            id: Date.now()
         }]);
         return;
      }

      // STEP 4: Forward to the Socratic Tutor.
      // If offline OCR returned nothing, the agent is told so it can prompt the student to describe the problem.
      let fullPrompt = trimmed || '(Student uploaded an image)';
      if (extractedText) {
        // Just append extracted content without mentioning OCR technical details
        fullPrompt = `${extractedText}\n\n${trimmed || '(image uploaded)'}`.trim();
      } else if (ocrFailed && !allowOnlineVision) {
        // Offline mode couldn't read - ask student to describe
        fullPrompt = `[Note: I couldn't read the image clearly. Please describe what you wrote or type out the problem]\n\n${trimmed || ''}`;
      }
      
      if (activeSessionId && !(isEphemeralMode || isEphemeralSessionId(activeSessionId))) {
         const savedMsg = trimmed ? `${trimmed}\n\n[Image submitted]` : `[Image submitted]`;
         try {
           await saveChatMessage({ role: 'user', content: savedMsg, sessionId: activeSessionId });
           await updateSessionTimestamp(activeSessionId);
         } catch {
           switchToEphemeralMode('saving image submission failed');
         }
      }
      
      setStreamingText(''); // prepare for actual stream
      
      let mistakes = [];
      try {
        mistakes = await getMistakes();
      } catch {
        mistakes = [];
      }
      
      await tutorRef.current.chat(fullPrompt, {
        studentName: settings.studentName || 'Student',
        topicId: selectedTopic,
        previousMistakes: mistakes.slice(-5),
        gradingResult,
        aiMode,
      }, {
        onToken: (token) => {
          setStreamingText((prev) => prev + token);
        },
        onDone: async (fullText) => {
          const assistantMsg = { role: 'assistant', content: fullText, id: Date.now() + 1 };
          
          const graphEqs = extractGraphCommands(fullText);
          if (graphEqs.length > 0) {
            const data = plotMathFunction(graphEqs[0]);
            setChartData(data);
            setChartEquation(graphEqs[0]);
          }

          try {
            const xpResult = await awardParticipation();
            if (xpResult.leveledUp) {
              assistantMsg.xpAward = xpResult;
            }
          } catch {
            switchToEphemeralMode('awarding image-chat participation XP failed');
          }

          setMessages((prev) => [...prev, assistantMsg]);
          setStreamingText('');
          if (activeSessionId && !(isEphemeralMode || isEphemeralSessionId(activeSessionId))) {
            try {
              await saveChatMessage({ role: 'assistant', content: fullText, sessionId: activeSessionId });
              await updateSessionTimestamp(activeSessionId);
            } catch {
              switchToEphemeralMode('saving image assistant response failed');
            }
          }
          try {
            await refreshData();
          } catch {
            // Non-blocking refresh failure
          }
        },
        onError: (err) => {
          setStreamingText('');
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: `⚠️ Error: ${err.message}`,
            id: Date.now() + 1,
          }]);
          showToast(`AI error: ${err.message}. Try a smaller model or switch to online mode from Settings.`, 7600);
        },
      });

    } catch (err) {
      console.error("Pipeline Failed:", err);
      setStreamingText('');
      setMessages((prev) => [...prev, { 
        role: 'assistant', 
        content: "Something went wrong processing that image. Let's try again.",
        id: Date.now()
      }]);
    } finally {
      setIsProcessingImage(false);
    }
  }, [analyzeImage, settings.aiMode, settings.ollamaUrl, activeSessionId, selectedTopic, gradingResult, refreshData, aiMode, isEphemeralMode, switchToEphemeralMode]);

  // ── Topic Selection ──
  const handleTopicSelect = useCallback((topicId) => {
    setSelectedTopic(topicId);
    setActiveView('chat');
    handleSend(`I want to learn about ${topicId.replace(/-/g, ' ')}. Let's start!`);
  }, [handleSend]);

  return (
    <div className={`math-workspace ${showSidebar ? '' : 'sidebar-collapsed'}`}>
      {toast && <div className="toast">{toast}</div>}
      {/* Left Sidebar — Navigation */}
      <aside className={`workspace-sidebar ${showSidebar ? 'open' : 'closed'}`}>
        <button className="sidebar-toggle" onClick={() => setShowSidebar(!showSidebar)}>
          {showSidebar ? '◀' : '▶'}
        </button>
        <SidebarNav
          activeView={activeView}
          collapsed={!showSidebar}
          onNavigate={(view) => {
            setActiveView(view);
            if (view === 'report') setShowReport(true);
          }}
        />
        <ChatSessionsPanel
          collapsed={!showSidebar}
          sessions={chatSessions}
          activeSessionId={activeSessionId}
          onNewSession={async () => {
            try {
              const id = await createChatSession();
              setChatSessions(await getChatSessions());
              setActiveSessionId(id);
            } catch (error) {
              console.warn('⚠️ Failed to create persisted chat session:', error);
              switchToEphemeralMode(error?.message || 'create session failed');
              const id = `local-${Date.now()}`;
              setChatSessions((prev) => [{ id, title: `Local Chat ${prev.length + 1}`, createdAt: new Date().toISOString() }, ...prev]);
              setActiveSessionId(id);
              showToast('Storage unavailable. Created a temporary local session.', 6000);
            }
            setActiveView('chat');
          }}
          onSelectSession={(id) => {
            setActiveSessionId(id);
            setActiveView('chat');
          }}
          onRenameSession={async (id, title) => {
            if (isEphemeralSessionId(id)) {
              setChatSessions((prev) => prev.map((s) => (String(s.id) === String(id) ? { ...s, title } : s)));
              return;
            }
            try {
              await updateSessionTitle(id, title);
              setChatSessions(await getChatSessions());
            } catch {
              switchToEphemeralMode('rename session failed');
            }
          }}
          onDeleteSession={async (id) => {
            if (isEphemeralSessionId(id)) {
              const sessions = chatSessions.filter((s) => String(s.id) !== String(id));
              setChatSessions(sessions);
              setEphemeralMessagesBySession((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
              });
              if (String(id) === String(activeSessionId)) {
                setActiveSessionId(sessions[0]?.id ?? null);
              }
              return;
            }

            let sessions = [];
            try {
              await deleteChatSession(id);
              sessions = await getChatSessions();
              setChatSessions(sessions);
            } catch {
              switchToEphemeralMode('delete session failed');
            }
            if (String(id) === String(activeSessionId)) {
              const nextId = sessions[0]?.id ?? null;
              setActiveSessionId(nextId);
            }
          }}
        />
        {showSidebar && activeView === 'map' && (
          <div style={{ marginTop: 12 }}>
            <TopicSelector
              annotatedTopics={annotatedTopics}
              selectedTopic={selectedTopic}
              onSelect={handleTopicSelect}
            />
          </div>
        )}
      </aside>

      {/* Center — Active View */}
      <main className="workspace-main">
        <div className="workspace-topbar">
          <ModeToggle
            tutorMode={tutorMode}
            onTutorModeChange={setTutorMode}
            aiMode={aiMode}
            onAIModeChange={setAIMode}
          />
          <LevelBadge levelInfo={levelInfo} />
        </div>

        {activeView === 'map' && (
          <TopicMap selectedTopic={selectedTopic} onSelectTopic={handleTopicSelect} />
        )}

        {activeView === 'plan' && (
          <PlanView onSendToChat={(text) => { setActiveView('chat'); handleSend(text); }} />
        )}

        {activeView === 'quiz' && (
          <QuizView
            topicId={selectedTopic || 'polynomials'}
            onExtractAnswerFromPhoto={async (imageFile, questionPrompt) => {
              const base64 = await fileToBase64(imageFile);
              const extractionPrompt = `You are reading a student's handwritten solution for this math question:\n${questionPrompt}\n\nReturn ONLY the student's final answer text.\n- No explanation\n- No markdown\n- If answer has multiple roots, return in one line\n- If unreadable, return UNCLEAR`;
              const extracted = await analyzeImage(base64, extractionPrompt);
              return String(extracted || '').trim();
            }}
            onAskAI={(data) => {
              const { type, question, expected, topic, difficulty } = data;
              let prompt = '';
              
              if (type === 'quiz_doubt') {
                prompt = `I just completed a quiz on ${topic}. I have some doubts and questions about the topics covered. Can you help me understand the concepts better?`;
              } else if (type === 'solve') {
                prompt = `I got this solving question wrong:\n\nQuestion: ${question}\n\nExpected answer: ${expected}\n\nDifficulty: ${difficulty}\n\nCan you explain step-by-step how to solve this? What was my mistake?`;
              }
              
              setActiveView('chat');
              handleSend(prompt);
            }}
            onSubmit={async ({ topicId, quizMode, mcqScore, mcqTotal, solveScore, solveMax, solveDetails }) => {
              const score = mcqScore + solveScore;
              const maxScore = mcqTotal + solveMax;
              const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

              const mcqRatio = mcqTotal > 0 ? mcqScore / mcqTotal : 1;
              const solveRatio = solveMax > 0 ? solveScore / solveMax : 1;

              const stepResults = [
                {
                  stepNumber: 1,
                  marksAwarded: mcqScore,
                  maxMarks: mcqTotal,
                  status: mcqRatio >= 0.8 ? 'correct' : mcqRatio >= 0.5 ? 'partial' : 'incorrect',
                  feedback: `MCQ score: ${mcqScore}/${mcqTotal}.`,
                },
                {
                  stepNumber: 2,
                  marksAwarded: solveScore,
                  maxMarks: solveMax,
                  status: solveRatio >= 0.8 ? 'correct' : solveRatio >= 0.5 ? 'partial' : 'incorrect',
                  feedback: `Solving questions: ${solveScore}/${solveMax}.`,
                },
              ].filter((s) => s.maxMarks > 0);

              const grade = percentage >= 90 ? 'A+' : percentage >= 80 ? 'A' : percentage >= 70 ? 'B' : percentage >= 60 ? 'C' : percentage >= 50 ? 'D' : 'F';
              const nextResult = {
                topicId,
                quizMode,
                score,
                maxScore,
                percentage,
                stepResults,
                feedback: `Quiz result: ${score}/${maxScore}. ${solveRatio >= 0.8 ? 'Excellent solving accuracy.' : 'Review the solving steps for improvement.'}`,
                grade,
                mistakeTypes: solveRatio === 1 ? [] : ['incomplete_solving'],
              };

              try {
                await saveExamResult(nextResult);
                await awardStepByStep(score, maxScore);
              } catch {
                switchToEphemeralMode('saving quiz result failed');
              }

              setGradingResult(nextResult);
              try {
                await refreshData();
              } catch {
                // Non-blocking refresh failure
              }

              showToast(`Quiz submitted! Score: ${score}/${maxScore} (${percentage}%)`);
              return nextResult;
            }}
          />
        )}

        {activeView === 'prereq' && (
          <div className="panel">
            <div className="panel-header">
              <h3>🔗 Prerequisites</h3>
              <p>Select a topic to see what you need to learn first.</p>
            </div>
            <div className="panel-actions">
              <select
                className="quiz-input"
                value={prereqTopicId}
                onChange={(e) => setPrereqTopicId(e.target.value)}
              >
                {TOPICS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                className="panel-btn primary"
                onClick={() => {
                  setSelectedTopic(prereqTopicId);
                  setActiveView('map');
                }}
              >
                Show on map
              </button>
            </div>
            <div style={{ marginTop: 16, padding: '12px', background: 'rgba(34, 211, 238, 0.08)', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <strong>Path to {getTopic(prereqTopicId)?.label}:</strong><br />
              {(getPrerequisiteChain(prereqTopicId) || []).map((id) => getTopic(id)?.label || id).join(' → ') || 'No prerequisites'}
            </div>
          </div>
        )}

        {activeView === 'report' && (
          <div className="panel">
            <div className="panel-header">
              <h3>📊 My Report</h3>
              <p>View your progress report and mastery breakdown.</p>
            </div>
            <div className="panel-actions">
              <button className="panel-btn primary" onClick={() => handleQuickAction('report')} disabled={isStreaming}>
                Open report
              </button>
              <button className="panel-btn" onClick={() => setActiveView('chat')}>Go to chat</button>
            </div>
          </div>
        )}

        {activeView === 'mistakes' && (
          <MistakesPanel 
            topicId={selectedTopic || null}
            onAskAI={(mistake) => {
              const { problem, description, type, difficulty, topic } = mistake;
              const safeProblem = String(problem || '').replace(/\s+/g, ' ').trim();
              const safeDescription = String(description || '').replace(/\s+/g, ' ').trim();
              let prompt = '';
              
              if (type === 'mcq') {
                prompt = `Explain this MCQ mistake clearly and concisely.\n\nQuestion: ${safeProblem}\nMy mistake: ${safeDescription}\n\nRules:\n- Do NOT guess what the student was thinking.\n- Do NOT add fictional context or names.\n- Do NOT include self-reflection, internal reasoning, or "question for student" text.\n- Give only: correct option, why it is correct, and one short method to avoid this mistake.`;
              } else if (type === 'solve') {
                prompt = `Explain this long-answer mistake step by step.\n\nQuestion: ${safeProblem}\nMy mistake: ${safeDescription}\nDifficulty: ${difficulty}\n\nRules:\n- Do NOT guess what the student was thinking.\n- No fictional context.\n- Do NOT include self-reflection or chain-of-thought style text.\n- Keep response focused on math steps and correction only.`;
              } else {
                prompt = `Explain this mistake with only factual math guidance.\n\nQuestion: ${safeProblem}\nMistake: ${safeDescription}\n\nRules:\n- No speculative student psychology.\n- No internal reasoning text.\n- Provide direct correction steps only.`;
              }
              
              setActiveView('chat');
              handleSend(prompt);
            }}
          />
        )}

        {activeView === 'chat' && (
          <ChatAssistant
            messages={messages}
            onSend={handleSend}
            onSendWithImage={handleSendWithImage}
            isStreaming={isStreaming || isProcessingImage}
            streamingText={streamingText}
            onQuickAction={handleQuickAction}
            onAbort={abort}
            studentName={settings.studentName || 'Student'}
            routeBadge={routeBadge}
          />
        )}

        {/* Graph Panel */}
        {chartData && (
          <div className="graph-panel">
            <GraphPlotter chartData={chartData} equation={chartEquation} />
            <button className="graph-close" onClick={() => setChartData(null)}>✕</button>
          </div>
        )}
      </main>

      {/* Right Sidebar — Always visible utility rail */}
      <aside className="workspace-sidebar-right">
        {(activeView === 'quiz' || gradingResult) ? (
          <MarksDashboard gradingResult={gradingResult} examHistory={examHistory} />
        ) : (
          <div className="side-rail">
            <div className="side-rail-card">
              <h4>Live Chat Status</h4>
              <div className="side-rail-row"><span>AI mode</span><b>{aiMode === 'online' ? 'Online' : 'Local'}</b></div>
              <div className="side-rail-row"><span>Messages</span><b>{messages.length}</b></div>
              <div className="side-rail-row"><span>Session</span><b>{activeSessionId ? 'Active' : 'None'}</b></div>
              <div className="side-rail-row"><span>Storage</span><b>{isEphemeralMode ? 'Temporary' : 'Persistent'}</b></div>
            </div>

            <div className="side-rail-card">
              <h4>Side Copilot</h4>
              <input
                className="side-rail-input"
                value={sidePrompt}
                onChange={(e) => setSidePrompt(e.target.value)}
                placeholder="Ask for a hint, recap, or revision task..."
              />
              <div className="side-rail-actions">
                <button
                  className="side-rail-btn"
                  onClick={() => {
                    const prompt = sidePrompt.trim();
                    if (!prompt) return;
                    handleSend(prompt);
                    setSidePrompt('');
                  }}
                  disabled={!sidePrompt.trim() || isStreaming}
                >
                  Send to chat
                </button>
                <button
                  className="side-rail-btn"
                  onClick={() => {
                    const topicLabel = selectedTopic ? (getTopic(selectedTopic)?.label || selectedTopic) : 'my current level';
                    const starter = `Give me 2 quick revision questions for ${topicLabel}.`;
                    setSidePrompt(starter);
                  }}
                >
                  Insert revision prompt
                </button>
              </div>
            </div>

            <div className="side-rail-card">
              <h4>Quick Suggestions</h4>
              <button className="side-rail-btn" onClick={() => handleSend('Give me 3 practice problems for my current level.')}>Practice now</button>
              <button className="side-rail-btn" onClick={() => handleSend('Explain the last concept in a simpler way.')}>Simpler explanation</button>
              <button className="side-rail-btn" onClick={() => setActiveView('map')}>Open topic map</button>
            </div>

            <div className="side-rail-card">
              <h4>Recent Topics</h4>
              {topTopics.length === 0 ? (
                <p className="side-rail-empty">No graded topics yet. Take a quiz to populate this panel.</p>
              ) : (
                <div className="side-rail-topics">
                  {topTopics.map((t) => (
                    <button
                      key={t.topicId}
                      className="side-rail-topic"
                      onClick={() => handleTopicSelect(t.topicId)}
                      title={`${t.accuracy}% accuracy over ${t.attempts} attempts`}
                    >
                      <span>{getTopic(t.topicId)?.label || t.topicId}</span>
                      <b>{t.accuracy}%</b>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Report Overlay */}
      {showReport && (
        <StudentReport report={report} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}
