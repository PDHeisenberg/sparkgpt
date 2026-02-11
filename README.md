# ClawChat ⚡

Voice + Chat + Notes assistant powered by Claude & OpenAI.

## Features

- **Chat Mode** - Deep thinking with Claude Opus 4.5
- **Voice Mode** - Real-time voice with OpenAI Realtime API
- **Notes Mode** - Record audio, transcribe with Whisper, summarize with Claude

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Start server
npm run dev
```

Then open http://localhost:3456

## Architecture

```
sparkgpt/
├── public/                 # Frontend
│   ├── index.html          # Main HTML (338 lines)
│   ├── app.js              # Main app logic (3,615 lines)
│   ├── modules/            # JS modules
│   │   ├── config.js       # Configuration
│   │   ├── ui.js           # UI utilities
│   │   └── audio.js        # Audio utilities
│   └── styles/
│       └── main.css        # All styles (1,966 lines)
│
├── src/                    # Backend
│   ├── server.js           # Express + WebSocket server (1,630 lines)
│   ├── config.js           # Server configuration
│   ├── realtime.js         # OpenAI Realtime API handler
│   ├── hybrid-realtime.js  # Hybrid Claude/OpenAI handler
│   ├── tools.js            # Tool definitions
│   ├── services/
│   │   ├── gateway.js      # Clawdbot Gateway communication
│   │   └── session.js      # Session file utilities
│   └── providers/
│       └── tts.js          # Text-to-speech provider
│
└── notes/                  # Voice recordings storage
```

## Modes

### Chat Mode
- Uses Claude Opus 4.5 via Clawdbot Gateway
- Supports file uploads (images, PDFs, documents)
- Full conversation history

### Voice Mode
- OpenAI Realtime API for low-latency voice
- ~200-500ms response time
- Hybrid fallback to Claude for complex queries

### Notes Mode
- Record voice memos
- Transcribe with Whisper
- Auto-summarize with Claude
- Save to memory or file

## Environment Variables

```env
# Required
OPENAI_API_KEY=sk-...

# Optional (defaults shown)
PORT=3456
UNIFIED_SESSION=true
```

## Session Unification

ClawChat shares session context with Clawdbot (WhatsApp/Telegram). Messages sent via the web portal appear in the same conversation as messages from other channels.

Set `UNIFIED_SESSION=false` to use isolated sessions.

## Development

```bash
# Run in development
npm run dev

# Check syntax
node --check src/server.js
```

## Revert Points

If something breaks after optimization:
```bash
git checkout v1.0-pre-optimization
```

## Tech Stack

- **Frontend**: Vanilla JS (ES6 modules)
- **Backend**: Node.js, Express, WebSocket
- **Voice**: OpenAI Realtime API
- **LLM**: Claude via Clawdbot Gateway
- **TTS**: OpenAI TTS

## License

Private - All rights reserved
