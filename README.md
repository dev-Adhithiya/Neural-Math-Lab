## Neural Math Lab (Hybrid AI Math Tutor)

React + Vite math tutor with:
- **Online** AI (Azure OpenAI / AI Foundry compatible endpoint) with **streaming**
- **Local** AI (Ollama) with **streaming**
- Topic navigation + **node-link Topic Map**
- Persistent **chat sessions** (IndexedDB)
- Light/Dark theme toggle

### Prerequisites

- **Node.js** 18+ (you have Node installed already)
- (Optional for Local AI) **Ollama** installed and running

### Install

```bash
npm install
```

### Run (dev)

```bash
npm run dev
```

Vite will print a local URL (usually `http://localhost:5173/`). If that port is busy, it will pick the next available port.

### Build (production)

```bash
npm run build
npm run preview
```

### Configure AI (in-app Settings)

Open the app → click **⚙️ Settings**.

#### Online (Azure)

- **Azure endpoint**: `https://YOUR_RESOURCE.openai.azure.com`
- **Azure key**: your API key
- **Model deployment**: your deployment name (e.g. `gpt-4o` or `gpt-5`)

#### Local (Ollama)

1) Start Ollama:

```bash
ollama serve
```

2) Pull the model:

```bash
ollama pull phi3:mini
```

3) In Settings:
- **AI Mode**: Local (Ollama)
- **Ollama URL**: `http://localhost:11434/api/generate`
- **Ollama model**: `phi3:mini`

### (Optional) Online RAG with Azure AI Search

If you have an Azure AI Search index built from `math_textbook.pdf` chunks:
- Set **Search endpoint**, **Search key**, and **Index name** in Settings.

When online, the app will fetch top matches and include them as grounding context for Azure responses.

### Notes

- Settings and chat history are stored **locally** in your browser via **IndexedDB**.
- For a production deployment, don’t call Azure/OpenAI directly from the browser with API keys—use a backend proxy.

"# Neural-Math-Lab" 
