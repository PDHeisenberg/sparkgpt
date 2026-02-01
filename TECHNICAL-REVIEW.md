# Spark Voice Chat Portal - Technical Review

**Review Date:** 2026-01-31  
**Reviewer:** Senior Frontend Engineer (Automated QA)  
**Version:** Based on `app.js?v=71`

---

## 1. Executive Summary

The Spark Voice Chat Portal is a sophisticated multi-mode voice/chat interface combining:
- **Chat Mode**: Text-based chat with Claude (Opus 4.5) via Clawdbot Gateway
- **Voice Mode**: Real-time voice using OpenAI Realtime API (with hybrid Claude fallback)
- **Notes Mode**: Audio recording with Whisper transcription + summarization

### Overall Assessment

| Category | Rating | Summary |
|----------|--------|---------|
| UI/UX | ⭐⭐⭐ | Clean Apple-inspired design, but accessibility gaps and mobile touch issues |
| Code Quality | ⭐⭐⭐ | Functional but has race conditions, memory leaks, and inconsistent error handling |
| Architecture | ⭐⭐⭐⭐ | Good separation of concerns, but mixed responsibilities in some files |
| Performance | ⭐⭐⭐ | Adequate, but audio handling could be optimized |

### Critical Issues (Fix Immediately)
1. **Memory leak**: Audio contexts and intervals not always cleaned up
2. **Race condition**: Multiple WebSocket connections can be created simultaneously
3. **Incomplete responses**: Known issue - cuts off mid-message (OpenAI API limitation)

### Quick Wins (1-2 hours each)
1. Add ARIA labels for accessibility
2. Implement proper error boundaries
3. Add loading states for file uploads
4. Fix keyboard navigation

---

## 2. UI/UX Issues

### 2.1 Accessibility (Critical)

#### Missing ARIA Labels
**Severity:** High  
**Effort:** 2 hours

```html
<!-- CURRENT -->
<button id="voice-btn" class="circle-btn" title="Voice">

<!-- RECOMMENDED -->
<button id="voice-btn" 
        class="circle-btn" 
        title="Voice"
        aria-label="Start voice conversation"
        aria-pressed="false"
        role="button">
```

**Affected elements:**
- `#voice-btn`, `#notes-btn`, `#send-btn` - Missing `aria-label`
- `#voice-bar` - Missing `aria-live="polite"` for status updates
- `#messages` - Missing `role="log"` and `aria-live="polite"`
- Theme toggle - Missing `aria-pressed` state
- All modals/panels - Missing focus trapping

#### Keyboard Navigation Issues
**Severity:** High  
**Effort:** 3 hours

```javascript
// CURRENT: No keyboard support for voice mode

// RECOMMENDED: Add keyboard handlers
document.addEventListener('keydown', (e) => {
  // Space/Enter to toggle voice mode when focused
  if (document.activeElement === voiceBtn && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    isListening ? stopVoice() : startVoice();
  }
  
  // Escape to close voice/notes mode
  if (e.key === 'Escape') {
    if (isListening) stopVoice();
    if (mode === 'notes') stopRecording();
    hideMsgMenu();
  }
});
```

#### Color Contrast Issues
**Severity:** Medium  
**Effort:** 1 hour

The `--text-tertiary` color doesn't meet WCAG AA contrast requirements:

```css
/* CURRENT */
--text-tertiary: rgba(0, 0, 0, 0.35); /* ~2.6:1 contrast ratio */

/* RECOMMENDED */
--text-tertiary: rgba(0, 0, 0, 0.54); /* ~4.5:1 contrast ratio - meets AA */
```

### 2.2 Responsive Design Issues

#### Mobile Touch Target Sizes
**Severity:** Medium  
**Effort:** 1.5 hours

Some touch targets are below the recommended 44x44px minimum:

```css
/* CURRENT */
#upload-btn {
  width: 32px;
  height: 32px;
}

/* RECOMMENDED - Increase touch area without changing visual size */
#upload-btn {
  width: 32px;
  height: 32px;
  padding: 6px;
  margin: -6px;
  position: relative;
}

/* Or use pseudo-element for larger tap area */
#upload-btn::before {
  content: '';
  position: absolute;
  top: -6px;
  right: -6px;
  bottom: -6px;
  left: -6px;
}
```

