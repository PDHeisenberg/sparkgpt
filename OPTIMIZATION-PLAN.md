# SparkGPT Optimization Plan

> **Revert Point:** `git checkout v1.0-pre-optimization` to undo all optimization changes

---

## Progress Tracker

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1. Extract CSS | ✅ DONE | 2026-02-04 | Extracted 1,966 lines to `styles/main.css` |
| 2. Modularize Frontend | 🔲 TODO | - | Split app.js into modules |
| 3. Modularize Backend | 🔲 TODO | - | Split server.js |
| 4. Dev Experience | 🔲 TODO | - | README, JSDoc |
| 5. Performance | 🔲 TODO | - | Optional bundling |

### Phase 1 Results
- `index.html`: 2,305 → 338 lines ✅
- New file: `public/styles/main.css` (1,966 lines)

---

## Current State Analysis

### File Sizes
| File | Lines | Functions | Issue |
|------|-------|-----------|-------|
| `public/app.js` | 3,712 | 115 | Monolithic, hard to navigate |
| `public/index.html` | 2,305 | - | CSS inline (~1500 lines of styles) |
| `src/server.js` | 1,867 | 30 | Mixed concerns, could be modular |
| `src/realtime.js` | 398 | - | ✅ Good size |
| `src/hybrid-realtime.js` | 427 | - | ✅ Good size |
| `src/tools.js` | 267 | - | ✅ Good size |
| `src/config.js` | 107 | - | ✅ Good size |

**Total: 9,083 lines**

---

## Phase 1: Extract CSS (Easy Win)
**Effort:** 1-2 hours | **Impact:** High

Currently all CSS is inline in `index.html` making it 2,305 lines.

### Actions:
1. Create `public/styles/main.css`
2. Extract all `<style>` content from index.html
3. Add `<link rel="stylesheet" href="styles/main.css">`
4. Result: `index.html` drops to ~800 lines (pure HTML)

### Optional - Split CSS further:
```
public/styles/
├── main.css          # Base styles, variables, layout
├── themes.css        # Light/dark theme variables
├── chat.css          # Chat mode styles
├── voice.css         # Voice mode styles
├── notes.css         # Notes mode styles
└── components.css    # Buttons, modals, sheets
```

---

## Phase 2: Modularize Frontend (Medium)
**Effort:** 4-6 hours | **Impact:** High

Split `app.js` (3,712 lines) into logical modules.

### Current Sections in app.js:
1. Config & State (lines 1-260)
2. Mode Session State (267-430)
3. Page State Management (431-605)
4. UI Components (606-700)
5. Messages (700-830)
6. Voice Mode (833-1525)
7. Chat Mode (1526-1574)
8. Notes Mode (1575-1745)
9. WebSocket (1746-2080)
10. Audio (2081-2193)
11. Context Menu (2194-2340)
12. PC Status / Wake (2342-2430)
13. Session Pages (2432-2700)
14. Bottom Sheets / Modals (2700-3500)
15. File Handling (3500-3712)

### Proposed Structure:
```
public/
├── app.js                 # Main entry, imports modules
├── modules/
│   ├── config.js          # CONFIG, state variables
│   ├── state.js           # Session state, mode management
│   ├── ui.js              # DOM helpers, toast, status
│   ├── pages.js           # Page navigation (intro, chat, etc.)
│   ├── messages.js        # Message rendering, formatting
│   ├── voice.js           # Voice mode, realtime API
│   ├── chat.js            # Chat mode logic
│   ├── notes.js           # Notes recording/transcription
│   ├── websocket.js       # WS connection, handlers
│   ├── audio.js           # Audio playback, TTS
│   ├── modals.js          # Bottom sheets, video gen
│   └── utils.js           # Helpers, file handling
└── styles/
    └── main.css
```

### Implementation:
- Use ES6 modules (`import`/`export`)
- Keep `app.js` as orchestrator (~200 lines)
- Each module: 200-400 lines max

---

## Phase 3: Modularize Backend (Medium)
**Effort:** 3-4 hours | **Impact:** Medium

Split `server.js` (1,867 lines) into focused modules.

