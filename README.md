## Neural Math Lab (Hybrid AI Math Tutor)

A comprehensive, secure, and hackathon-ready math tutoring application built with React + Vite. Features hybrid AI integration (Azure OpenAI + Ollama), multimodal agents for image-based math problem solving, persistent chat sessions, topic mapping, and robust security middleware.

### Key Features

- **Hybrid AI Integration**: Seamlessly switch between online (Azure OpenAI) and local (Ollama) AI models with streaming responses
- **Multimodal Agents**: 
  - **MiniCPM**: Advanced multimodal model for processing handwritten math problems and diagrams from images
  - **DeepSeekR1**: Specialized reasoning model for step-by-step mathematical explanations and proofs
- **Interactive UI Components**:
  - Dynamic math workspace with chat assistant
  - Topic navigation with node-link topic map
  - Quiz and plan views for structured learning
  - Student reports and mistake analysis
  - Gamification engine with levels and badges
- **Persistent Storage**: IndexedDB-based chat sessions with optional encryption and retention controls
- **Security & Governance**:
  - Backend proxy server (no client-held API keys)
  - Policy middleware with prompt injection filtering
  - Safety categories detection (violence, hate, self-harm, etc.)
  - Strict mode for enhanced content filtering
  - Auto-delete retention policies
  - Data export/delete controls
- **Vision Capabilities**: Image upload and processing for handwritten math problems
- **Agentic Architecture**: Multiple specialized agents (TutorAgent, GraderAgent, KnowledgeGraph, ProactivePlanner, StudentReportGenerator)
- **Themes**: Light/Dark mode toggle
- **Deployment Ready**: GitHub Pages compatible (build to `dist/` folder)

### Prerequisites

- **Node.js** 18+ (you have Node installed already)
- (Optional for Local AI) **Ollama** installed and running
- (Optional for Multimodal) Ollama models: `minicpm-v` and `deepseek-r1:7b`

### Install

```bash
npm install
```

### Configure Environment (Required)

1. Copy `.env.example` to `.env`
2. Fill in your own Azure OpenAI + Azure Search (RAG) values
3. Keep keys only in `.env` (server-side)

### Run (Development, Full Stack)

```bash
npm run dev:full
```

This starts:
- Frontend (Vite): `http://localhost:5173`
- Backend proxy: `http://localhost:8787`

For hackathon judges cloning from GitHub, this is the recommended command.

### Build (Frontend for Production)

```bash
npm run build
npm run preview
```

Deploy the `dist/` folder to GitHub Pages or any static hosting.

### Configure AI (In-App Settings)

Open the app → click **⚙️ Settings**.

#### Online (Azure, through backend proxy)

- Configure these in `.env` (server-side), not in browser settings:
	- `AZURE_OPENAI_ENDPOINT`
	- `AZURE_OPENAI_KEY`
	- `AZURE_OPENAI_DEPLOYMENT`

#### Local (Ollama)

1) Start Ollama:

```bash
ollama serve
```

2) Pull the models:

```bash
ollama pull minicpm-v  # For multimodal image processing
ollama pull deepseek-r1:7b  # For reasoning and explanations
```

3) In Settings:
- **AI Mode**: Local (Ollama)
- **Ollama URL**: `http://localhost:11434/api/generate` (or leave default)
- **Ollama model**: Select from `minicpm-v` (multimodal) or `deepseek-r1:7b` (reasoning)

#### Multimodal Features

- **MiniCPM Agent**: Upload images of handwritten math problems for AI analysis and step-by-step solutions
- **DeepSeekR1 Agent**: Advanced reasoning for complex proofs, algebraic manipulations, and conceptual explanations
- Switch between agents in the chat interface for different problem types

### (Optional) Online RAG with Azure AI Search

If you have an Azure AI Search index built from `math_textbook.pdf` chunks:
- Set server-side env vars:
	- `AZURE_SEARCH_ENDPOINT`
	- `AZURE_SEARCH_KEY`
	- `AZURE_SEARCH_INDEX`

When online, the app fetches top matches via proxy and includes them as grounding context for Azure responses.

## Safety, Security, and Governance

- **Prompt injection filter** in backend middleware
- **Safety categories** detection (violence, self-harm, hate, sexual, cyber abuse)
- **Blocked outputs** in strict mode for both Azure/Ollama streaming and non-streaming paths
- **Strict mode toggle** in Settings
- **Auto-delete retention** with configurable retention days
- **Data export / delete controls** in Settings
- **Optional encrypted local state** enabled by:
	- `VITE_LOCAL_VAULT_KEY` in `.env`
	- Settings toggle: "Encrypt local state"

### Notes

- Settings and chat history are stored locally and can be retention-pruned.
- Azure/OpenAI and Azure Search keys are kept server-side in `.env` and never required in frontend requests.

"# Neural-Math-Lab" 