#### Missing Safe Area Handling on Notched Devices
**Severity:** Low  
**Effort:** 0.5 hours

The header doesn't account for notched displays:

```css
/* RECOMMENDED - Add to .status-pill and #theme-btn */
.status-pill {
  top: max(16px, env(safe-area-inset-top, 16px));
  left: max(16px, env(safe-area-inset-left, 16px));
}
```

### 2.3 Animation and Transition Issues

#### Jarring Mode Transitions
**Severity:** Medium  
**Effort:** 2 hours

Mode transitions are instant, which can be disorienting:

```css
/* RECOMMENDED: Smooth transitions between modes */
#messages, #voice-content, #notes-content {
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}

body.voice-mode #messages {
  opacity: 0;
  transform: translateY(20px);
  pointer-events: none;
  position: absolute;
}

body.voice-mode #voice-content {
  opacity: 1;
  transform: translateY(0);
}
```

#### Waveform Animation Performance
**Severity:** Medium  
**Effort:** 1 hour

50 animated bars can cause jank on lower-end devices:

```css
/* RECOMMENDED: Use will-change and reduce complexity */
#waveform .bar {
  will-change: height;
  contain: layout style;
}

/* On low-power devices, reduce bar count via media query */
@media (prefers-reduced-motion: reduce) {
  #waveform .bar:nth-child(n+20) {
    display: none;
  }
  
  #waveform .bar {
    animation: none;
    height: 8px;
  }
}
```

### 2.4 Loading States and Feedback

#### Missing Loading States for File Upload
**Severity:** Medium  
**Effort:** 1.5 hours

File uploads show no progress:

```javascript
// RECOMMENDED: Add upload progress indication
async function sendWithImage(text, imageData) {
  // Show upload indicator
  const userMsg = addMsg(text + ' 📷', 'user');
  userMsg.classList.add('uploading');
  
  // Add spinner
  const spinner = document.createElement('span');
  spinner.className = 'upload-spinner';
  spinner.innerHTML = '⏳';
  userMsg.appendChild(spinner);
  
  showThinking();
  
  ws.send(JSON.stringify({ type: 'transcript', text, image: imageData, mode: 'chat' }));
}
```

```css
/* Add CSS for upload indicator */
.msg.uploading .upload-spinner {
  margin-left: 8px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% { transform: rotate(360deg); }
}
```

#### Missing Thinking/Loading Sound (Known Issue)
**Severity:** Medium  
**Effort:** 2 hours  
**Status:** Partially implemented but not used in all modes

The `playWaitingSound()` function exists but:
1. Only used in voice mode
2. Sound is quite basic (single tone)
3. Not configurable

```javascript
// RECOMMENDED: More sophisticated waiting sound
function createThinkingSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const duration = 0.4;
  const samples = duration * ctx.sampleRate;
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  
  // Two-tone "thinking" sound (more pleasant)
  for (let i = 0; i < samples; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.exp(-6 * t / duration);
    // Chord: C5 + E5 for warmth
    const freq1 = 523.25;
    const freq2 = 659.25;
    data[i] = env * 0.15 * (
      Math.sin(2 * Math.PI * freq1 * t) * 0.6 +
      Math.sin(2 * Math.PI * freq2 * t) * 0.4
    );
  }
  
  return { ctx, buffer };
}
```

### 2.5 Dark Mode Inconsistencies

#### Manual Theme Toggle Not Respecting System Changes
**Severity:** Low  
**Effort:** 1 hour

When user sets manual theme, system preference changes are ignored (which is correct), but there's no "auto" option to return to system preference:

```javascript
// RECOMMENDED: Add 'auto' theme option
themeBtn?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  
  // Cycle: light → dark → auto (system)
  let newTheme;
  if (current === 'light') {
    newTheme = 'dark';
  } else if (current === 'dark') {
    newTheme = null; // Auto/system
  } else {
    newTheme = 'light';
  }
  
  if (newTheme) {
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
  }
});
```

---

## 3. Code Quality Issues

### 3.1 Memory Leaks (Critical)

#### Audio Context Accumulation
**Severity:** Critical  
**Effort:** 2 hours

Multiple audio contexts are created without proper cleanup:

