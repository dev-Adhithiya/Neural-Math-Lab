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
import { calculateLevel, awardParticipation, getCurrentLevel } from '../engine/GamificationEngine.js';
import { plotMathFunction, extractGraphCommands } from '../engine/DynamicGraphing.js';
import { processHandwriting } from '../vision/VisionModule.js';
import { extractMathWithMoondream, preprocessForOcr, bridgeToPhi3, classifyImageWithMoondream } from '../vision/ImageDispatcher.js';
import { TOPICS, getTopic, getPrerequisiteChain } from '../agents/KnowledgeGraph.js';
import {
  getProfile, getPrerequisiteProgress, getExamHistory,
  saveChatMessage, getMistakes,
  createChatSession, getChatSessions, getChatHistory, deleteChatSession, updateSessionTimestamp, updateSessionTitle,
} from '../store/localVault.js';

/**
 * MathWorkspace — Main application workspace.
 * Orchestrates all components: chat, topics, grading, graphing, reports.
 */
export default function MathWorkspace() {
  const { settings, updateSettings } = useSettings();

  // ── State ──
  const [messages, setMessages] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [tutorMode, setTutorMode] = useState('TEACHING');
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
  const [prereqTopicId, setPrereqTopicId] = useState('polynomials');
  const [toast, setToast] = useState('');
  const [isTutorReady, setIsTutorReady] = useState(false);

  const showToast = useCallback((message, duration = 4600) => {
    setToast(message);
    if (typeof duration === 'number' && duration > 0) {
      setTimeout(() => setToast(''), duration);
    }
  }, []);

  // ── AI Hook ──
  const { mode: aiMode, setMode: setAIModeInternal, isStreaming, streamChat, analyzeImage, routeBadge, abort } = useAI(settings);

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

        const progress = await getPrerequisiteProgress();
        const progressMap = buildProgressMap(progress);
        setAnnotatedTopics(getAnnotatedTopics(progressMap));

        const level = await getCurrentLevel();
        setLevelInfo(level);

        const examRows = await getExamHistory();
        setExamHistory(examRows.slice(0, 10));

        // DO NOT auto-generate plan on startup
        // User must explicitly ask for a plan by clicking a button

        if (!profileLoaded) {
          showToast('⚠️ Could not load profile data; running with defaults. Please check browser IndexedDB settings.');
        }
      } catch (error) {
        console.error('❌ Failed to initialize app data:', error);
        showToast('⚠️ Some data failed to load. Chat and progress may not persist in this session.');
      }
    }
    init();
  }, []);

  // Load chat history when session changes
  useEffect(() => {
    if (!activeSessionId) return;
    (async () => {
      const chatHistoryRows = await getChatHistory(activeSessionId);
      const restored = (chatHistoryRows || []).map((m) => ({ role: m.role, content: m.content, id: m.id || `${m.timestamp}-${Math.random()}` }));
      setMessages(restored);
      tutorRef.current?.resetConversation?.();
      tutorRef.current?.setConversationHistory?.(restored);
    })();
  }, [activeSessionId]);

  // ── Refresh topics and level ──
  const refreshData = useCallback(async () => {
    const progress = await getPrerequisiteProgress();
    const progressMap = buildProgressMap(progress);
    setAnnotatedTopics(getAnnotatedTopics(progressMap));
    const level = await getCurrentLevel();
    setLevelInfo(level);
    const examRows = await getExamHistory();
    setExamHistory(examRows.slice(0, 10));
  }, []);

  // ── Send message ──
  const handleSend = useCallback(async (text) => {
    const trimmed = String(text || '').trim();
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
      if (activeSessionId) {
        await saveChatMessage({ role: 'user', content: trimmed, sessionId: activeSessionId });
        await saveChatMessage({ role: 'assistant', content: assistantMsg.content, sessionId: activeSessionId });
        await updateSessionTimestamp(activeSessionId);
      }
      return;
    }

    const userMsg = { role: 'user', content: text, id: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setStreamingText('');

    if (activeSessionId) {
      await saveChatMessage({ role: 'user', content: text, sessionId: activeSessionId });
      await updateSessionTimestamp(activeSessionId);
    }

    const mistakes = await getMistakes();

    try {
      await tutorRef.current.chat(text, {
        studentName: settings.studentName || 'Student',
        topicId: selectedTopic,
        previousMistakes: mistakes.slice(-5),
        gradingResult,
      }, {
        onToken: (token) => {
          setStreamingText((prev) => prev + token);
        },
        onDone: async (fullText) => {
          const assistantMsg = { role: 'assistant', content: fullText, id: Date.now() + 1 };

          // Check for graphs
          const graphEqs = extractGraphCommands(fullText);
          if (graphEqs.length > 0) {
            const data = plotMathFunction(graphEqs[0]);
            setChartData(data);
            setChartEquation(graphEqs[0]);
          }

          // Award participation XP
          const xpResult = await awardParticipation();
          if (xpResult.leveledUp) {
            assistantMsg.xpAward = xpResult;
          }

          setMessages((prev) => [...prev, assistantMsg]);
          setStreamingText('');
          if (activeSessionId) {
            await saveChatMessage({ role: 'assistant', content: fullText, sessionId: activeSessionId });
            await updateSessionTimestamp(activeSessionId);
          }
          refreshData();
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
    }
  }, [settings.studentName, selectedTopic, gradingResult, refreshData, activeSessionId, messages.length]);

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
      
      if (activeSessionId) {
         const savedMsg = trimmed ? `${trimmed}\n\n[Image submitted]` : `[Image submitted]`;
         await saveChatMessage({ role: 'user', content: savedMsg, sessionId: activeSessionId });
         await updateSessionTimestamp(activeSessionId);
      }
      
      setStreamingText(''); // prepare for actual stream
      
      const mistakes = await getMistakes();
      
      await tutorRef.current.chat(fullPrompt, {
        studentName: settings.studentName || 'Student',
        topicId: selectedTopic,
        previousMistakes: mistakes.slice(-5),
        gradingResult,
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

          const xpResult = await awardParticipation();
          if (xpResult.leveledUp) {
            assistantMsg.xpAward = xpResult;
          }

          setMessages((prev) => [...prev, assistantMsg]);
          setStreamingText('');
          if (activeSessionId) {
            await saveChatMessage({ role: 'assistant', content: fullText, sessionId: activeSessionId });
            await updateSessionTimestamp(activeSessionId);
          }
          refreshData();
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
  }, [analyzeImage, settings.aiMode, settings.ollamaUrl, activeSessionId, selectedTopic, gradingResult, refreshData]);

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
            const id = await createChatSession();
            setChatSessions(await getChatSessions());
            setActiveSessionId(id);
            setActiveView('chat');
          }}
          onSelectSession={(id) => {
            setActiveSessionId(id);
            setActiveView('chat');
          }}
          onRenameSession={async (id, title) => {
            await updateSessionTitle(id, title);
            setChatSessions(await getChatSessions());
          }}
          onDeleteSession={async (id) => {
            await deleteChatSession(id);
            const sessions = await getChatSessions();
            setChatSessions(sessions);
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
            onSubmit={async ({ topicId, mcqScore, mcqTotal }) => {
              // Update marks with quiz results and keep in quiz view
              setGradingResult({
                score: mcqScore,
                maxScore: mcqTotal,
                percentage: Math.round((mcqScore / mcqTotal) * 100),
                stepResults: [
                  {
                    stepNumber: 1,
                    marksAwarded: mcqScore,
                    maxMarks: mcqTotal,
                    status: mcqScore / mcqTotal >= 0.8 ? 'correct' : 'partial',
                    feedback: `MCQ score: ${mcqScore}/${mcqTotal}. Good effort! Review any incorrect answers.`,
                  }
                ],
                feedback: `You scored ${mcqScore}/${mcqTotal} on the multiple choice questions. Keep practicing to improve!`,
                grade: mcqScore / mcqTotal >= 0.8 ? 'A' : mcqScore / mcqTotal >= 0.6 ? 'B' : 'C',
                mistakeTypes: [],
              });
              // Toast the result
              showToast(`Quiz submitted! Score: ${mcqScore}/${mcqTotal} (${Math.round((mcqScore / mcqTotal) * 100)}%)`);
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
          <MistakesPanel topicId={selectedTopic || null} />
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

      {/* Right Sidebar — Marks (only show in quiz view or if marks available) */}
      {(activeView === 'quiz' || gradingResult) && (
        <aside className="workspace-sidebar-right">
          <MarksDashboard gradingResult={gradingResult} examHistory={examHistory} />
        </aside>
      )}

      {/* Report Overlay */}
      {showReport && (
        <StudentReport report={report} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}
