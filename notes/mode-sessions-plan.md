# SparkGPT Mode Sessions — Holistic Fix Plan

**Created:** 2026-02-07  
**Status:** Planning  
**Priority:** High

---

## Problems Identified

### P1 — Old "Active Sessions" button still on intro page
The top-left Spark status pill (`#spark-status`) shows gateway connection + sub-agent counts via `/api/active-sessions` (OpenClaw CLI `sessions list`). This is the old system — before mode buttons became session-aware. The code for the popup, badge, and polling is still there (~180 lines of dead frontend code + backend endpoint).

### P2 — Mode sessions show mixed/wrong content
**Root cause:** Mode sessions use deterministic OpenClaw session IDs (e.g., `spark-res-00000-...`). When the server starts with `UNIFIED_SESSION=true`, the file watcher is initialized on the *last mode session* JSONL file (not the main session). All WhatsApp messages, heartbeats, and mode messages end up in the same OpenClaw main session, and the mode session history reader (`getModeHistory`) reads from the single deterministic JSONL file — which accumulates ALL messages ever routed to that mode, including system prompts, raw WhatsApp metadata, and image data.

The `getModeHistory` function tries to filter but doesn't filter out:
- System prompt context (`[System Context: ...]`)  
- Raw WhatsApp message metadata (phone numbers, message IDs, media paths)
- Base64 image data
- Heartbeat messages that slip through

### P3 — No way to navigate between past sessions
Currently each mode has exactly ONE session file (deterministic ID). There's no concept of "sessions" plural — everything is one continuous JSONL. Users need to:
- See a list of past sessions per mode
- Open the latest session by default
- Navigate to older sessions

### P4 — Mode session chat UI looks different from main chat
The session page uses its own message rendering (`addSessionMessage`) and CSS (`.session-messages .msg`), which diverges from the main chat's `addMsg` and styling. Missing: avatar, timestamp, markdown rendering quality, code block styling, copy button on code, message actions (copy/edit/delete).

---

## Execution Plan

### Phase 1: Clean Up — Remove Old Active Sessions UI
**Effort:** Low (1-2 hours)  
**Risk:** Low  
**Dependencies:** None

**Tasks:**
1. Remove `#spark-status` pill from `index.html` (or repurpose as pure gateway status — no sessions popup)
2. Remove `fetchActiveSessions()`, `updateSparkPillText()`, `showSessionsPopup()`, `updateSessionsPopupContent()`, `getSessionDescription()`, `getSessionIcon()` from `app.js`
3. Remove `/api/active-sessions` endpoint from `server.js` (relies on `openclaw sessions list --json` which is timing out anyway)
4. Remove related CSS (`.spark-status`, `.session-count`, `#sessions-popup`)
5. Keep `#spark-status` as a simple gateway connection indicator (green dot = connected, red = disconnected) — no popup, no badge

**Deliverables:**
- Cleaner intro page — no orphaned UI element
- ~200 lines removed from frontend
- Fewer CLI calls = faster page load (those `spawnSync` calls were timing out)

**Success criteria:** Intro page loads without the old sessions button; no console errors

---

### Phase 2: Fix Session Content — Proper History Filtering
**Effort:** Medium (2-3 hours)  
**Risk:** Medium (could break existing session display)  
**Dependencies:** None (can run parallel with Phase 1)

**Tasks:**
1. In `getModeHistory()`, improve filtering:
   - Strip `[System Context: ...]` prefix from user messages
   - Filter out messages containing WhatsApp metadata patterns (`[WhatsApp`, `[message_id:`, `[media attached:`)
   - Filter out base64 image data
   - Filter out heartbeat-related messages
   - Filter messages that are clearly not from the SparkGPT user (they come from the OpenClaw main session)
   
2. In `routeModeMessage()`, clean the message before sending:
   - Don't include the `[System Context: ...]` wrapper in the JSONL — it's only needed for the CLI call, not for display
   
3. Fix the file watcher initialization in `server.js`:
   - The shared session file watcher should point to the main session, NOT the last mode session
   - Mode sessions should have their own watchers only when active

**Deliverables:**
- Clean chat history per mode — only user messages and assistant responses
- No leaked WhatsApp metadata in mode sessions

**Success criteria:** Opening a mode session shows only relevant conversation messages