```javascript
// PROBLEM: Creates new context each pulse without tracking
function playThinkingPulse() {
  try {
    const { ctx, buffer } = createThinkingSound();
    // ctx is created but only closed in onended callback
    // If interrupted, ctx leaks
    ...
  }
}

// RECOMMENDED: Reuse a single audio context
let sharedAudioContext = null;

function getAudioContext() {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sharedAudioContext;
}

function playThinkingPulse() {
  try {
    const ctx = getAudioContext();
    const buffer = createThinkingSoundBuffer(ctx);
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    
    // No need to close context - it's reused
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  } catch (e) {
    console.error('Thinking sound error:', e);
  }
}
```

#### Interval Not Always Cleared
**Severity:** High  
**Effort:** 0.5 hours

```javascript
// PROBLEM: statusInterval can accumulate
let statusInterval = setInterval(checkPcStatus, 30000);

// Later, inside click handler:
clearInterval(statusInterval);
// ... new interval created
statusInterval = setInterval(checkPcStatus, 30000);

// But if user clicks multiple times rapidly before first poll completes,
// multiple fast poll intervals can exist

// RECOMMENDED: Track all intervals
let statusIntervalId = null;
let fastPollIntervalId = null;

function startStatusPolling(fast = false) {
  stopStatusPolling();
  statusIntervalId = setInterval(checkPcStatus, fast ? 5000 : 30000);
}

function stopStatusPolling() {
  if (statusIntervalId) clearInterval(statusIntervalId);
  if (fastPollIntervalId) clearInterval(fastPollIntervalId);
  statusIntervalId = null;
  fastPollIntervalId = null;
}
```

### 3.2 Race Conditions

#### WebSocket Connection Race
**Severity:** High  
**Effort:** 2 hours

```javascript
// PROBLEM: connect() can be called while a connection is in progress
function connect() {
  console.log('🔌 Connecting to:', wsUrl);
  // No guard against multiple calls
  ws = new WebSocket(wsUrl);
  ...
  ws.onclose = (e) => {
    setTimeout(connect, 2000); // Could overlap with existing reconnect
  };
}

// RECOMMENDED: Add connection state tracking
let connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
let reconnectTimeout = null;

function connect() {
  if (connectionState === 'connecting') {
    console.log('Already connecting, skipping');
    return;
  }
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  connectionState = 'connecting';
  console.log('🔌 Connecting to:', wsUrl);
  
  try {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      connectionState = 'connected';
      console.log('✅ Chat WebSocket connected');
      setStatus('');
    };
    
    ws.onclose = (e) => {
      connectionState = 'disconnected';
      console.log('🔌 Chat WebSocket closed:', e.code, e.reason);
      setStatus('Disconnected');
      
      // Prevent multiple reconnect attempts
      if (!reconnectTimeout) {
        reconnectTimeout = setTimeout(connect, 2000);
      }
    };
    
    ws.onerror = (e) => {
      console.error('❌ Chat WebSocket error:', e);
      setStatus('Connection error');
      // Don't set connectionState here - onclose will fire
    };
    
    ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch {} };
  } catch (e) {
    connectionState = 'disconnected';
    console.error('❌ Failed to create WebSocket:', e);
  }
}
```

#### Realtime Voice Double-Start
**Severity:** Medium  
**Effort:** 1 hour

```javascript
// PROBLEM: startVoice() can be called while already starting
function startVoice() {
  mode = 'voice';
  isListening = true;
  // ... but connectRealtime() is async
  connectRealtime();
}

// RECOMMENDED: Add guard
let isConnectingRealtime = false;

function startVoice() {
  if (isListening || isConnectingRealtime) {
    console.log('Voice already active/starting');
    return;
  }
  
  isConnectingRealtime = true;
  mode = 'voice';
  isListening = true;
  document.body.classList.add('voice-mode');
  bottomEl?.classList.add('voice-active');
  
  updateVoiceStatus('Connecting...');
  setStatus('Connecting...');
  
  connectRealtime();
}

// In connectRealtime():
realtimeWs.onopen = async () => {
  isConnectingRealtime = false;
  // ...
};

realtimeWs.onerror = (e) => {
  isConnectingRealtime = false;
  // ...
};
```

