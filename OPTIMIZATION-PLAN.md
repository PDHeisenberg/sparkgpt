# SparkGPT Optimization Plan

> **Revert Point:** `git checkout v1.0-pre-optimization` to undo all optimization changes

---

## Progress Tracker

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1. Extract CSS | ✅ DONE | 2026-02-04 | Extracted 1,966 lines to `styles/main.css` |
| 2. Modularize Frontend | 🔄 IN PROGRESS | 2026-02-04 | Extracting pure utilities |
| 3. Modularize Backend | 🔲 TODO | - | Split server.js |
| 4. Dev Experience | 🔲 TODO | - | README, JSDoc |
| 5. Performance | 🔲 TODO | - | Optional bundling |

### Phase 1 Results
- `index.html`: 2,305 → 338 lines ✅
- New file: `public/styles/main.css` (1,966 lines)

### Phase 2 Progress (Frontend Modularization)
| Step | Module | Lines | Status |
|------|--------|-------|--------|
| 2.1 | modules/config.js | 16 | ✅ CONFIG object |
| 2.2 | modules/ui.js | 158 | ✅ Message utils, formatters |
| 2.3 | modules/audio.js | 54 | ✅ Audio conversion utils |
| 2.4 | Deduplication | - | ✅ Removed duplicate code |

**Current app.js:** 3,712 → 3,620 lines (-92 lines, -2.5%)

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

## Phase 1: Extract CSS ✅ COMPLETE
**Status:** Done on 2026-02-04

- Created `public/styles/main.css` (1,966 lines)
- `index.html` reduced from 2,305 → 338 lines
- CSS served via `<link rel="stylesheet" href="styles/main.css">`

---

## Phase 2: Modularize Frontend 🔲 IN PROGRESS
**Effort:** 4-6 hours | **Impact:** High

Split `app.js` (3,712 lines, 115 functions) into logical modules.

### Current Sections in app.js (with line numbers):
```
Lines 1-34:      Imports, CONFIG object
Lines 35-113:    Spark status, sessions popup
Lines 114-266:   Theme, mode helpers
Lines 267-430:   MODE SESSION STATE
Lines 431-605:   PAGE STATE MANAGEMENT (intro, chatfeed)
Lines 606-697:   Close button, pull-down gesture
Lines 698-832:   MESSAGES (addMsg, formatMessage, thinking)
Lines 833-1525:  VOICE MODE (realtime API, audio queue)
Lines 1526-1574: CHAT MODE (submitText)
Lines 1575-1745: NOTES MODE (recording, save, delete)
Lines 1746-2080: WEBSOCKET (connect, send, handle)
Lines 2081-2193: AUDIO (playAudio)
Lines 2194-2340: MESSAGE CONTEXT MENU
Lines 2342-2430: PC STATUS / WAKE
Lines 2432-2687: SESSION PAGES
Lines 2688-3430: BOTTOM SHEETS / MODALS (video gen, face swap)
Lines 3431-3712: FILE HANDLING, init
```

### Module Extraction Order (do one at a time):
1. `modules/config.js` - Lines 1-34 (CONFIG, constants)
2. `modules/ui.js` - Lines 698-832 (addMsg, toast, status, thinking)
3. `modules/audio.js` - Lines 2081-2193 + 833-1030 (audio playback)
4. `modules/websocket.js` - Lines 1746-2080 (WS connection)
5. `modules/voice.js` - Lines 1031-1525 (voice mode logic)
6. `modules/notes.js` - Lines 1575-1745 (notes recording)
7. `modules/pages.js` - Lines 431-697 (page navigation)
8. `modules/modals.js` - Lines 2688-3430 (bottom sheets)
9. `modules/state.js` - Lines 267-430 (mode session state)
10. `modules/utils.js` - Lines 3431-3712 (file handling, helpers)

### Proposed Structure:
```
public/
├── app.js                 # Main entry (~200 lines)
├── modules/
│   ├── config.js          # CONFIG, constants
│   ├── ui.js              # DOM helpers, toast, status, messages
│   ├── audio.js           # Audio playback, TTS queue
│   ├── websocket.js       # WS connection, handlers
│   ├── voice.js           # Voice mode, realtime API
│   ├── notes.js           # Notes recording/transcription
│   ├── pages.js           # Page navigation
│   ├── modals.js          # Bottom sheets, video gen
│   ├── state.js           # Session state, mode management
│   └── utils.js           # File handling, helpers
└── styles/
    └── main.css
```

### How to Extract a Module:
1. Create `public/modules/[name].js`
2. Copy the relevant functions
3. Add `export` to each function
4. In `app.js`, add `import { fn1, fn2 } from './modules/[name].js'`
5. Test in browser, fix any missing dependencies
6. Commit after each module

### Shared State Pattern:
```javascript
// modules/state.js
export const state = {
  ws: null,
  currentMode: 'chat',
  sessions: {},
  // ... etc
};

// Other modules import state:
import { state } from './state.js';
```

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
