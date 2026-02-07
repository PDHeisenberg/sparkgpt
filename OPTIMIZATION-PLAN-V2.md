# SparkGPT Optimization Plan V2

## Pre-optimization State
- **Tag**: `v91-pre-optimization`
- **Date**: 2026-02-07
- **Total LOC**: ~9,177 across all source files
- **Service**: Running as `sparkgpt.service` on port 3456

---

## Phase 1: Critical Bug Fix — `clawdbot` → `openclaw` ✅

**Problem**: The `clawdbot` CLI was renamed to `openclaw`. The old path `/home/heisenberg/.npm-global/bin/clawdbot` no longer exists, causing `/api/nodes/status` and `/api/active-sessions` endpoints to fail with "not found" errors every poll cycle.

**Files Changed**:
- `src/server.js`: Update `CLAWDBOT_PATH` constant and all references in comments/logs

**Verification**:
- `node --check src/server.js`
- Restart service, check `curl -s http://localhost:3456/api/nodes/status`
- Check `curl -s http://localhost:3456/api/active-sessions`

---

## Phase 2: Dead Code & Duplication Cleanup

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

## Phase 3: Code Quality

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

## Phase 4: Security Hardening (Deferred)
- XSS improvements in `formatMessage()` 
- WebSocket message size limits (already have `maxPayload: 50MB`)
- File type validation on server side

*Note: These require more careful testing and should be done separately.*

---

## Phase 5: Logging Cleanup (Deferred)
- Replace `console.log` with structured logger
- Add `DEBUG` flag to suppress verbose logs

*Note: Lower priority, may mask debugging info if done incorrectly.*

---

## Execution Order
1. ✅ Phase 1 (critical fix)
2. Phase 2a (dead code)
3. Phase 2b+2c (shared module + session ID fix)
4. Phase 3a (constants)
5. Phases 3b, 3c, 4, 5 (deferred to future iteration)