### 3.3 Error Handling Gaps

#### Unhandled Promise Rejections
**Severity:** Medium  
**Effort:** 2 hours

```javascript
// PROBLEM: No .catch() on many async operations
historyBtn?.addEventListener('click', async () => {
  const response = await fetch('/api/messages/all');
  // If fetch fails, promise rejection is unhandled

// RECOMMENDED: Wrap in try/catch and show user feedback
historyBtn?.addEventListener('click', async () => {
  showChatFeedPage();
  
  const loadingEl = document.createElement('div');
  loadingEl.className = 'msg system';
  loadingEl.textContent = 'Loading...';
  messagesEl.appendChild(loadingEl);
  
  try {
    const response = await fetch('/api/messages/all');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    loadingEl.remove();
    
    // ... rest of handler
  } catch (e) {
    console.error('Failed to load messages:', e);
    loadingEl.textContent = 'Failed to load history. Tap to retry.';
    loadingEl.style.cursor = 'pointer';
    loadingEl.onclick = () => {
      loadingEl.remove();
      historyBtn.click();
    };
  }
});
```

#### Silent WebSocket Failures
**Severity:** Medium  
**Effort:** 1 hour

```javascript
// PROBLEM: WebSocket send failures are silent
ws.send(JSON.stringify({ type: 'transcript', text, mode: sendMode }));

// RECOMMENDED: Check readyState and queue messages if disconnected
function safeSend(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket not ready, message not sent');
    toast('Not connected. Trying to reconnect...', true);
    connect();
    return false;
  }
  
  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Send failed:', e);
    toast('Failed to send message', true);
    return false;
  }
}
```

### 3.4 State Management Issues

#### Global State Pollution
**Severity:** Medium  
**Effort:** 4 hours (refactor)

The app uses many global variables which makes state hard to track:

```javascript
// CURRENT: ~25+ global variables
let ws = null;
let mode = 'chat';
let pageState = 'intro';
let isListening = false;
let isProcessing = false;
let audioContext = null;
let currentAudio = null;
let mediaRecorder = null;
let audioChunks = [];
let recordStart = null;
let timerInterval = null;
let mediaStream = null;
let realtimeWs = null;
// ... many more

// RECOMMENDED: Encapsulate in state object
const AppState = {
  // Connection
  ws: null,
  realtimeWs: null,
  connectionState: 'disconnected',
  
  // Mode
  mode: 'chat', // 'chat' | 'voice' | 'notes'
  pageState: 'intro', // 'intro' | 'chatfeed'
  
  // Voice state
  voice: {
    isListening: false,
    isProcessing: false,
    isSpeaking: false,
    audioContext: null,
    mediaStream: null,
    scriptProcessor: null,
  },
  
  // Notes state
  notes: {
    mediaRecorder: null,
    audioChunks: [],
    recordStart: null,
    timerInterval: null,
  },
  
  // UI state
  ui: {
    pendingAttachment: null,
    selectedMsg: null,
    articulationsMode: false,
  }
};

// Then access via AppState.voice.isListening, etc.
```

### 3.5 Browser Compatibility

#### ScriptProcessorNode Deprecation
**Severity:** Low (works today, future risk)  
**Effort:** 4 hours

```javascript
// CURRENT: Uses deprecated API
realtimeScriptProcessor = realtimeAudioContext.createScriptProcessor(4096, 1, 1);

// RECOMMENDED: Use AudioWorklet (modern browsers)
// Create worklet file: audio-processor.js
class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      this.port.postMessage({ audioData: channelData });
    }
    return true;
  }
}
registerProcessor('audio-processor', AudioProcessor);

// In main code:
async function startAudioCapture() {
  realtimeAudioContext = new AudioContext({ sampleRate: 24000 });
  await realtimeAudioContext.audioWorklet.addModule('audio-processor.js');
  
  realtimeMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const source = realtimeAudioContext.createMediaStreamSource(realtimeMediaStream);
  
  const workletNode = new AudioWorkletNode(realtimeAudioContext, 'audio-processor');
  workletNode.port.onmessage = (e) => {
    if (realtimeWs?.readyState === WebSocket.OPEN) {
      const base64Audio = float32ToBase64PCM16(e.data.audioData);
      realtimeWs.send(JSON.stringify({ type: 'audio', data: base64Audio }));
    }
  };
  
  source.connect(workletNode);
  workletNode.connect(realtimeAudioContext.destination);
}
```

