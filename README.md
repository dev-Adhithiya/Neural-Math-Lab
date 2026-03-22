## Neural Math Lab (Hybrid AI Math Tutor)

React + Vite math tutor with:
- **Online** AI (Azure OpenAI / AI Foundry compatible endpoint) with **streaming**
- **Local** AI (Ollama) with **streaming**
- Topic navigation + **node-link Topic Map**
- Persistent **chat sessions** (IndexedDB)
- Light/Dark theme toggle
- **Security proxy backend** for model/API calls (no client-held Azure keys)
- **Policy middleware** (prompt injection filter, safety categories, blocked outputs, strict mode)
- **Retention controls** (auto-delete, export/delete, optional encrypted local state)

### Prerequisites

- **Node.js** 18+ (you have Node installed already)
- (Optional for Local AI) **Ollama** installed and running

### Install

```bash
npm install
```

### Configure env (required)

1. Copy `.env.example` to `.env`
2. Fill in your own Azure OpenAI + Azure Search (RAG) values
3. Keep keys only in `.env` (server-side)

### Run (dev, full stack)

```bash
npm run dev:full
```

This starts:
- Frontend (Vite): `http://localhost:5173`
- Backend proxy: `http://localhost:8787`

For hackathon judges cloning from GitHub, this is the recommended command.

### Build (frontend)

```bash
npm run build
npm run preview
```

### Configure AI (in-app Settings)

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

2) Pull the model:

```bash
ollama pull deepseek-r1:7b
```

3) In Settings:
- **AI Mode**: Local (Ollama)
- **Ollama URL**: `http://localhost:11434/api/generate` (or leave default)
- **Ollama model**: `deepseek-r1:7b`

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
