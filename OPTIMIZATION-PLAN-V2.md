# SparkGPT Optimization Plan V2

## Pre-optimization State
- **Tag**: `v91-pre-optimization`
- **Date**: 2026-02-07
- **Total LOC**: ~9,177 across all source files
- **Service**: Running as `sparkgpt.service` on port 3456

---

## Phase 1: Critical Bug Fix — `clawdbot` → `openclaw` ✅ DONE

**Problem**: The `clawdbot` CLI was renamed to `openclaw`. The old path `/home/heisenberg/.npm-global/bin/clawdbot` no longer exists, causing `/api/nodes/status` and `/api/active-sessions` endpoints to fail with "not found" errors every poll cycle.

**Files Changed**:
- `src/server.js`: Update `CLAWDBOT_PATH` constant and all references in comments/logs

**Verification**:
- `node --check src/server.js`
- Restart service, check `curl -s http://localhost:3456/api/nodes/status`
- Check `curl -s http://localhost:3456/api/active-sessions`

---

## Phase 2: Dead Code & Duplication Cleanup ✅ DONE

### 2a: Remove dead code
- **`handleTranscriptIsolated()`** in `server.js` — Legacy function, never called. Remove entirely.
- **`getDefaultSystemPrompt()`** in `config.js` — Defined but never exported or used. Remove.

### 2b: Create shared utility module
Create `src/services/shared.js` to consolidate duplicated functions:

| Function | Currently In | Action |
|----------|-------------|--------|
| `loadGatewayToken()` | `config.js`, `session.js` | Keep in `session.js`, remove from `config.js` (already imports session.js in server.js) |
| `getOpenAIKey()` | `realtime.js`, `hybrid-realtime.js` | Move to `shared.js` |
| `getGatewayToken()` | `tools.js`, `hybrid-realtime.js` | Move to `shared.js` |
| `loadConversationContext()` | `realtime.js`, `hybrid-realtime.js` | Move to `shared.js` (with flexible options) |
| `appendToSession()` | `realtime.js`, `hybrid-realtime.js` | Move to `shared.js` |

### 2c: Fix hardcoded session IDs
- `realtime.js` and `hybrid-realtime.js` both hardcode `MAIN_SESSION_ID = 'd0bddcfd-...'`
- Should use `getMainSessionId()` from `services/session.js`

**Verification**:
- `node --check src/server.js`
- `node --check src/realtime.js` (via import)
- Restart service, verify no errors in logs

---

## Phase 3: Code Quality (Partial ✅)

### 3a: Constants file
Create `src/constants.js` with magic numbers:
- `AUDIO_CHUNK_SIZE = 24000`
- `MAX_FILE_TEXT_LENGTH = 50000` / `30000` for CLI
- `SPEAKING_TIMEOUT_MS = 30000`
- `HEARTBEAT_INTERVAL_MS = 15000`
- `HEARTBEAT_TIMEOUT_MS = 10000`
- `STALE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000`
- `SYNC_POLL_INTERVAL_MS = 1000`
- `SYNC_DEBOUNCE_MS = 100`
- `CLI_TIMEOUT_MS = 5 * 60 * 1000`
- `WS_MAX_PAYLOAD = 50 * 1024 * 1024`
- `MAX_HASH_CACHE = 100`

### 3b: WebSocket message validation
Add basic validation in the `ws.on('message')` handler to ensure:
- `msg.type` is a known type
- `msg.text` exists for transcript messages
- Reject oversized messages

### 3c: Frontend file size limit
Add validation before sending file data in `app.js`.

---

## Phase 4: Security Hardening ✅ DONE
- XSS improvements in `formatMessage()` — added `"` and `'` escaping
- Added `escapeHtml()` utility function for safe HTML interpolation
- Escaped server data in session popup templates
- WebSocket message size limits (already have `maxPayload: 50MB`)

---

## Phase 5: Logging Cleanup ✅ DONE
- Created `src/logger.js` — lightweight logger with `log`, `debug`, `warn`, `error` functions
- `DEBUG` env var (DEBUG=1 or DEBUG=spark) enables verbose logging
- Converted ~30 high-frequency logs to `debug()` (suppressed in production)
- Kept essential logs as `log()` (startup, routing, responses)
- Zero `console.*` calls remaining in `server.js`

---

## Execution Log
1. ✅ **Phase 1** — Fixed `clawdbot` → `openclaw` CLI path (commit `2b0aff8`)
2. ✅ **Phase 2a** — Removed 114 lines of dead code (commit `aafe988`)
3. ✅ **Phase 2b+2c** — Created shared.js, eliminated 5 duplicate functions, fixed 2 hardcoded session IDs (commit `4919f0c`)
4. ✅ **Phase 3a** — Created constants.js, replaced 12+ magic numbers (commit `fa26796`)
5. ✅ **Phase 3b** — WebSocket message validation (commit `5a5ce3c`)
6. ✅ **Phase 3c** — Frontend file size validation (commit `59d9b62`)
7. ✅ **Phase 4** — XSS hardening in formatMessage + escapeHtml utility (commit `ed3504f`)
8. ✅ **Phase 5** — Logger module with DEBUG flag, cleaned up ~30 console.log calls (commit `0097cb6`)

## Results Summary
| Metric | Before | After | Change |
|--------|--------|-------|--------|
| server.js | 1,644 | 1,593 | -51 (net, +validation +logging changes) |
| config.js | 107 | 84 | -23 |
| realtime.js | 398 | 314 | -84 |
| hybrid-realtime.js | 427 | 334 | -93 |
| tools.js | 267 | 257 | -10 |
| shared.js | 0 | 135 | +135 (new) |
| constants.js | 0 | 64 | +64 (new) |
| logger.js | 0 | 48 | +48 (new) |
| **Total backend** | **3,041** | **3,027** | **-14 net** |
| ui.js (frontend) | 153 | 178 | +25 (escapeHtml, XSS fixes) |
| config.js (frontend) | 14 | 18 | +4 (maxFileSize) |
| Duplicate functions | 5 | 0 | Eliminated |
| Hardcoded session IDs | 2 | 0 | Fixed |
| Dead code functions | 2 | 0 | Removed |
| Critical bug (broken endpoints) | 1 | 0 | Fixed |
| WS message validation | None | Full | Added |
| File size validation | None | 10MB limit | Added |
| XSS protection | Partial | Complete | Hardened |
| Debug logging | None | DEBUG env var | Added |