---

## 4. Architecture Recommendations

### 4.1 Backend: Separate Concerns

The `server.js` file handles too many responsibilities (~600 lines):
- HTTP routing
- WebSocket handling
- Session management
- File extraction
- LLM calls
- TTS
- Wake-on-LAN

**Recommendation:** Split into modules:

```
src/
  server.js          # Express app setup, middleware
  routes/
    api.js           # REST API endpoints
    websocket.js     # WebSocket handling
  services/
    session.js       # Session management
    llm.js           # LLM/Gateway calls
    transcription.js # Whisper integration
    documents.js     # PDF/DOCX extraction
  utils/
    wol.js           # Wake-on-LAN
```

**Effort:** 8 hours

### 4.2 Frontend: Component-Based Architecture

The `app.js` file is a monolithic 1200+ line script. Consider splitting:

```
public/
  app.js                 # Main entry, initialization
  modules/
    state.js             # State management
    websocket.js         # WS connection handling
    voice.js             # Voice mode logic
    notes.js             # Notes mode logic
    chat.js              # Chat mode logic
    audio.js             # Audio playback/capture
    ui.js                # UI helpers (toast, thinking, etc.)
```

**Effort:** 12 hours

### 4.3 Fix Known Issue: Incomplete Responses

From `memory/voice-mode-issues.md`:
> "Cuts off mid-message and just says 'thank you'"

**Root Cause Analysis:**
1. OpenAI Realtime API has aggressive latency requirements
2. Token limits in realtime mode are smaller
3. Model may be optimizing for speed over completeness

**Recommended Solutions:**

1. **Hybrid Mode (Already Implemented)**: Route to Claude for processing
   - Currently available via `?mode=hybrid` query param
   - Consider making this the default for complex queries

2. **Response Length Prompting**:
```javascript
// In realtime.js, update instructions:
let instructions = `...
Important: Always complete your thoughts. Don't cut responses short.
If you have more to say, continue. Never end with just "thank you" unless appropriate.
...`;
```

3. **Detection and Retry**:
```javascript
// Detect truncated responses
case 'response.audio_transcript.done':
  if (responseTranscript.length < 20 || responseTranscript.endsWith('thank')) {
    console.warn('Possibly truncated response, retrying...');
    // Request continuation
    openaiWs.send(JSON.stringify({ 
      type: 'response.create',
      response: { instructions: 'Please continue your previous response.' }
    }));
  }
```

**Effort:** 4 hours

### 4.4 Fix Known Issue: Calendar Timezone

From `memory/voice-mode-issues.md`:
> "Event times coming through wrong (likely timezone parsing)"

**Root Cause:** The `tools.js` file creates date objects in a confusing way:

```javascript
// PROBLEM in tools.js:
const sgNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
// This creates a LOCAL date from a string representation - unreliable

// RECOMMENDED: Use proper timezone handling
import { formatInTimeZone, utcToZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Asia/Singapore';

function getCalendarTimeRange(period = 'today') {
  const now = new Date();
  const sgNow = utcToZonedTime(now, TIMEZONE);
  
  let start, end;
  
  switch (period) {
    case 'tomorrow':
      start = new Date(sgNow);
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
      break;
    case 'week':
      start = new Date(sgNow);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      break;
    default: // today
      start = new Date(sgNow);
      start.setHours(0, 0, 0, 0);
      end = new Date(sgNow);
      end.setHours(23, 59, 59, 999);
  }
  
  // Return ISO strings properly adjusted for timezone offset
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString()
  };
}
```

**Effort:** 3 hours

### 4.5 Security Considerations

#### API Keys in Config Files
**Severity:** Medium

The server reads API keys from `/home/heisenberg/.clawdbot/clawdbot.json` which is good (not in code), but:

1. No validation of token format
2. Tokens logged in some error messages
3. No rate limiting on API endpoints

