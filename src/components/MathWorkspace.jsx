import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatAssistant from './ChatAssistant.jsx';
import TopicSelector from './TopicSelector.jsx';
import ModeToggle from './ModeToggle.jsx';
import LevelBadge from './LevelBadge.jsx';
import SidebarNav from './SidebarNav.jsx';
import ChatSessionsPanel from './ChatSessionsPanel.jsx';
import WorkflowCommandPalette from './WorkflowCommandPalette.jsx';
import { useAI } from '../hooks/useAI.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { TutorAgent } from '../agents/TutorAgent.js';
import { getAnnotatedTopics, buildProgressMap } from '../agents/KnowledgeGraph.js';
import { generateSessionPlan, planToMessage } from '../agents/ProactivePlanner.js';
import { generateReport } from '../agents/StudentReportGenerator.js';
import { calculateLevel, awardParticipation, awardStepByStep, getCurrentLevel } from '../engine/GamificationEngine.js';
import { plotMathFunction, extractBestGraphEquation } from '../engine/DynamicGraphing.js';
import { processHandwriting } from '../vision/VisionModule.js';
import { extractMathWithRetries, isLowConfidenceOcrText, VISION_REQUEST_PROMPT, OCR_STRICT_TRANSCRIBE_PROMPT } from '../vision/ImageDispatcher.js';
import { TOPICS, getTopic, getPrerequisiteChain } from '../agents/KnowledgeGraph.js';
import { getDefaultOllamaProxyUrl } from '../config/api.js';
import {
  getProfile, getPrerequisiteProgress, getExamHistory,
  saveChatMessage, getMistakes, saveExamResult,
  createChatSession, getChatSessions, getChatHistory, deleteChatSession, updateSessionTimestamp, updateSessionTitle,
  resetAllData,
} from '../store/localVault.js';

const TopicMap = React.lazy(() => import('./TopicMap.jsx'));
const QuizView = React.lazy(() => import('./QuizView.jsx'));
const PlanView = React.lazy(() => import('./PlanView.jsx'));
const MistakesPanel = React.lazy(() => import('./MistakesPanel.jsx'));
const StudentReport = React.lazy(() => import('./StudentReport.jsx'));
const GraphPlotter = React.lazy(() => import('./GraphPlotter.jsx'));
const MarksDashboard = React.lazy(() => import('./MarksDashboard.jsx'));

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

function fileToImagePayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      resolve({
        dataUrl: result,
        base64: result.split(',')[1] || '',
        mimeType: String(file?.type || '').trim() || 'image/jpeg',
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function parseJsonObjectFromText(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Continue with best-effort extraction.
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Continue with broad brace extraction.
    }
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function balanceLatexAndMarkdown(text) {
  let safe = String(text || '').trim();
  if (!safe) return '';

  const fenceCount = (safe.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    safe += '\n```';
  }

  const blockCount = (safe.match(/\$\$/g) || []).length;
  if (blockCount % 2 !== 0) {
    safe += '\n$$';
  }

  const withoutBlocks = safe.replace(/\$\$/g, '');
  const inlineCount = (withoutBlocks.match(/(?<!\\)\$/g) || []).length;
  if (inlineCount % 2 !== 0) {
    safe += '$';
  }

  return safe;
}

function finalizeAssistantText(rawText) {
  return balanceLatexAndMarkdown(String(rawText || '').replace(/\n{3,}/g, '\n\n'));
}

function hasRenderableGraphPoints(chartData) {
  const points = chartData?.datasets?.[0]?.data;
  if (!Array.isArray(points)) return false;
  return points.some((point) => point && typeof point.y === 'number' && Number.isFinite(point.y));
}

function buildGraphFromAssistantText(text) {
  const inferredEquation = extractBestGraphEquation(text);
  if (!inferredEquation) return null;

  const graphData = plotMathFunction(inferredEquation);
  if (!graphData.parsed || !hasRenderableGraphPoints(graphData)) {
    return null;
  }

  return {
    equation: inferredEquation,
    data: graphData,
  };
}

const WORKFLOW_PRESETS = [
  {
    id: 'warmup',
    label: 'Warmup 5m',
    icon: '🔥',
    description: 'Fast refresh before deeper study',
    tutorMode: 'TEACHING',
    prompt: 'Give me a 5-minute warmup with 2 easy questions and one confidence booster tip.',
    nextView: 'chat',
  },
  {
    id: 'deep',
    label: 'Deep Learn',
    icon: '🧠',
    description: 'Concept to mastery in one flow',
    tutorMode: 'TEACHING',
    prompt: 'Run a deep learning session: explain concept, check understanding, then give one challenge question.',
    nextView: 'chat',
  },
  {
    id: 'exam',
    label: 'Exam Sprint',
    icon: '⚡',
    description: 'Timed pressure practice',
    tutorMode: 'SOLVER',
    prompt: 'I want a timed exam sprint. Give me one medium and one hard question with strict scoring criteria.',
    nextView: 'quiz',
  },
  {
    id: 'recover',
    label: 'Mistake Recovery',
    icon: '🩹',
    description: 'Fix weak areas quickly',
    tutorMode: 'TEACHING',
    prompt: 'Create a targeted recovery drill from my recent mistakes and explain common traps.',
    nextView: 'mistakes',
  },
];

const VIEW_LABELS = {
  chat: 'Chat',
  quiz: 'Quiz',
  plan: 'Plan',
  prereq: 'Prerequisites',
  report: 'Report',
  map: 'Topic Map',
  mistakes: 'Mistakes',
};

const VIEW_LOADER = <div className="view-loader">Loading view...</div>;
const DEMO_AGGRESSIVE_LONG_ANSWER = false;

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
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [activeView, setActiveView] = useState('chat'); // chat | quiz | plan | prereq | report | map | mistakes
  const [displayView, setDisplayView] = useState('chat');
  const [viewPhase, setViewPhase] = useState('in');
  const [chatSessions, setChatSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [ephemeralMessagesBySession, setEphemeralMessagesBySession] = useState({});
  const [isEphemeralMode, setIsEphemeralMode] = useState(false);
  const [prereqTopicId, setPrereqTopicId] = useState('polynomials');
  const [toast, setToast] = useState('');
  const [isTutorReady, setIsTutorReady] = useState(false);
  const [sidePrompt, setSidePrompt] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState('Idle');
  const [activeWorkflowId, setActiveWorkflowId] = useState(null);
  const [focusMinutes, setFocusMinutes] = useState(15);
  const [focusRemaining, setFocusRemaining] = useState(15 * 60);
  const [focusRunning, setFocusRunning] = useState(false);
  const [customFocusMinutes, setCustomFocusMinutes] = useState('15');
  const [coachNudge, setCoachNudge] = useState('');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const streamingBufferRef = useRef('');
  const graphStreamDetectedRef = useRef(false);
  const graphPanelRef = useRef(null);

  useEffect(() => {
    if (!chartData || !graphPanelRef.current) return;
    graphPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chartData]);

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
  const momentumScore = React.useMemo(() => {
    const msgPoints = Math.min(40, messages.length * 2);
    const examPoints = Math.min(40, examHistory.length * 6);
    const topicPoints = selectedTopic ? 20 : 0;
    return Math.min(100, msgPoints + examPoints + topicPoints);
  }, [messages.length, examHistory.length, selectedTopic]);
  const dynamicSuggestions = React.useMemo(() => {
    const topicLabel = selectedTopic ? (getTopic(selectedTopic)?.label || selectedTopic) : 'my current level';
    const byView = {
      quiz: [
        `Give me a rapid error analysis for my last ${topicLabel} quiz.`,
        `Generate one exam-style ${topicLabel} problem with marking rubric.`,
        `Create a 10-minute revision sprint for ${topicLabel}.`,
      ],
      mistakes: [
        `Turn my top mistakes into a correction checklist for ${topicLabel}.`,
        'Give me 3 trap questions based on my common errors.',
        `Teach me a quick verification method to avoid mistakes in ${topicLabel}.`,
      ],
      map: [
        `Build me a path from basics to advanced ${topicLabel}.`,
        'What topic should I unlock next and why?',
        'Give me a bridge lesson between my current topic and the next prerequisite.',
      ],
      chat: [
        `Give me 3 practice problems for ${topicLabel}.`,
        'Explain the last concept in a simpler way.',
        `Challenge me with one hard ${topicLabel} problem and hints only.`,
      ],
    };
    return byView[activeView] || byView.chat;
  }, [activeView, selectedTopic]);

  const navigateToView = useCallback((view) => {
    setActiveView(view);
    if (view === 'report') setShowReport(true);
  }, []);

  const commandItems = React.useMemo(() => {
    const workflowCommands = WORKFLOW_PRESETS.map((preset) => ({
      id: `workflow:${preset.id}`,
      label: `${preset.icon} ${preset.label}`,
      group: 'Workflow',
      hint: preset.description,
      kind: 'workflow',
      value: preset.id,
    }));

    const viewCommands = Object.entries(VIEW_LABELS).map(([id, label]) => ({
      id: `view:${id}`,
      label: `Open ${label}`,
      group: 'Views',
      kind: 'view',
      value: id,
    }));

    const actionCommands = [
      {
        id: 'action:focus',
        label: 'Toggle Focus Sprint',
        group: 'Actions',
        hint: 'Start or pause the current sprint timer',
        kind: 'action',
        value: 'focus',
      },
      {
        id: 'action:practice',
        label: 'Send: Practice now',
        group: 'Actions',
        hint: 'Pushes a practice prompt into chat',
        kind: 'action',
        value: 'practice',
      },
      {
        id: 'action:simple',
        label: 'Send: Simpler explanation',
        group: 'Actions',
        hint: 'Asks tutor to simplify current concept',
        kind: 'action',
        value: 'simple',
      },
    ];

    return [...workflowCommands, ...viewCommands, ...actionCommands];
  }, []);

  const setAIMode = useCallback((nextMode) => {
    setAIModeInternal(nextMode);
    updateSettings({ aiMode: nextMode });
  }, [setAIModeInternal, updateSettings]);

  useEffect(() => {
    if (!focusRunning) return;
    const timer = setInterval(() => {
      setFocusRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setFocusRunning(false);
          setWorkflowStatus('Focus sprint completed');
          showToast('⏱ Focus sprint done. Time for a quick recap!', 6000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [focusRunning, showToast]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const isLauncher = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (!isLauncher) return;
      event.preventDefault();
      setIsCommandPaletteOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (activeView === displayView) return;
    setViewPhase('out');
    const timer = setTimeout(() => {
      setDisplayView(activeView);
      setViewPhase('in');
    }, 180);
    return () => clearTimeout(timer);
  }, [activeView, displayView]);

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
    if (isStreaming || isProcessingImage) {
      showToast('Please wait until the current response is complete.', 2200);
      return;
    }

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
    streamingBufferRef.current = '';
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
      graphStreamDetectedRef.current = false;
      await tutorRef.current.chat(trimmed, {
        studentName: settings.studentName || 'Student',
        topicId: selectedTopic,
        previousMistakes: mistakes.slice(-5),
        gradingResult,
        aiMode,
      }, {
        onToken: (token) => {
          streamingBufferRef.current += token;
          setStreamingText((prev) => prev + token);

          if (!graphStreamDetectedRef.current
            && streamingBufferRef.current.includes('[GRAPH:')
            && streamingBufferRef.current.includes(']')) {
            const graphResult = buildGraphFromAssistantText(streamingBufferRef.current);
            if (graphResult) {
              setChartData(graphResult.data);
              setChartEquation(graphResult.equation);
              graphStreamDetectedRef.current = true;
            }
          }
        },
        onDone: async (fullText, meta = {}) => {
          const finalText = finalizeAssistantText(fullText);
          if (!finalText) {
            setStreamingText('');
            streamingBufferRef.current = '';
            return;
          }

          const assistantMsg = { role: 'assistant', content: finalText, id: Date.now() + 1 };

          // Sync the tutorMode with the TutorAgent's internal mode
          if (tutorRef.current) {
            const agentState = tutorRef.current.getState();
            setTutorMode(agentState.mode);
            if (agentState.currentTopic && !selectedTopic) {
              setSelectedTopic(agentState.currentTopic);
            }
          }

          const graphResult = buildGraphFromAssistantText(finalText);
          if (graphResult) {
            setChartData(graphResult.data);
            setChartEquation(graphResult.equation);
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
          streamingBufferRef.current = '';
          if (activeSessionId && !(isEphemeralMode || isEphemeralSessionId(activeSessionId))) {
            try {
              await saveChatMessage({ role: 'assistant', content: finalText, sessionId: activeSessionId });
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
          if (meta.aborted) {
            showToast('Response stopped. Partial answer saved.', 2600);
          }
        },
        onError: (err) => {
          const msg = String(err?.message || '');
          const isAborted = err?.name === 'AbortError'
            || msg.toLowerCase().includes('aborted')
            || msg.toLowerCase().includes('abort');

          if (isAborted) {
            const partial = finalizeAssistantText(streamingBufferRef.current);
            if (partial) {
              setMessages((prev) => [...prev, { role: 'assistant', content: partial, id: Date.now() + 1 }]);
            }
            setStreamingText('');
            streamingBufferRef.current = '';
            showToast('Response stopped. Partial answer saved.', 2600);
            return;
          }

          const errorMsg = {
            role: 'assistant',
            content: `⚠️ Error: ${err.message}. Please open Settings (⚙️) and verify your provider and model settings.`,
            id: Date.now() + 1,
          };
          setMessages((prev) => [...prev, errorMsg]);
          setStreamingText('');
          streamingBufferRef.current = '';

          showToast(`AI error: ${err.message}. Check Settings and try again.`, 7600);
        },
        onGraphDetected: (equation) => {
          const data = plotMathFunction(equation);
          if (data.parsed && hasRenderableGraphPoints(data)) {
            setChartData(data);
            setChartEquation(equation);
            graphStreamDetectedRef.current = true;
          }
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
  }, [settings.studentName, settings.azureEndpoint, settings.azureKey, settings.azureDeployment, selectedTopic, gradingResult, refreshData, activeSessionId, messages, aiMode, isTutorReady, setAIMode, showToast, isEphemeralMode, switchToEphemeralMode, chatSessions, isStreaming, isProcessingImage]);

  // ── Quick Actions ──
  const handleQuickAction = useCallback(async (actionId) => {
    switch (actionId) {
      case 'plan': {
        navigateToView('plan');
        const plan = await generateSessionPlan();
        const planMsg = planToMessage(plan);
        const msg = { role: 'assistant', content: planMsg, id: Date.now() };
        setMessages((prev) => [...prev, msg]);
        break;
      }
      case 'learn':
        navigateToView('chat');
        setShowSidebar(true);
        const learnMsg = {
          role: 'assistant',
          content: `📚 Great! Check the **Topics** panel on the left — pick any unlocked topic and I'll guide you through it step by step!\n\nIf you see a 🔒 locked topic, I can tell you what prerequisites you need first.`,
          id: Date.now(),
        };
        setMessages((prev) => [...prev, learnMsg]);
        break;
      case 'prerequisites':
        navigateToView('prereq');
        handleSend('What prerequisites do I need to learn Calculus? Show me the full path.');
        break;
      case 'quiz':
        navigateToView('quiz');
        handleSend('Give me a quiz on ' + (selectedTopic || 'a topic I should practice') + '.');
        break;
      case 'report': {
        navigateToView('report');
        const rpt = await generateReport();
        setReport(rpt);
        setShowReport(true);
        break;
      }
      default:
        break;
    }
  }, [selectedTopic, handleSend, navigateToView]);

  const runWorkflowPreset = useCallback((presetId) => {
    const preset = WORKFLOW_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    setActiveWorkflowId(preset.id);
    setWorkflowStatus(`${preset.label} active`);
    setTutorMode(preset.tutorMode);
    navigateToView(preset.nextView);

    if (preset.id === 'warmup') {
      setFocusMinutes(5);
      setFocusRemaining(5 * 60);
      setFocusRunning(true);
    }

    if (preset.id === 'exam') {
      const sprintMinutes = Math.max(1, Number(focusMinutes) || 15);
      setFocusMinutes(sprintMinutes);
      setFocusRemaining(sprintMinutes * 60);
      setFocusRunning(true);
    }

    handleSend(preset.prompt);
  }, [handleSend, navigateToView, focusMinutes]);

  const applyCustomSprintTimer = useCallback((autoStart = false) => {
    const parsed = Number.parseInt(String(customFocusMinutes || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 180) {
      showToast('Enter a custom sprint between 1 and 180 minutes.', 3200);
      return;
    }

    setFocusMinutes(parsed);
    setFocusRemaining(parsed * 60);
    setFocusRunning(Boolean(autoStart));
    setWorkflowStatus(`Custom sprint ${parsed}m ${autoStart ? 'started' : 'ready'}`);
  }, [customFocusMinutes, showToast]);

  const focusTimeLabel = React.useMemo(() => {
    const mm = String(Math.floor(focusRemaining / 60)).padStart(2, '0');
    const ss = String(focusRemaining % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }, [focusRemaining]);

  const handleCommandRun = useCallback((command) => {
    if (!command) return;

    if (command.kind === 'workflow') {
      runWorkflowPreset(command.value);
      return;
    }

    if (command.kind === 'view') {
      navigateToView(command.value);
      return;
    }

    if (command.kind === 'action') {
      if (command.value === 'focus') {
        setFocusRunning((value) => !value);
      }
      if (command.value === 'practice') {
        handleSend('Give me 3 practice problems for my current level.');
        navigateToView('chat');
      }
      if (command.value === 'simple') {
        handleSend('Explain the last concept in a simpler way.');
        navigateToView('chat');
      }
    }
  }, [handleSend, navigateToView, runWorkflowPreset]);

  // ── Image Upload (OCR) Pipeline ──
  const handleSendWithImage = useCallback(async (text, file) => {
    if (isStreaming || isProcessingImage) {
      showToast('Please wait until the current response is complete.', 2200);
      return;
    }

    const trimmed = String(text || '').trim();
    const previewUrl = URL.createObjectURL(file);
    
    // STEP 1: Show the photo in the chat immediately, but show a "Scanning" state.
    const userContent = trimmed || 'Uploaded an image';
    const userMsg = { role: 'user', content: userContent, image: previewUrl, id: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessingImage(true);
    setStreamingText(''); // Empty string shows the CSS typing indicator dots instead of fake text
    streamingBufferRef.current = '';

    try {
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      const allowOnlineVision = isOnline && settings.aiMode !== 'offline';

      let extractedText = '';
      let ocrAttemptTrace = [];

      // STEP 2: OCR — try to extract text from the image.
      if (!allowOnlineVision) {
          // Offline OCR uses multiple attempts to preserve clean screenshot text and still help blurry handwriting.
          try {
            const result = await extractMathWithRetries(file, { ollamaUrl: settings.ollamaUrl });
            extractedText = String(result?.text || '').trim();
            ocrAttemptTrace = Array.isArray(result?.attempts) ? result.attempts : [];
          } catch (ocrErr) {
            console.warn('[MathWorkspace] Offline OCR failed, forwarding anyway:', ocrErr.message);
          }
      } else {
          const result = await processHandwriting(file, { analyzeImage });
          extractedText = result?.latex || result?.text || '';
      }

      if (!allowOnlineVision && ocrAttemptTrace.length > 0) {
        const hasHighConfidenceAttempt = ocrAttemptTrace.some((attempt) => attempt?.text && !attempt?.lowConfidence);
        if (!hasHighConfidenceAttempt) {
          console.info('[MathWorkspace] Offline OCR remained low-confidence after retries.', ocrAttemptTrace);
        }
      }

      // STEP 3: Gatekeeper — online mode only.
      // In offline mode moondream regularly misses printed/handwritten math even on clear images.
      // Never block the student offline — pass it to the agent regardless and let it ask for help.
      const ocrFailed = !extractedText || extractedText.includes('ERROR_NO_CONTENT');

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
      
      graphStreamDetectedRef.current = false;
      await tutorRef.current.chat(fullPrompt, {
        studentName: settings.studentName || 'Student',
        topicId: selectedTopic,
        previousMistakes: mistakes.slice(-5),
        gradingResult,
        aiMode,
      }, {
        onToken: (token) => {
          streamingBufferRef.current += token;
          setStreamingText((prev) => prev + token);

          if (!graphStreamDetectedRef.current
            && streamingBufferRef.current.includes('[GRAPH:')
            && streamingBufferRef.current.includes(']')) {
            const graphResult = buildGraphFromAssistantText(streamingBufferRef.current);
            if (graphResult) {
              setChartData(graphResult.data);
              setChartEquation(graphResult.equation);
              graphStreamDetectedRef.current = true;
            }
          }
        },
        onDone: async (fullText, meta = {}) => {
          const finalText = finalizeAssistantText(fullText);
          if (!finalText) {
            setStreamingText('');
            streamingBufferRef.current = '';
            return;
          }

          const assistantMsg = { role: 'assistant', content: finalText, id: Date.now() + 1 };
          
          const graphResult = buildGraphFromAssistantText(finalText);
          if (graphResult) {
            setChartData(graphResult.data);
            setChartEquation(graphResult.equation);
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
          streamingBufferRef.current = '';
          if (activeSessionId && !(isEphemeralMode || isEphemeralSessionId(activeSessionId))) {
            try {
              await saveChatMessage({ role: 'assistant', content: finalText, sessionId: activeSessionId });
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
          if (meta.aborted) {
            showToast('Response stopped. Partial answer saved.', 2600);
          }
        },
        onError: (err) => {
          const msg = String(err?.message || '');
          const isAborted = err?.name === 'AbortError'
            || msg.toLowerCase().includes('aborted')
            || msg.toLowerCase().includes('abort');

          if (isAborted) {
            const partial = finalizeAssistantText(streamingBufferRef.current);
            if (partial) {
              setMessages((prev) => [...prev, {
                role: 'assistant',
                content: partial,
                id: Date.now() + 1,
              }]);
            }
            setStreamingText('');
            streamingBufferRef.current = '';
            showToast('Response stopped. Partial answer saved.', 2600);
            return;
          }

          setStreamingText('');
          streamingBufferRef.current = '';
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
      streamingBufferRef.current = '';
      setMessages((prev) => [...prev, { 
        role: 'assistant', 
        content: "Something went wrong processing that image. Let's try again.",
        id: Date.now()
      }]);
    } finally {
      setIsProcessingImage(false);
    }
  }, [analyzeImage, settings.aiMode, settings.ollamaUrl, activeSessionId, selectedTopic, gradingResult, refreshData, aiMode, isEphemeralMode, switchToEphemeralMode, isStreaming, isProcessingImage, showToast]);

  // ── Topic Selection ──
  const handleTopicSelect = useCallback((topicId) => {
    setSelectedTopic(topicId);
    navigateToView('chat');
    handleSend(`I want to learn about ${topicId.replace(/-/g, ' ')}. Let's start!`);
  }, [handleSend, navigateToView]);

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
            navigateToView(view);
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
            navigateToView('chat');
          }}
          onSelectSession={(id) => {
            setActiveSessionId(id);
            navigateToView('chat');
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
          <div className="workflow-strip" role="group" aria-label="Workflow presets">
            <button
              className="workflow-pill command-launcher"
              onClick={() => setIsCommandPaletteOpen(true)}
              title="Open command palette"
            >
              ⌘K
            </button>
            {WORKFLOW_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={`workflow-pill ${activeWorkflowId === preset.id ? 'active' : ''}`}
                onClick={() => runWorkflowPreset(preset.id)}
                title={preset.description}
              >
                <span>{preset.icon}</span>
                <span>{preset.label}</span>
              </button>
            ))}
            <span className="workflow-status">{workflowStatus}</span>
          </div>
          <LevelBadge levelInfo={levelInfo} />
        </div>

        {coachNudge && (
          <div className="coach-nudge">
            <span>{coachNudge}</span>
            <button
              className="coach-nudge-btn"
              onClick={() => runWorkflowPreset('recover')}
            >
              Run recovery flow
            </button>
            <button className="coach-nudge-dismiss" onClick={() => setCoachNudge('')}>Dismiss</button>
          </div>
        )}

        <div className={`workspace-view-stage ${viewPhase}`}>
          {displayView === 'map' && (
            <React.Suspense fallback={VIEW_LOADER}>
              <TopicMap selectedTopic={selectedTopic} onSelectTopic={handleTopicSelect} />
            </React.Suspense>
          )}

          {displayView === 'plan' && (
            <React.Suspense fallback={VIEW_LOADER}>
              <PlanView onSendToChat={(text) => { navigateToView('chat'); handleSend(text); }} />
            </React.Suspense>
          )}

          {displayView === 'quiz' && (
            <React.Suspense fallback={VIEW_LOADER}>
              <QuizView
            topicId={selectedTopic || 'polynomials'}
            onExtractAnswerFromPhoto={async (imageFile, questionPrompt) => {
              const imagePayload = await fileToImagePayload(imageFile);
              const extractionPrompt = `You are reading a student's handwritten solution for this math question:\n${questionPrompt}\n\nReturn ONLY the student's final answer text.\n- No explanation\n- No markdown\n- If answer has multiple roots, return in one line\n- If unreadable, return UNCLEAR`;
              const extracted = await analyzeImage(imagePayload.dataUrl || imagePayload.base64, extractionPrompt);
              return String(extracted || '').trim();
            }}
            onAskAI={(data) => {
              const {
                type,
                question,
                expected,
                topic,
                difficulty,
                detectedAnswer,
                studentWork,
                whatWentWrong,
                whereLostMarks,
                marksLost,
                stepBreakdown,
              } = data;
              let prompt = '';
              
              if (type === 'quiz_doubt') {
                prompt = `I just completed a quiz on ${topic}. I have some doubts and questions about the topics covered. Can you help me understand the concepts better?`;
              } else if (type === 'solve') {
                const stepBreakdownText = Array.isArray(stepBreakdown) && stepBreakdown.length > 0
                  ? stepBreakdown
                    .map((step, idx) => {
                      const stepNumber = Number.isFinite(Number(step?.step)) ? Number(step.step) : (idx + 1);
                      const line = String(step?.studentLine || '').trim() || '[empty OCR line]';
                      const status = String(step?.status || 'partial').trim().toLowerCase();
                      const loss = Number.isFinite(Number(step?.marksLost)) ? Number(step.marksLost) : 0;
                      const note = String(step?.note || '').trim();
                      return `Step ${stepNumber}: ${line} | status=${status} | marksLost=${loss}${note ? ` | note=${note}` : ''}`;
                    })
                    .join('\n')
                  : 'Not provided';

                prompt = `I got this long-answer question wrong from my uploaded photo:\n\nQuestion: ${question}\n\nDetected answer from photo: ${detectedAnswer || 'UNCLEAR'}\nMy uploaded work (OCR): ${studentWork || 'Not available'}\nExpected answer: ${expected}\nDifficulty: ${difficulty}\nMarks lost: ${Number.isFinite(Number(marksLost)) ? marksLost : 'unknown'}\n\nStep-by-step OCR with mark deductions:\n${stepBreakdownText}\n\nWhat went wrong in my steps: ${whatWentWrong || 'Not provided'}\nWhere marks were lost: ${whereLostMarks || 'Not provided'}\n\nPlease explain step-by-step where my method broke and how to avoid this mistake next time.`;
              }
              
              navigateToView('chat');
              handleSend(prompt);
            }}
            onAnalyzeLongAnswerPhoto={async (imageFile, question) => {
              const gradingPrompt = [
                'You are a strict math examiner grading a single long-answer response out of 5 marks.',
                `Question: ${question?.prompt || ''}`,
                `Expected final answer: ${question?.expected || ''}`,
                'Read the handwritten solution in the image and detect where the student made a mistake.',
                'Return ONLY valid JSON (no markdown, no extra text) with this exact schema:',
                '{',
                '  "finalAnswer": "string",',
                '  "studentWork": "string",',
                '  "isCorrect": true,',
                '  "score": 0,',
                '  "whatWentWrong": "1-2 lines describing the wrong step",',
                '  "whereLostMarks": "1-2 lines describing the mark deduction points",',
                '  "stepBreakdown": [',
                '    { "step": 1, "studentLine": "string", "status": "correct", "marksLost": 0, "note": "string" }',
                '  ]',
                '}',
                'Rules:',
                '- score must be an integer from 0 to 5',
                '- studentWork must contain the full OCR transcription line-by-line (do not summarize)',
                '- stepBreakdown should cover the major lines from studentWork in order',
                '- whereLostMarks must reference the step numbers where deductions happened',
                '- status must be one of: correct, partial, incorrect, unreadable',
                '- if text is unreadable, set finalAnswer to UNCLEAR, set isCorrect to false, and set score to 0',
              ].join('\n');

              const expectedAnswer = String(question?.expected || '').trim();
              const resolvedOllamaUrl = String(settings.ollamaUrl || '').trim() || getDefaultOllamaProxyUrl();
              const isProxyOllamaUrl = /\/api\/proxy\/ollama\/chat/i.test(resolvedOllamaUrl) || resolvedOllamaUrl.startsWith('/');
              const imageMeta = {
                fileName: String(imageFile?.name || ''),
                mimeType: String(imageFile?.type || ''),
                sizeBytes: Number(imageFile?.size || 0),
                visionTransport: isProxyOllamaUrl ? 'offline-ollama-proxy' : 'offline-ollama-direct',
                visionEndpoint: resolvedOllamaUrl,
                aiModeAtCall: aiMode,
                ocrModel: 'minicpm-v',
                graderModel: String(settings.ollamaModel || 'deepseek-r1:7b'),
              };

              const normalizeForCompare = (value) => String(value || '')
                .toLowerCase()
                .replace(/\$+/g, '')
                .replace(/\s+/g, '')
                .trim();

              const isUnclearAnswerText = (value) => {
                const text = String(value || '').trim().toLowerCase();
                return (
                  isLowConfidenceOcrText(text)
                  || text.includes('estimated')
                  || text.includes('(demo)')
                );
              };

              const deriveFinalAnswerFromWork = (workText = '') => {
                const lines = String(workText || '')
                  .replace(/\r\n/g, '\n')
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean);

                if (lines.length === 0) return '';

                const lastMeaningful = [...lines].reverse().find((line) => {
                  const lower = line.toLowerCase();
                  if (lower.startsWith('step ')) return false;
                  if (lower.includes('[demo ocr]')) return false;
                  return true;
                });

                return String(lastMeaningful || lines[lines.length - 1] || '').trim();
              };

              const getTranscriptLines = (workText = '') => String(workText || '')
                .replace(/\r\n/g, '\n')
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .filter((line) => {
                  const lower = line.toLowerCase();
                  if (lower === 'unclear') return false;
                  if (isLowConfidenceOcrText(lower)) return false;
                  if (lower.includes('[demo ocr]')) return false;
                  return true;
                });

              const cleanAnswerCandidate = (candidate = '') => String(candidate || '')
                .replace(/^[-*•]\s*/, '')
                .replace(/^(?:final\s*answer|answer)\s*[:=]\s*/i, '')
                .replace(/^\(+|\)+$/g, '')
                .trim();

              const inferFinalAnswerFromTranscript = (workText = '') => {
                const lines = getTranscriptLines(workText);
                if (lines.length === 0) return '';

                for (let i = lines.length - 1; i >= 0; i -= 1) {
                  const line = lines[i];
                  const tagged = line.match(/(?:final\s*answer|answer)\s*[:=]\s*(.+)$/i);
                  if (tagged?.[1]) {
                    const cleaned = cleanAnswerCandidate(tagged[1]);
                    if (cleaned && !isUnclearAnswerText(cleaned)) return cleaned;
                  }
                }

                for (let i = lines.length - 1; i >= 0; i -= 1) {
                  const line = lines[i];
                  const eqIdx = line.lastIndexOf('=');
                  if (eqIdx >= 0 && eqIdx < line.length - 1) {
                    const rhs = cleanAnswerCandidate(line.slice(eqIdx + 1));
                    if (rhs && !isUnclearAnswerText(rhs)) return rhs;
                  }
                }

                const fallback = cleanAnswerCandidate(lines[lines.length - 1] || '');
                return isUnclearAnswerText(fallback) ? '' : fallback;
              };

              const buildDemoStepBreakdown = (ocrText = '') => {
                const lines = String(ocrText || '')
                  .replace(/\r\n/g, '\n')
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean);

                if (lines.length > 0) {
                  return lines.map((line, idx) => {
                    const isLast = idx === lines.length - 1;
                    return {
                      step: idx + 1,
                      studentLine: line,
                      status: isLast ? 'incorrect' : 'partial',
                      marksLost: isLast ? 3 : 0,
                      note: isLast
                        ? (expectedAnswer ? `Final line could not be verified against ${expectedAnswer}.` : 'Final line could not be verified clearly.')
                        : 'Extracted from OCR; minor ambiguity remains.',
                    };
                  });
                }

                return [
                  {
                    step: 1,
                    studentLine: '[OCR] Handwritten steps could not be read clearly from the uploaded image.',
                    status: 'unreadable',
                    marksLost: 5,
                    note: 'Upload a clearer photo (good lighting, full page in frame, no blur) for accurate grading.',
                  },
                ];
              };

              const buildDemoFinalAnswer = (ocrText = '') => {
                const lines = String(ocrText || '')
                  .replace(/\r\n/g, '\n')
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean);

                if (lines.length > 0) {
                  const tail = lines[lines.length - 1];
                  return tail.length > 72 ? `${tail.slice(0, 69)}...` : tail;
                }

                return 'UNCLEAR';
              };

              const attachDebugPayload = (analysis, debugInfo = {}) => {
                if (!analysis || typeof analysis !== 'object') return analysis;
                const existingDebug = analysis._debug && typeof analysis._debug === 'object'
                  ? analysis._debug
                  : {};

                return {
                  ...analysis,
                  _debug: {
                    ...existingDebug,
                    ...debugInfo,
                  },
                };
              };

              const toStepEntries = (rawStepBreakdown) => {
                if (Array.isArray(rawStepBreakdown)) return rawStepBreakdown;
                if (rawStepBreakdown === null || rawStepBreakdown === undefined) return [];

                if (typeof rawStepBreakdown === 'string') {
                  const trimmed = rawStepBreakdown.trim();
                  if (!trimmed) return [];

                  try {
                    const parsed = JSON.parse(trimmed);
                    return toStepEntries(parsed);
                  } catch {
                    // Not JSON, treat as plain text lines.
                  }

                  return trimmed
                    .replace(/\r\n/g, '\n')
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line, index) => ({ step: index + 1, studentLine: line }));
                }

                if (typeof rawStepBreakdown === 'object') {
                  const nestedArrays = [
                    rawStepBreakdown.stepBreakdown,
                    rawStepBreakdown.steps,
                    rawStepBreakdown.stepResults,
                    rawStepBreakdown.lines,
                    rawStepBreakdown.items,
                    rawStepBreakdown.entries,
                  ];

                  for (const candidate of nestedArrays) {
                    if (Array.isArray(candidate)) return candidate;
                  }

                  const singletonLine = String(
                    rawStepBreakdown.studentLine
                    || rawStepBreakdown.line
                    || rawStepBreakdown.stepText
                    || rawStepBreakdown.text
                    || rawStepBreakdown.content
                    || rawStepBreakdown.ocrLine
                    || rawStepBreakdown.extractedLine
                    || ''
                  ).trim();

                  if (singletonLine) return [rawStepBreakdown];
                }

                return [];
              };

              const extractParsedStudentWork = (parsed, fallback = '') => {
                if (!parsed || typeof parsed !== 'object') return String(fallback || '').trim();

                const direct = String(
                  parsed.studentWork
                  ?? parsed.detectedWork
                  ?? parsed.ocrText
                  ?? parsed.fullText
                  ?? parsed.transcript
                  ?? parsed.solutionText
                  ?? parsed.text
                  ?? ''
                ).trim();

                if (direct) return direct;

                const fromStepEntries = toStepEntries(
                  parsed.stepBreakdown
                  ?? parsed.steps
                  ?? parsed.stepResults
                  ?? parsed.lines
                )
                  .map((entry) => {
                    if (typeof entry === 'string') return entry.trim();
                    if (!entry || typeof entry !== 'object') return '';
                    return String(
                      entry.studentLine
                      || entry.line
                      || entry.stepText
                      || entry.text
                      || entry.content
                      || entry.ocrLine
                      || entry.extractedLine
                      || ''
                    ).trim();
                  })
                  .filter(Boolean);

                if (fromStepEntries.length > 0) {
                  return fromStepEntries.join('\n');
                }

                return String(fallback || '').trim();
              };

              const applyTranscriptHeuristics = (analysis, transcriptText = '') => {
                if (!analysis || typeof analysis !== 'object') return analysis;

                const transcript = String(transcriptText || analysis.studentWork || '').trim();
                const normalizedTranscript = normalizeForCompare(transcript);
                const normalizedExpected = normalizeForCompare(expectedAnswer);
                const transcriptContainsExpected = Boolean(normalizedExpected)
                  && normalizedExpected.length >= 3
                  && normalizedTranscript.includes(normalizedExpected);

                const inferredFinal = transcriptContainsExpected
                  ? expectedAnswer
                  : inferFinalAnswerFromTranscript(transcript);

                if (!inferredFinal || isUnclearAnswerText(inferredFinal)) return analysis;

                const inferredCorrect = transcriptContainsExpected
                  || (Boolean(expectedAnswer)
                    && normalizeForCompare(inferredFinal) === normalizeForCompare(expectedAnswer));

                const existingSteps = toStepEntries(analysis.stepBreakdown);
                const transcriptSteps = getTranscriptLines(transcript).map((line, idx) => ({
                  step: idx + 1,
                  studentLine: line,
                  status: inferredCorrect ? 'correct' : 'partial',
                  marksLost: inferredCorrect ? 0 : (idx === 0 ? 3 : 0),
                  note: inferredCorrect ? 'Verified from OCR transcript.' : 'Extracted from OCR transcript; final line did not match expected answer.',
                }));

                if (inferredCorrect) {
                  return {
                    ...analysis,
                    finalAnswer: inferredFinal,
                    studentWork: transcript || String(analysis.studentWork || '').trim(),
                    isCorrect: true,
                    score: 5,
                    whatWentWrong: 'Transcript final line matches the expected answer.',
                    whereLostMarks: 'No marks were deducted.',
                    stepBreakdown: existingSteps.length > 0
                      ? existingSteps.map((step, idx) => ({
                        step: Number.isFinite(Number(step?.step)) ? Number(step.step) : (idx + 1),
                        studentLine: String(step?.studentLine || '').trim(),
                        status: 'correct',
                        marksLost: 0,
                        note: String(step?.note || '').trim() || 'Verified from OCR transcript.',
                      }))
                      : transcriptSteps,
                  };
                }

                const currentFinal = String(analysis.finalAnswer || '').trim();
                if (isUnclearAnswerText(currentFinal)) {
                  const numericScore = Number(analysis.score);
                  const score = Number.isFinite(numericScore)
                    ? Math.max(2, Math.min(5, Math.round(numericScore)))
                    : 2;

                  return {
                    ...analysis,
                    finalAnswer: inferredFinal,
                    studentWork: transcript || String(analysis.studentWork || '').trim(),
                    score,
                    isCorrect: false,
                    whatWentWrong: String(analysis.whatWentWrong || '').trim()
                      || 'OCR extracted a plausible final line, but it did not match the expected answer.',
                    whereLostMarks: String(analysis.whereLostMarks || '').trim()
                      || 'Marks were deducted because the extracted final line did not match the expected answer.',
                    stepBreakdown: existingSteps.length > 0 ? existingSteps : transcriptSteps,
                  };
                }

                return analysis;
              };

              const coerceDemoAggressiveAnalysis = (analysis, sourceText = '') => {
                const base = (analysis && typeof analysis === 'object') ? analysis : {};
                const scoreRaw = Number(base.score);
                const score = Number.isFinite(scoreRaw)
                  ? Math.max(2, Math.min(4, Math.round(scoreRaw)))
                  : 2;

                let stepBreakdown = toStepEntries(
                  base.stepBreakdown
                  ?? base.steps
                  ?? base.stepResults
                  ?? base.lines
                )
                    .map((step, idx) => {
                      if (typeof step === 'string') {
                        const line = step.trim();
                        if (!line) return null;
                        return {
                          step: idx + 1,
                          studentLine: line,
                          status: 'partial',
                          marksLost: 0,
                          note: '',
                        };
                      }

                      if (!step || typeof step !== 'object') return null;

                      return {
                        step: Number.isFinite(Number(step.step ?? step.stepNumber ?? step.index ?? step.id))
                          ? Math.max(1, Math.round(Number(step.step ?? step.stepNumber ?? step.index ?? step.id)))
                          : (idx + 1),
                        studentLine: String(
                          step.studentLine
                          || step.line
                          || step.stepText
                          || step.text
                          || step.content
                          || step.ocrLine
                          || step.extractedLine
                          || ''
                        ).trim(),
                        status: String(step.status || step.result || step.grade || 'partial').trim().toLowerCase() || 'partial',
                        marksLost: Number.isFinite(Number(step.marksLost ?? step.markLoss ?? step.deduction ?? step.loss ?? step.marksDeducted))
                          ? Math.max(0, Math.min(5, Math.round(Number(step.marksLost ?? step.markLoss ?? step.deduction ?? step.loss ?? step.marksDeducted))))
                          : 0,
                        note: String(step.note || step.feedback || step.reason || step.comment || '').trim(),
                      };
                    })
                    .filter((step) => step && step.studentLine);

                if (stepBreakdown.length === 0) {
                  const inferredSource = String(
                    base.studentWork
                    || base.detectedWork
                    || base.ocrText
                    || sourceText
                    || ''
                  ).trim();
                  stepBreakdown = buildDemoStepBreakdown(inferredSource);
                }

                const totalTargetLoss = 5 - score;
                const assignedLoss = stepBreakdown.reduce((sum, step) => sum + (Number(step.marksLost) || 0), 0);
                if (totalTargetLoss > assignedLoss && stepBreakdown.length > 0) {
                  const delta = totalTargetLoss - assignedLoss;
                  const anchor = stepBreakdown.findIndex((step) => step.status === 'incorrect' || step.status === 'unreadable');
                  const targetIndex = anchor >= 0 ? anchor : (stepBreakdown.length - 1);
                  const target = stepBreakdown[targetIndex];
                  stepBreakdown[targetIndex] = {
                    ...target,
                    status: target.status === 'correct' ? 'partial' : target.status,
                    marksLost: (Number(target.marksLost) || 0) + delta,
                    note: target.note || 'This is the main deduction point in demo-aggressive grading.',
                  };
                }

                const deductedSteps = stepBreakdown
                  .filter((step) => Number(step.marksLost) > 0)
                  .map((step) => step.step);

                const fallbackSource = String(
                  base.studentWork
                  || base.detectedWork
                  || base.ocrText
                  || sourceText
                  || ''
                ).trim();
                const rawFinalAnswer = String(
                  base.finalAnswer
                  || base.answer
                  || base.studentAnswer
                  || base.final_answer
                  || base.finalAnswerText
                  || ''
                ).trim();
                const recoveredFinalFromWork = deriveFinalAnswerFromWork(fallbackSource);
                const finalAnswer = !isUnclearAnswerText(rawFinalAnswer)
                  ? rawFinalAnswer
                  : (recoveredFinalFromWork || buildDemoFinalAnswer(fallbackSource));
                const studentWork = String(base.studentWork || '').trim() || stepBreakdown.map((step) => step.studentLine).join('\n').trim();
                const whatWentWrong = String(base.whatWentWrong || '').trim()
                  || 'Demo-aggressive grading is enabled: the image evidence is treated as uncertain, so partial credit is awarded conservatively.';
                const whereLostMarks = String(base.whereLostMarks || '').trim()
                  || (deductedSteps.length > 0
                    ? `Partial marks were awarded, but deductions were applied at step(s) ${deductedSteps.join(', ')} due to low-confidence verification.`
                    : 'Partial marks were awarded, but deductions were applied where transformations could not be fully verified from the image.');

                return {
                  finalAnswer,
                  studentWork,
                  isCorrect: false,
                  score,
                  whatWentWrong,
                  whereLostMarks,
                  stepBreakdown,
                };
              };

              const shouldKeepModelAnalysis = (analysis) => {
                if (!analysis || typeof analysis !== 'object') return false;

                const finalAnswer = String(analysis.finalAnswer || '').trim();
                const studentWork = String(analysis.studentWork || '').trim();
                const stepEntries = toStepEntries(
                  analysis.stepBreakdown
                  ?? analysis.steps
                  ?? analysis.stepResults
                  ?? analysis.lines
                );

                const hasStepText = stepEntries.some((entry) => {
                  if (typeof entry === 'string') return entry.trim().length > 0;
                  if (!entry || typeof entry !== 'object') return false;
                  return String(
                    entry.studentLine
                    || entry.line
                    || entry.stepText
                    || entry.text
                    || entry.content
                    || entry.ocrLine
                    || entry.extractedLine
                    || ''
                  ).trim().length > 0;
                });

                const scoreNum = Number(analysis.score);
                const modelMarkedCorrect = analysis.isCorrect === true || (Number.isFinite(scoreNum) && scoreNum >= 5);
                const hasStrongEvidence = studentWork.length >= 20 || hasStepText;
                const looksDemoSynthetic = /\[demo ocr\]|\(demo\)|estimated\s+answer/i.test(`${finalAnswer}\n${studentWork}`);
                const recoveredFinal = !isUnclearAnswerText(finalAnswer)
                  ? finalAnswer
                  : deriveFinalAnswerFromWork(studentWork);
                const finalLooksClear = recoveredFinal
                  && !/estimated\s+around|estimated\s+answer/i.test(recoveredFinal.toLowerCase());
                const inferredCorrectFromFinal = Boolean(expectedAnswer)
                  && Boolean(recoveredFinal)
                  && normalizeForCompare(recoveredFinal) === normalizeForCompare(expectedAnswer);

                if (looksDemoSynthetic) return false;
                if (modelMarkedCorrect && hasStrongEvidence) return true;
                if (inferredCorrectFromFinal && hasStrongEvidence) return true;
                if (hasStrongEvidence && finalLooksClear) return true;
                return false;
              };

              const buildDemoFallbackAnalysis = (ocrText = '') => {
                const stepBreakdown = buildDemoStepBreakdown(ocrText);
                const studentWork = stepBreakdown.map((step) => step.studentLine).join('\n').trim();
                const finalAnswer = buildDemoFinalAnswer(ocrText);
                const deductedSteps = stepBreakdown.filter((step) => Number(step.marksLost) > 0).map((step) => step.step);

                const fallback = {
                  finalAnswer,
                  studentWork,
                  isCorrect: false,
                  score: 0,
                  whatWentWrong: 'OCR confidence is too low to verify the student steps reliably.',
                  whereLostMarks: deductedSteps.length > 0
                    ? `Most marks were deducted at step(s) ${deductedSteps.join(', ')} where the transformation/final verification was unclear.`
                    : 'Most marks were deducted where the method could not be verified from OCR.',
                  stepBreakdown,
                };

                const transcriptRefined = applyTranscriptHeuristics(fallback, ocrText);

                return DEMO_AGGRESSIVE_LONG_ANSWER
                  ? coerceDemoAggressiveAnalysis(transcriptRefined, ocrText)
                  : transcriptRefined;
              };

              const enrichParsedAnalysis = (parsed, ocrText = '') => {
                if (!parsed || typeof parsed !== 'object') {
                  return buildDemoFallbackAnalysis(ocrText);
                }

                const parsedStudentWork = extractParsedStudentWork(parsed, ocrText);
                const parsedStepBreakdown = toStepEntries(
                  parsed.stepBreakdown
                  ?? parsed.steps
                  ?? parsed.stepResults
                  ?? parsed.lines
                );

                const parsedFinalRaw = String(
                  parsed.finalAnswer
                  ?? parsed.answer
                  ?? parsed.studentAnswer
                  ?? parsed.final_answer
                  ?? parsed.finalAnswerText
                  ?? ''
                ).trim();

                const recoveredFinalFromWork = deriveFinalAnswerFromWork(parsedStudentWork || ocrText);
                const resolvedFinalAnswer = !isUnclearAnswerText(parsedFinalRaw)
                  ? parsedFinalRaw
                  : recoveredFinalFromWork;

                const inferredCorrectFromFinal = Boolean(expectedAnswer)
                  && Boolean(resolvedFinalAnswer)
                  && normalizeForCompare(resolvedFinalAnswer) === normalizeForCompare(expectedAnswer);

                const demo = buildDemoFallbackAnalysis(
                  parsedStudentWork || ocrText
                );

                const parsedScore = Number(parsed.score);
                const parsedIsCorrect = typeof parsed.isCorrect === 'boolean' ? parsed.isCorrect : false;
                const resolvedIsCorrect = parsedIsCorrect || inferredCorrectFromFinal;
                const resolvedScore = Number.isFinite(parsedScore)
                  ? Math.max(0, Math.min(5, Math.round(parsedScore)))
                  : (resolvedIsCorrect ? 5 : demo.score);

                const normalized = {
                  finalAnswer: resolvedFinalAnswer || demo.finalAnswer,
                  studentWork: parsedStudentWork || demo.studentWork,
                  isCorrect: resolvedIsCorrect || demo.isCorrect,
                  score: resolvedScore,
                  whatWentWrong: String(parsed.whatWentWrong || parsed.stepError || '').trim() || demo.whatWentWrong,
                  whereLostMarks: String(parsed.whereLostMarks || parsed.markDeduction || '').trim() || demo.whereLostMarks,
                  stepBreakdown: parsedStepBreakdown.length > 0 ? parsedStepBreakdown : demo.stepBreakdown,
                };

                const transcriptRefined = applyTranscriptHeuristics(normalized, parsedStudentWork || ocrText);

                if (shouldKeepModelAnalysis(transcriptRefined)) {
                  return transcriptRefined;
                }

                return DEMO_AGGRESSIVE_LONG_ANSWER
                  ? coerceDemoAggressiveAnalysis(transcriptRefined, ocrText)
                  : transcriptRefined;
              };

              let extractedText = '';
              let localRaw = '';
              let repairRaw = '';
              let offlineTextModelInput = '';
              let ocrAttemptTrace = [];
              let ocrSource = 'none';

              const questionId = String(question?.id || '').trim() || 'unknown';
              const boundPrompt = String(question?.prompt || '').trim() || 'No question text provided';
              const boundExpected = expectedAnswer || 'No expected answer provided';
              const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
              const allowOnlineVision = isOnline && settings.aiMode !== 'offline';
              const preferLocalGrading = !allowOnlineVision;

              // Stage 1A: online vision OCR (same family of path as normal chat image flow).
              if (allowOnlineVision) {
                try {
                  const imagePayload = await fileToImagePayload(imageFile);
                  const onlinePrompt = `${OCR_STRICT_TRANSCRIBE_PROMPT}\n\nContext question:\n${boundPrompt}\n\nReturn only the transcription text.`;
                  const onlineExtract = String(
                    await analyzeImage(imagePayload.dataUrl || imagePayload.base64, onlinePrompt)
                  ).trim();

                  const onlineLowConfidence = isLowConfidenceOcrText(onlineExtract);
                  ocrAttemptTrace.push({
                    label: 'azure-online',
                    promptMode: 'strict-transcribe',
                    text: onlineExtract,
                    lowConfidence: onlineLowConfidence,
                  });

                  if (onlineExtract && !onlineLowConfidence) {
                    extractedText = onlineExtract;
                    ocrSource = 'azure-online';
                  } else if (onlineExtract && !extractedText) {
                    extractedText = onlineExtract;
                    ocrSource = 'azure-online-low';
                  }
                } catch (err) {
                  ocrAttemptTrace.push({
                    label: 'azure-online',
                    promptMode: 'strict-transcribe',
                    text: '',
                    lowConfidence: true,
                    error: String(err?.message || err || 'Online OCR failed'),
                  });
                }
              }

              // Stage 1B: local minicpm-v OCR retries as fallback and tie-breaker.
              try {
                const offlineExtract = await extractMathWithRetries(imageFile, { ollamaUrl: settings.ollamaUrl });
                const localText = String(offlineExtract?.text || '').trim();
                const localAttempts = Array.isArray(offlineExtract?.attempts) ? offlineExtract.attempts : [];
                ocrAttemptTrace = [...ocrAttemptTrace, ...localAttempts];

                const localLowConfidence = isLowConfidenceOcrText(localText);
                const currentLowConfidence = isLowConfidenceOcrText(extractedText);

                // Prefer local transcript only when it is clearly stronger than the current candidate.
                if (localText && (!extractedText || (currentLowConfidence && !localLowConfidence))) {
                  extractedText = localText;
                  ocrSource = String(offlineExtract?.source || 'local-unknown');
                } else if (!ocrSource && localText) {
                  ocrSource = String(offlineExtract?.source || 'local-unknown');
                }
              } catch (err) {
                console.warn('[MathWorkspace] Long-answer OCR extraction failed:', err?.message || err);
              }

              if (!extractedText) {
                const fallback = buildDemoFallbackAnalysis('');
                return attachDebugPayload(
                  {
                    ...fallback,
                    studentWork: fallback.studentWork,
                  },
                  {
                    source: 'offline',
                    branch: 'minicpmv-ocr-unreadable',
                    rawModelResponseText: '',
                    parsedModelResponse: null,
                    extractedText: extractedText || '',
                    visionPromptText: VISION_REQUEST_PROMPT,
                    textModelInput: '',
                    ocrSource,
                    ocrAttempts: ocrAttemptTrace,
                    imageMeta: {
                      ...imageMeta,
                      questionId,
                      questionPrompt: boundPrompt,
                      expectedAnswer: boundExpected,
                    },
                  }
                );
              }

              try {
                const lowConfidenceTranscript = isLowConfidenceOcrText(extractedText);
                const transcript = extractedText || 'UNREADABLE';

                const offlineMessages = [
                  {
                    role: 'system',
                    content: lowConfidenceTranscript
                      ? 'You are a strict math examiner. The OCR transcript may be noisy. Use any visible mathematical content to extract the most likely final answer and step lines; if still impossible, return UNCLEAR. Return ONLY valid JSON with keys: finalAnswer, studentWork, isCorrect, score, whatWentWrong, whereLostMarks, stepBreakdown. No markdown and no extra text.'
                      : 'You are a strict math examiner. Grade ONLY from the provided OCR transcript and question binding. Return ONLY valid JSON with keys: finalAnswer, studentWork, isCorrect, score, whatWentWrong, whereLostMarks, stepBreakdown. No markdown and no extra text.',
                  },
                  {
                    role: 'user',
                    content: `${gradingPrompt}\n\nQuestion binding:\n- Question ID: ${questionId}\n- Question text: ${boundPrompt}\n- Expected final answer: ${boundExpected}\n\nOCR transcript from minicpm-v (grade only from this transcript):\n${transcript}`,
                  },
                ];
                offlineTextModelInput = String(offlineMessages?.[1]?.content || '');

                localRaw = await streamChat(offlineMessages, {
                  temperature: 0.1,
                  maxTokens: 700,
                  preferLocal: preferLocalGrading,
                });

                const localParsed = parseJsonObjectFromText(localRaw);
                if (localParsed) {
                  const normalized = enrichParsedAnalysis(localParsed, extractedText);
                  // Keep grader anchored to the exact minicpm-v transcript for downstream review/debug.
                  const pinnedTranscript = extractedText || String(normalized.studentWork || '').trim();

                  return attachDebugPayload(
                    {
                      ...normalized,
                      studentWork: pinnedTranscript,
                    },
                    {
                      source: 'offline',
                      branch: 'minicpmv-to-deepseek-parsed',
                      rawModelResponseText: String(localRaw || ''),
                      parsedModelResponse: localParsed,
                      extractedText: extractedText || '',
                      visionPromptText: VISION_REQUEST_PROMPT,
                      textModelInput: offlineTextModelInput,
                      ocrSource,
                      ocrAttempts: ocrAttemptTrace,
                      imageMeta: {
                        ...imageMeta,
                        questionId: String(question?.id || ''),
                        questionPrompt: boundPrompt,
                        expectedAnswer: boundExpected,
                      },
                    }
                  );
                }

                // If the grader emits non-JSON text, run one repair pass to coerce strict JSON.
                const repairMessages = [
                  {
                    role: 'system',
                    content: 'Convert the provided grading output into strict JSON only. Return ONLY valid JSON with keys: finalAnswer, studentWork, isCorrect, score, whatWentWrong, whereLostMarks, stepBreakdown. No markdown, no commentary.',
                  },
                  {
                    role: 'user',
                    content: `Question: ${boundPrompt}\nExpected final answer: ${boundExpected}\nOCR transcript:\n${transcript}\n\nRaw grader output to convert:\n${String(localRaw || '').trim() || '[empty]'}`,
                  },
                ];

                repairRaw = await streamChat(repairMessages, {
                  temperature: 0,
                  maxTokens: 500,
                  preferLocal: preferLocalGrading,
                });

                const repairedParsed = parseJsonObjectFromText(repairRaw);
                if (repairedParsed) {
                  const normalized = enrichParsedAnalysis(repairedParsed, extractedText);
                  const pinnedTranscript = extractedText || String(normalized.studentWork || '').trim();

                  return attachDebugPayload(
                    {
                      ...normalized,
                      studentWork: pinnedTranscript,
                    },
                    {
                      source: 'offline',
                      branch: 'minicpmv-to-deepseek-repaired',
                      rawModelResponseText: String(localRaw || ''),
                      repairedModelResponseText: String(repairRaw || ''),
                      parsedModelResponse: repairedParsed,
                      extractedText: extractedText || '',
                      visionPromptText: VISION_REQUEST_PROMPT,
                      textModelInput: offlineTextModelInput,
                      ocrSource,
                      ocrAttempts: ocrAttemptTrace,
                      gradingRoutePreference: preferLocalGrading ? 'local' : 'online',
                      imageMeta: {
                        ...imageMeta,
                        questionId: String(question?.id || ''),
                        questionPrompt: boundPrompt,
                        expectedAnswer: boundExpected,
                      },
                    }
                  );
                }
              } catch (err) {
                console.warn('[MathWorkspace] DeepSeek long-answer grading parse failed:', err?.message || err);
              }

              const fallback = buildDemoFallbackAnalysis(extractedText);
              return attachDebugPayload(
                {
                  ...fallback,
                  studentWork: extractedText || fallback.studentWork,
                },
                {
                  source: 'offline',
                  branch: 'minicpmv-to-deepseek-fallback',
                  rawModelResponseText: String(localRaw || ''),
                  repairedModelResponseText: String(repairRaw || ''),
                  parsedModelResponse: null,
                  extractedText: extractedText || '',
                  visionPromptText: VISION_REQUEST_PROMPT,
                  textModelInput: offlineTextModelInput,
                  ocrSource,
                  ocrAttempts: ocrAttemptTrace,
                  gradingRoutePreference: preferLocalGrading ? 'local' : 'online',
                  imageMeta: {
                    ...imageMeta,
                    questionId: String(question?.id || ''),
                    questionPrompt: String(question?.prompt || ''),
                    expectedAnswer,
                  },
                }
              );
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
              const solveFeedback = solveRatio >= 0.8 ? 'Excellent solving accuracy.' : 'Review the solving steps for improvement.';

              const nextResult = {
                topicId,
                quizMode,
                score,
                maxScore,
                percentage,
                stepResults,
                feedback: `Quiz result: ${score}/${maxScore}. ${solveFeedback}`,
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
              if (percentage < 70) {
                setCoachNudge(`Your last score in ${getTopic(topicId)?.label || topicId} was ${percentage}%. Run Mistake Recovery for a targeted rebound.`);
                setWorkflowStatus('Recovery recommended');
              } else if (percentage >= 85) {
                setCoachNudge(`Strong work: ${percentage}% in ${getTopic(topicId)?.label || topicId}. Try Exam Sprint to lock consistency.`);
                setWorkflowStatus('Progress accelerating');
              }
              try {
                await refreshData();
              } catch {
                // Non-blocking refresh failure
              }

              showToast(`Quiz submitted! Score: ${score}/${maxScore} (${percentage}%)`);
              return nextResult;
            }}
              />
            </React.Suspense>
          )}

          {displayView === 'prereq' && (
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
                  navigateToView('map');
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

          {displayView === 'report' && (
            <div className="panel">
            <div className="panel-header">
              <h3>📊 My Report</h3>
              <p>View your progress report and mastery breakdown.</p>
            </div>
            <div className="panel-actions">
              <button className="panel-btn primary" onClick={() => handleQuickAction('report')} disabled={isStreaming}>
                Open report
              </button>
              <button className="panel-btn" onClick={() => navigateToView('chat')}>Go to chat</button>
            </div>
            </div>
          )}

          {displayView === 'mistakes' && (
            <React.Suspense fallback={VIEW_LOADER}>
              <MistakesPanel 
            topicId={selectedTopic || null}
            onAskAI={(mistake) => {
              const {
                problem,
                description,
                type,
                difficulty,
                topic,
                wrongOption,
                wrongOptionText,
                correctOption,
                correctOptionText,
                whyCorrect,
                howToFind,
                studentWork,
                studentAnswer,
                expectedAnswer,
              } = mistake;
              const safeProblem = String(problem || '').replace(/\s+/g, ' ').trim();
              const safeDescription = String(description || '').replace(/\s+/g, ' ').trim();
              const safeWrong = `${String(wrongOption || '').trim()} ${String(wrongOptionText || '').trim()}`.trim();
              const safeCorrect = `${String(correctOption || '').trim()} ${String(correctOptionText || '').trim()}`.trim();
              const safeWhyCorrect = String(whyCorrect || '').replace(/\s+/g, ' ').trim();
              const safeHowToFind = String(howToFind || '').replace(/\s+/g, ' ').trim();
              const safeStudentWork = String(studentWork || '').replace(/\s+/g, ' ').trim();
              const safeStudentAnswer = String(studentAnswer || '').replace(/\s+/g, ' ').trim();
              const safeExpectedAnswer = String(expectedAnswer || '').replace(/\s+/g, ' ').trim();
              let prompt = '';
              
              if (type === 'mcq') {
                prompt = `Explain this MCQ mistake clearly and concisely.\n\nQuestion: ${safeProblem}\nWrong option selected: ${safeWrong || safeDescription}\nCorrect option: ${safeCorrect || 'Not provided'}\nWhy correct option works: ${safeWhyCorrect || 'Not provided'}\nCurrent hint: ${safeHowToFind || 'Not provided'}\n\nRules:\n- Do NOT guess what the student was thinking.\n- Do NOT add fictional context or names.\n- Do NOT include self-reflection, internal reasoning, or "question for student" text.\n- Give only: correct option, why it is correct, and one short method to avoid this mistake.`;
              } else if (type === 'solve') {
                prompt = `Explain this long-answer mistake step by step.\n\nQuestion: ${safeProblem}\nMy uploaded answer (OCR): ${safeStudentWork || 'Not available'}\nDetected final answer: ${safeStudentAnswer || 'Not available'}\nExpected answer: ${safeExpectedAnswer || 'Not available'}\nMy mistake: ${safeDescription}\nDifficulty: ${difficulty}\n\nRules:\n- Do NOT guess what the student was thinking.\n- No fictional context.\n- Do NOT include self-reflection or chain-of-thought style text.\n- Keep response focused on math steps and correction only.`;
              } else {
                prompt = `Explain this mistake with only factual math guidance.\n\nQuestion: ${safeProblem}\nMistake: ${safeDescription}\n\nRules:\n- No speculative student psychology.\n- No internal reasoning text.\n- Provide direct correction steps only.`;
              }
              
              navigateToView('chat');
              handleSend(prompt);
            }}
              />
            </React.Suspense>
          )}

          {displayView === 'chat' && (
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
        </div>

        {/* Graph Panel */}
        {chartData && (
          <div className="graph-panel" ref={graphPanelRef}>
            <React.Suspense fallback={VIEW_LOADER}>
              <GraphPlotter
                chartData={chartData}
                equation={chartEquation}
                onEquationChange={(nextEquation, nextData) => {
                  setChartEquation(nextEquation);
                  setChartData(nextData);
                }}
              />
            </React.Suspense>
            <button className="graph-close" onClick={() => setChartData(null)}>✕</button>
          </div>
        )}
      </main>

      {/* Right Sidebar — Always visible utility rail */}
      <aside className="workspace-sidebar-right">
        {(displayView === 'quiz' || gradingResult) ? (
          <React.Suspense fallback={VIEW_LOADER}>
            <MarksDashboard gradingResult={gradingResult} examHistory={examHistory} />
          </React.Suspense>
        ) : (
          <div className="side-rail">
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
              {dynamicSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  className="side-rail-btn"
                  onClick={() => handleSend(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
              <button className="side-rail-btn" onClick={() => navigateToView('map')}>Open topic map</button>
            </div>

            <div className="side-rail-card">
              <h4>Focus Sprint</h4>
              <div className="focus-timer">{focusTimeLabel}</div>
              <div className="focus-presets">
                {[5, 15, 25].map((m) => (
                  <button
                    key={m}
                    className={`focus-preset-btn ${focusMinutes === m ? 'active' : ''}`}
                    onClick={() => {
                      setFocusMinutes(m);
                      setCustomFocusMinutes(String(m));
                      setFocusRemaining(m * 60);
                      setFocusRunning(false);
                    }}
                  >
                    {m}m
                  </button>
                ))}
              </div>
              <div className="focus-custom-row">
                <input
                  className="focus-custom-input"
                  type="number"
                  min="1"
                  max="180"
                  step="1"
                  value={customFocusMinutes}
                  onChange={(e) => setCustomFocusMinutes(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyCustomSprintTimer(false);
                    }
                  }}
                  placeholder="Custom minutes"
                />
                <button className="focus-custom-btn" onClick={() => applyCustomSprintTimer(false)}>
                  Apply
                </button>
                <button className="focus-custom-btn active" onClick={() => applyCustomSprintTimer(true)}>
                  Start
                </button>
              </div>
              <div className="focus-actions">
                <button className="side-rail-btn" onClick={() => setFocusRunning((value) => !value)}>
                  {focusRunning ? 'Pause sprint' : 'Start sprint'}
                </button>
                <button
                  className="side-rail-btn"
                  onClick={() => {
                    setFocusRunning(false);
                    setFocusRemaining(focusMinutes * 60);
                  }}
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="side-rail-card">
              <h4>Learning Momentum</h4>
              <div className="momentum-row">
                <span>Momentum score</span>
                <b>{momentumScore}/100</b>
              </div>
              <div className="momentum-bar">
                <div className="momentum-fill" style={{ width: `${momentumScore}%` }} />
              </div>
              <p className="side-rail-empty">
                {momentumScore >= 75
                  ? 'You are in a strong learning rhythm. Push one hard challenge.'
                  : 'Build momentum with a warmup and one quiz cycle.'}
              </p>
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

      <WorkflowCommandPalette
        isOpen={isCommandPaletteOpen}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        commands={commandItems}
        onRun={handleCommandRun}
        onClose={() => {
          setIsCommandPaletteOpen(false);
          setCommandQuery('');
        }}
      />

      {/* Report Overlay */}
      {showReport && (
        <React.Suspense fallback={VIEW_LOADER}>
          <StudentReport report={report} onClose={() => setShowReport(false)} />
        </React.Suspense>
      )}
    </div>
  );
}