---

### Phase 3: Session Navigation — Multi-Session Support
**Effort:** High (4-6 hours)  
**Risk:** Medium-High (new feature, needs backend + frontend)  
**Dependencies:** Phase 2

**Architecture:**
Each mode session currently uses a single deterministic JSONL file. To support multiple sessions:

**Option A — Session Index File (Recommended)**
- Create `mode-sessions/` directory for metadata
- Each mode gets a JSON index: `mode-sessions/dev.json`, `mode-sessions/research.json`, etc.
- Index tracks: `{ sessions: [{ id, createdAt, title, messageCount, lastMessage }] }`
- When user starts a new session → generate new UUID session ID, add to index
- Latest session opens by default
- "New Session" button creates a fresh entry
- Session list accessible via history icon in session header

**Option B — Conversation Markers**
- Keep single JSONL per mode but add "session boundary" markers
- Less clean, harder to navigate, not recommended

**Tasks (Option A):**
1. Create `src/mode-session-index.js`:
   - `getSessionIndex(mode)` — read index file
   - `createSession(mode)` — generate new session ID, add to index
   - `getLatestSession(mode)` — return most recent session
   - `listSessions(mode)` — return all sessions with metadata
   
2. Update `routeModeMessage()`:
   - If no active session for mode → create one
   - Use the active session ID (not deterministic) for CLI `--session-id`
   
3. Add API endpoints:
   - `GET /api/modes/:mode/sessions` — list sessions for a mode
   - `POST /api/modes/:mode/sessions` — create new session
   - `GET /api/modes/:mode/sessions/:sessionId/history` — get history for specific session
   
4. Update frontend:
   - Add history icon (clock/list) in session header bar
   - Clicking it shows a slide-out list of past sessions
   - Each entry shows: title (auto-generated from first message), date, message count
   - Tap to switch sessions
   - "New Session" button (already exists) wired to create new session via API
   - Latest session loads by default on mode button click

**Deliverables:**
- Multiple sessions per mode
- Session list UI
- Auto-title from first message
- Latest session opens by default

**Success criteria:** User can start new sessions, navigate between old ones, latest opens by default

---

### Phase 4: Unify Chat UI — Match Main Chat Styling
**Effort:** Medium (2-3 hours)  
**Risk:** Low  
**Dependencies:** Phase 2 (clean history needed first)

**Tasks:**
1. Reuse main chat's `addMsg()` and `formatMessage()` for session messages
   - Or create a shared `renderMessage(role, text, container)` used by both
   
2. Match styling:
   - Same message bubble shapes, colors, padding
   - Same code block rendering with copy button
   - Same markdown rendering
   - Same link handling
   
3. Add missing features to session messages:
   - Timestamps on messages
   - Copy button on messages (long-press or icon)
   - Code block syntax highlighting + copy
   
4. Session header improvements:
   - Show mode name + icon in header
   - Show session title (from first message)
   - Running/idle indicator

**Deliverables:**
- Session chat looks identical to main chat
- Message actions work the same way

**Success criteria:** Visual parity between main chat and mode sessions — user can't tell the difference in styling

---

## Execution Order

```
Phase 1 (Clean up old UI) ─────────────────────┐
                                                 ├──▶ Phase 3 (Multi-session) ──▶ Phase 4 (UI parity)
Phase 2 (Fix session content) ─────────────────┘
```

Phases 1 & 2 can run in parallel. Phase 3 depends on Phase 2. Phase 4 depends on Phase 2.

## Estimated Timeline
- **Phase 1:** ~1-2 hours
- **Phase 2:** ~2-3 hours  
- **Phase 3:** ~4-6 hours
- **Phase 4:** ~2-3 hours
- **Total:** ~9-14 hours

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing sessions | High | Git tag before each phase; test after each commit |
| CLI timeout issues (`spawnSync ETIMEDOUT`) | Medium | Phase 1 removes the problematic endpoint; mode sessions use async spawn |
| Session index corruption | Medium | Use atomic writes (write to temp, rename) |
| UI inconsistencies across browsers | Low | Test on Safari iOS + Chrome |
| Context window overflow from large sessions | Medium | Limit history to last 50 messages per session |

---

*Plan by Spark ⚡ — Ready for execution*