**Recommendations:**
```javascript
// Add to server.js
import rateLimit from 'express-rate-limit';

// Rate limit API endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: { error: 'Too many requests' }
});

app.use('/api/', apiLimiter);

// Sanitize error messages
function sanitizeError(error) {
  const msg = error.message || String(error);
  // Remove anything that looks like a token
  return msg.replace(/[A-Za-z0-9_-]{20,}/g, '[REDACTED]');
}
```

#### WebSocket Origin Validation
**Severity:** Medium

No origin checking on WebSocket connections:

```javascript
// RECOMMENDED: Add origin validation
server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  const allowedOrigins = [
    'http://localhost:3456',
    'https://spark.yourdomain.com'
  ];
  
  if (origin && !allowedOrigins.includes(origin)) {
    console.warn(`Rejected WS connection from ${origin}`);
    socket.destroy();
    return;
  }
  
  // ... rest of upgrade handling
});
```

---

## 5. Priority Matrix

### Immediate (This Week)

| Issue | Severity | Effort | Impact |
|-------|----------|--------|--------|
| Memory leak: Audio contexts | Critical | 2h | Prevents browser crashes |
| Race condition: WebSocket | High | 2h | Prevents duplicate connections |
| Incomplete responses fix | High | 4h | Fixes user-reported issue |

### Short Term (Next 2 Weeks)

| Issue | Severity | Effort | Impact |
|-------|----------|--------|--------|
| ARIA labels | High | 2h | Accessibility compliance |
| Error handling | Medium | 2h | Better user feedback |
| Keyboard navigation | High | 3h | Accessibility compliance |
| Calendar timezone fix | Medium | 3h | Fixes user-reported issue |

### Medium Term (Next Month)

| Issue | Severity | Effort | Impact |
|-------|----------|--------|--------|
| State management refactor | Medium | 4h | Code maintainability |
| File upload progress | Medium | 1.5h | UX improvement |
| Animation smoothing | Medium | 2h | Polish |
| ScriptProcessor migration | Low | 4h | Future-proofing |

### Long Term (Backlog)

| Issue | Severity | Effort | Impact |
|-------|----------|--------|--------|
| Backend modularization | Low | 8h | Code maintainability |
| Frontend component split | Low | 12h | Code maintainability |
| Rate limiting | Medium | 2h | Security |
| WebSocket origin validation | Medium | 1h | Security |

---

## 6. Specific Code Recommendations

### 6.1 Quick Fix: Audio Context Cleanup

**File:** `public/app.js`

```javascript
// ADD: Cleanup function for all audio resources
function cleanupAllAudio() {
  // Stop thinking sound
  stopWaitingSound();
  
  // Stop audio capture
  stopAudioCapture();
  
  // Stop playback
  stopAudioPlayback();
  
  // Close shared contexts
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
    sharedAudioContext.close().catch(() => {});
    sharedAudioContext = null;
  }
  
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  
  if (realtimePlaybackContext && realtimePlaybackContext.state !== 'closed') {
    realtimePlaybackContext.close().catch(() => {});
    realtimePlaybackContext = null;
  }
}

// Call on page unload
window.addEventListener('beforeunload', cleanupAllAudio);

// Call when stopping voice
function stopVoice() {
  isListening = false;
  document.body.classList.remove('voice-mode');
  bottomEl?.classList.remove('voice-active');
  voiceBar?.classList.remove('speaking');
  
  currentUserMsg = null;
  currentAssistantMsg = null;
  
  cleanupAllAudio(); // Use comprehensive cleanup
  
  if (realtimeWs) {
    realtimeWs.send(JSON.stringify({ type: 'stop' }));
    realtimeWs.close();
    realtimeWs = null;
  }
  
  mode = 'chat';
}
```

### 6.2 Quick Fix: WebSocket Connection Guard

**File:** `public/app.js`