### Current Sections:
1. Session Unification (35-150)
2. Gateway Communication (150-310)
3. Express Routes - Config/Articulate (310-390)
4. Express Routes - Sessions API (390-840)
5. Notes API (840-935)
6. WebSocket Upgrade (935-950)
7. Session Sync/Polling (950-1220)
8. Request Queue (1220-1280)
9. Message Handling (1280-1540)
10. Chat/Transcribe (1540-1800)
11. Server Start (1800-1867)

### Proposed Structure:
```
src/
├── server.js              # Entry point, app setup (~150 lines)
├── config.js              # ✅ Already exists
├── routes/
│   ├── api.js             # /api/* routes
│   ├── sessions.js        # Session CRUD
│   └── notes.js           # Notes API
├── services/
│   ├── gateway.js         # Clawdbot gateway communication
│   ├── sync.js            # Session sync, file watcher
│   └── chat.js            # Chat/transcription logic
├── websocket/
│   ├── handler.js         # WS message routing
│   └── sessions.js        # WS session management
├── providers/
│   └── tts.js             # ✅ Already exists
├── realtime.js            # ✅ Already exists
├── hybrid-realtime.js     # ✅ Already exists
└── tools.js               # ✅ Already exists
```

---

## Phase 4: Developer Experience
**Effort:** 2-3 hours | **Impact:** Medium

### 4.1 Add README.md
```markdown
# SparkGPT

Voice + Chat + Notes assistant powered by Claude & OpenAI.

## Quick Start
npm install
npm run dev

## Architecture
- Frontend: Vanilla JS (ES6 modules)
- Backend: Express + WebSocket
- Voice: OpenAI Realtime API
- Chat: Claude via Clawdbot Gateway
```

### 4.2 Add JSDoc Comments
Document key functions with types:
```javascript
/**
 * Send message to Clawdbot main session
 * @param {string} text - Message content
 * @param {string} [source='Spark Portal'] - Source identifier
 * @returns {Promise<{success: boolean, response?: string}>}
 */
async function sendToMainSession(text, source = 'Spark Portal') {
```

### 4.3 Add package.json scripts
```json
{
  "scripts": {
    "dev": "node src/server.js",
    "start": "node src/server.js",
    "lint": "eslint src/ public/",
    "format": "prettier --write src/ public/"
  }
}
```

---

## Phase 5: Performance (Optional)
**Effort:** 2-4 hours | **Impact:** Low-Medium

### 5.1 Bundle for Production
- Use esbuild or Vite for production builds
- Minify JS/CSS
- Add cache busting

### 5.2 Code Splitting
- Lazy load voice mode (heavy)
- Lazy load video gen modal

---

## Execution Priority

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| 1. Extract CSS | 1-2h | High | 🔴 Do First |
| 2. Modularize Frontend | 4-6h | High | 🟠 Do Second |
| 3. Modularize Backend | 3-4h | Medium | 🟡 Do Third |
| 4. Dev Experience | 2-3h | Medium | 🟢 Ongoing |
| 5. Performance | 2-4h | Low | ⚪ Later |

---

## Quick Wins (Do Now)

1. **Extract CSS** → Immediate clarity
2. **Add README.md** → 10 min
3. **Add section comments** → Already has separators, just improve labels

---

## File Structure After Optimization

```
sparkgpt/
├── public/
│   ├── index.html          # ~800 lines (HTML only)
│   ├── app.js              # ~200 lines (orchestrator)
│   ├── modules/
│   │   ├── config.js
│   │   ├── state.js
│   │   ├── ui.js
│   │   ├── pages.js
│   │   ├── messages.js
│   │   ├── voice.js
│   │   ├── chat.js
│   │   ├── notes.js
│   │   ├── websocket.js
│   │   ├── audio.js
│   │   ├── modals.js
│   │   └── utils.js
│   └── styles/
│       └── main.css        # ~1500 lines (all styles)
├── src/
│   ├── server.js           # ~150 lines (entry)
│   ├── config.js
│   ├── routes/
│   ├── services/
│   ├── websocket/
│   ├── providers/
│   ├── realtime.js
│   ├── hybrid-realtime.js
│   └── tools.js
├── notes/                  # Voice recordings
├── README.md
├── TECHNICAL-REVIEW-V2.md
├── package.json
└── .env
```

**Result:** No file over 500 lines, clear navigation, easy to find code.