```javascript
// REPLACE the connect() function
let connectionState = 'disconnected';
let reconnectTimeout = null;

function connect() {
  // Guard against multiple simultaneous connections
  if (connectionState === 'connecting' || connectionState === 'connected') {
    console.log(`Connection state: ${connectionState}, skipping connect()`);
    return;
  }
  
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  connectionState = 'connecting';
  
  let wsUrl = CONFIG.wsUrl;
  if (chatSessionId) {
    wsUrl += (wsUrl.includes('?') ? '&' : '?') + `session=${chatSessionId}`;
  }
  
  console.log('🔌 Connecting to:', wsUrl);
  setStatus('Connecting...');
  
  try {
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      connectionState = 'connected';
      console.log('✅ Chat WebSocket connected');
      setStatus('');
    };
    
    ws.onclose = (e) => {
      connectionState = 'disconnected';
      ws = null;
      console.log('🔌 Chat WebSocket closed:', e.code, e.reason);
      setStatus('Disconnected');
      
      // Schedule reconnect (only if not already scheduled)
      if (!reconnectTimeout) {
        reconnectTimeout = setTimeout(() => {
          reconnectTimeout = null;
          connect();
        }, 2000);
      }
    };
    
    ws.onerror = (e) => {
      console.error('❌ Chat WebSocket error:', e);
      setStatus('Connection error');
      // onclose will fire after onerror, so state change happens there
    };
    
    ws.onmessage = (e) => {
      try {
        handle(JSON.parse(e.data));
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };
  } catch (e) {
    connectionState = 'disconnected';
    console.error('❌ Failed to create WebSocket:', e);
    setStatus('Connection failed');
    
    if (!reconnectTimeout) {
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        connect();
      }, 2000);
    }
  }
}
```

### 6.3 Backend: Add Response Validation

**File:** `src/server.js`

```javascript
// ADD: Response validation to detect truncation
async function handleTranscript(ws, session, text, mode, imageDataUrl, fileData) {
  // ... existing code ...
  
  let response;
  try {
    response = await chat(sharedHistory, model, mode, hasImage);
    
    // Validate response isn't suspiciously short
    if (response.length < 10 && text.length > 20) {
      console.warn(`[${sessionId}] Suspiciously short response, retrying...`);
      response = await chat(sharedHistory, model, mode, hasImage);
    }
    
    // Check for common truncation patterns
    const truncationPatterns = [
      /^thank you\.?$/i,
      /^okay\.?$/i,
      /^sure\.?$/i,
    ];
    
    if (truncationPatterns.some(p => p.test(response.trim())) && text.length > 30) {
      console.warn(`[${sessionId}] Possible truncation detected, requesting continuation`);
      sharedHistory.push({ role: 'assistant', content: response });
      sharedHistory.push({ role: 'user', content: 'Please continue with more detail.' });
      const continuation = await chat(sharedHistory, model, mode, hasImage);
      response = response + ' ' + continuation;
    }
    
  } catch (e) {
    // ... error handling ...
  }
  
  // ... rest of function ...
}
```

### 6.4 Add Global Error Handler

**File:** `public/app.js` (add at the end)

```javascript
// ============================================================================
// GLOBAL ERROR HANDLING
// ============================================================================

window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
  // Don't show toast for every error, just log
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  
  // Show toast for network errors
  if (e.reason?.message?.includes('fetch') || 
      e.reason?.message?.includes('network')) {
    toast('Network error. Please check your connection.', true);
  }
});

// Cleanup on page visibility change (mobile tab switching)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Stop voice mode when tab is hidden (saves battery)
    if (isListening) {
      console.log('Page hidden, pausing voice mode');
      // Don't fully stop, just pause audio capture
      stopAudioCapture();
    }
  } else if (document.visibilityState === 'visible') {
    // Resume voice mode when tab is visible again
    if (isListening && realtimeWs?.readyState === WebSocket.OPEN) {
      console.log('Page visible, resuming voice mode');
      startAudioCapture();
    }
  }
});
```

---

## Appendix: File Size Analysis

| File | Lines | Size | Complexity |
|------|-------|------|------------|
| `public/index.html` | 850 | 43KB | CSS-heavy, could extract to file |
| `public/app.js` | 1200+ | 48KB | High - needs modularization |
| `src/server.js` | 600+ | 33KB | High - needs splitting |
| `src/realtime.js` | 280 | 12KB | Moderate |
| `src/hybrid-realtime.js` | 300 | 14KB | Moderate |
| `src/tools.js` | 200 | 8KB | Low |
| `src/providers/tts.js` | 130 | 4KB | Low |
| `src/providers/llm.js` | 70 | 2KB | Low |
| `src/config.js` | 90 | 3KB | Low |

---

*End of Technical Review*
