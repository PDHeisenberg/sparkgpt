# Spark Voice Portal - Technical Review v2
*Deep QA Analysis - February 1, 2026*

## Executive Summary

The Spark Voice Portal is a well-architected voice/chat assistant with three modes: Voice (realtime), Chat (deep thinking), and Notes (transcription). The codebase is functional but has **several critical issues** that could cause crashes, memory leaks, and poor UX in production.

**Overall Health Assessment:** The core functionality works, but the code needs hardening before heavy use. The frontend has memory leaks, missing cleanup handlers, and accessibility gaps. The backend has race conditions and missing error handling in async code.

### Top 5 Critical Issues

1. **Memory Leaks in Audio Contexts** - AudioContext objects created but never closed (app.js)
2. **Missing WebSocket Error Recovery** - No reconnection logic for realtime voice mode
3. **Race Condition in Pending Requests** - Multiple requests can overwrite each other (server.js)
4. **No Microphone Permission Handling** - App crashes if mic access denied
5. **Timeout Not Cleared** - `speakingTimeout` in hybrid-realtime.js can fire after session ends

## Code Quality Score: 6.5/10

Good foundation, needs polish. Well-structured but lacks defensive programming.

---

## Critical Issues (Fix Immediately)

### Issue: Memory Leak - AudioContext Never Closed
**Severity:** Critical
**Location:** `public/app.js:418-430` (createThinkingSound), `:533` (playAudioQueueTTS)
**Problem:** Multiple AudioContext objects are created for thinking sounds and TTS playback, but many are never closed. Each AudioContext consumes system resources and browsers limit the number that can be open.
**Impact:** After extended use (10-20 voice sessions), the browser will refuse to create new AudioContexts, breaking all audio playback.
**Fix:**
```javascript
// In createThinkingSound - already has cleanup, but check playAudioQueueTTS:
async function playAudioQueueTTS() {
  // ... existing code ...
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    // ... playback code ...
    
    await new Promise(resolve => {
      source.onended = () => {
        ctx.close().catch(() => {}); // GOOD - this exists
        resolve();
      };
      source.start();
    });
  } catch (e) {
    console.error('TTS playback error:', e);
    // MISSING: Need to close ctx on error too
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {});
    }
  }
  // ...
}
```
**Effort:** 2 hours

---

### Issue: No Realtime WebSocket Reconnection
**Severity:** Critical
**Location:** `public/app.js:595-627` (connectRealtime)
**Problem:** When the realtime WebSocket disconnects, `onclose` tries to reconnect, but if the initial connection fails (e.g., server restart), there's no exponential backoff or max retry limit. Also, if `realtimeWs.onerror` fires, the user sees "Connection error" but the app is stuck.
**Impact:** Voice mode becomes permanently broken after a network hiccup until page refresh.
**Fix:**
```javascript
let realtimeReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function connectRealtime() {
  const url = getRealtimeWsUrl();
  console.log('🔗 Connecting to realtime:', url);
  
  realtimeWs = new WebSocket(url);
  
  realtimeWs.onopen = async () => {
    console.log('✅ Realtime connected');
    realtimeReconnectAttempts = 0; // Reset on success
    // ... rest of code
  };
  
  realtimeWs.onclose = () => {
    console.log('🔌 Realtime disconnected');
    if (isListening && realtimeReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(2000 * Math.pow(2, realtimeReconnectAttempts), 30000);
      realtimeReconnectAttempts++;
      setStatus(`Reconnecting (${realtimeReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      setTimeout(connectRealtime, delay);
    } else if (realtimeReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      toast('Voice connection failed. Please try again.', true);
      stopVoice();
    }
  };
  
  realtimeWs.onerror = (e) => {
    console.error('Realtime WebSocket error:', e);
    // Don't show error toast here - onclose will handle reconnection
  };
}
```
**Effort:** 2 hours

---

### Issue: Race Condition in Pending Requests Store
**Severity:** Critical
**Location:** `src/server.js:343-350`
**Problem:** If a user sends a new message while a previous one is still processing, `pendingRequests.set(sessionId, {...})` overwrites the previous pending request. The old response is lost.
**Impact:** User loses responses if they send messages too quickly. Confusing UX.
**Fix:**
```javascript
// Use a queue instead of single pending request
const pendingQueues = new Map(); // sessionId -> array of requests

async function handleTranscript(ws, session, text, mode, imageDataUrl, fileData) {
  // ... existing setup ...
  
  // Add to queue instead of replacing
  const requestId = Math.random().toString(36).slice(2, 10);
  if (!pendingQueues.has(sessionId)) {
    pendingQueues.set(sessionId, []);
  }
  pendingQueues.get(sessionId).push({ 
    requestId,
    status: 'processing', 
    startTime: Date.now(),
    text: text.slice(0, 100)
  });
  
  // Process and update specific request
  // On completion, find and update by requestId
}
```
**Effort:** 4 hours

---

### Issue: Microphone Access Denial Crashes Voice Mode
**Severity:** Critical
**Location:** `public/app.js:476-510` (startAudioCapture)
**Problem:** If `navigator.mediaDevices.getUserMedia` fails (permission denied, no mic, etc.), the function shows a toast and returns false. But the caller in `realtimeWs.onopen` doesn't properly clean up - voice mode UI stays active but non-functional.
**Impact:** User is stuck in broken voice mode state.
**Fix:**
```javascript
// In startAudioCapture:
async function startAudioCapture() {
  try {
    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Microphone not supported in this browser', true);
      return false;
    }
    
    realtimeAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    
    try {
      realtimeMediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { /* ... */ } 
      });
    } catch (micError) {
      // Specific error handling
      if (micError.name === 'NotAllowedError') {
        toast('Microphone permission denied. Please allow access.', true);
      } else if (micError.name === 'NotFoundError') {
        toast('No microphone found', true);
      } else {
        toast('Microphone error: ' + micError.message, true);
      }
      // Clean up audio context we already created
      realtimeAudioContext?.close().catch(() => {});
      realtimeAudioContext = null;
      return false;
    }
    // ... rest of function
  } catch (e) {
    console.error('Audio capture error:', e);
    toast('Audio setup failed', true);
    return false;
  }
}

// In realtimeWs.onopen - already calls stopVoice() on failure, which is correct
```
**Effort:** 1 hour

---

### Issue: Speaking Timeout Not Cleared on Session End
**Severity:** Critical
**Location:** `src/hybrid-realtime.js:166-172`
**Problem:** `speakingTimeout` is set for 30 seconds but may fire after the WebSocket session is closed, causing errors when trying to access closed connections.
**Impact:** Server errors in logs, potential memory leaks.
**Fix:**
```javascript
// Add cleanup in clientWs.on('close')
clientWs.on('close', () => {
  console.log('🔌 Client disconnected');
  // Clear speaking timeout
  if (speakingTimeout) {
    clearTimeout(speakingTimeout);
    speakingTimeout = null;
  }
  if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
    openaiWs.close();
  }
});
```
**Effort:** 15 minutes

---

## High Priority Issues

### Issue: No Timeout on Chat API Requests
**Severity:** High
**Location:** `src/server.js:504-520` (chat function)
**Problem:** The comment says "No timeout - let Claude take as long as needed" but this can cause requests to hang forever if the gateway is unresponsive.
**Impact:** Client waits forever with "Thinking..." indicator.
**Fix:**
```javascript
async function chat(history, model, mode, hasImage = false) {
  // ...
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
  
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { /* ... */ },
      body: jsonBody,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    // ...
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw new Error('Request timed out after 2 minutes');
    }
    throw e;
  }
}
```
**Effort:** 1 hour

---

### Issue: setInterval for PC Status Never Cleared
**Severity:** High
**Location:** `public/app.js:855-858`
**Problem:** `statusInterval` is created with `setInterval(checkPcStatus, 30000)` but never cleared when the page is hidden/backgrounded. On mobile, this wastes battery and network.
**Impact:** Battery drain on mobile, unnecessary network requests.
**Fix:**
```javascript
// Add visibility change handler
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(statusInterval);
    statusInterval = null;
  } else {
    // Resume checking when visible
    checkPcStatus();
    statusInterval = setInterval(checkPcStatus, 30000);
  }
});
```
**Effort:** 30 minutes

---

### Issue: Uncaught Promise Rejections in File Extraction
**Severity:** High
**Location:** `src/server.js:405-415`
**Problem:** PDF and DOCX extraction use external libraries (pdf-parse, mammoth) but errors aren't always properly caught. If the file is corrupted, the error may not be user-friendly.
**Impact:** Cryptic error messages to users, server logs full of stack traces.
**Fix:**
```javascript
if (ext === 'pdf') {
  console.log(`📄 [${sessionId}] Extracting PDF: ${fileData.filename}`);
  try {
    extractedText = await extractPdfText(fileData.dataUrl);
  } catch (pdfError) {
    throw new Error(`Could not read PDF: ${pdfError.message.includes('Invalid') ? 'File appears corrupted' : pdfError.message}`);
  }
}
```
**Effort:** 1 hour

---

### Issue: WoL Fast Polling Interval Never Cleared on Success
**Severity:** High
**Location:** `public/app.js:885-900`
**Problem:** When WoL succeeds and PC connects, `fastPoll` interval is cleared and `statusInterval` is reset. But if the user clicks the WoL button multiple times before success, multiple `fastPoll` intervals are created.
**Impact:** Multiple concurrent polling loops hammering the server.
**Fix:**
```javascript
let fastPoll = null; // Move outside click handler

pcStatusEl?.addEventListener('click', async () => {
  // Clear any existing fast poll
  if (fastPoll) {
    clearInterval(fastPoll);
    fastPoll = null;
  }
  // ... rest of handler
});
```
**Effort:** 15 minutes

---

### Issue: Missing ARIA Labels for Accessibility
**Severity:** High
**Location:** `public/index.html` (multiple buttons)
**Problem:** Many buttons lack `aria-label` attributes. Screen readers can't describe their function.
**Impact:** App is inaccessible to blind/visually impaired users.
**Fix:**
```html
<button id="voice-btn" class="circle-btn" title="Voice" aria-label="Start voice conversation">
<button id="notes-btn" class="circle-btn" title="Voice Note" aria-label="Record voice note">
<button id="send-btn" aria-label="Send message">
<button id="upload-btn" title="Attach file" aria-label="Attach file">
<!-- Add to all interactive elements -->
```
**Effort:** 2 hours

---

## Medium Priority Issues

### Issue: Waveform Bars Hardcoded (50 divs)
**Severity:** Medium
**Location:** `public/index.html:603-605`
**Problem:** 50 waveform bar divs are hardcoded in HTML, each with individual CSS animation delays. This is bloated and hard to maintain.
**Impact:** Larger HTML payload, harder to modify animation.
**Fix:**
```javascript
// Generate dynamically in app.js
function initWaveform() {
  const waveform = document.getElementById('waveform');
  if (!waveform) return;
  waveform.innerHTML = '';
  for (let i = 0; i < 50; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.animationDelay = `${(i % 17) * 0.03}s`;
    waveform.appendChild(bar);
  }
}
initWaveform();
```
**Effort:** 30 minutes

---

### Issue: Console.log Statements in Production
**Severity:** Medium
**Location:** Throughout all files
**Problem:** Heavy console logging in production code. Every message, every state change is logged.
**Impact:** Performance overhead, exposes internal state in browser console.
**Fix:**
```javascript
// Add a debug flag or use a logging utility
const DEBUG = location.hostname === 'localhost';
function log(...args) {
  if (DEBUG) console.log(...args);
}
```
**Effort:** 2 hours

---

### Issue: Theme Toggle Doesn't Respect System Preference Initially
**Severity:** Medium
**Location:** `public/app.js:32-48`
**Problem:** If user has never set a theme, the system preference is used via CSS media query. But the JS toggle logic doesn't know this initial state, causing confusing first toggle behavior.
**Impact:** First theme toggle might not do what user expects.
**Fix:**
```javascript
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }
  // Explicitly set if no saved preference to sync JS state
  else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    localStorage.setItem('theme', prefersDark ? 'dark' : 'light');
  }
}
```
**Effort:** 15 minutes

---

### Issue: Double-Click Prevention Inconsistent
**Severity:** Medium
**Location:** `public/app.js:841-847`
**Problem:** Double-tap zoom prevention uses a passive:false event listener that prevents all touchends within 300ms. This can interfere with legitimate rapid interactions.
**Impact:** Some fast taps may be ignored.
**Fix:**
```javascript
// More targeted approach - only prevent on specific elements
document.querySelectorAll('button, .shortcut').forEach(el => {
  el.addEventListener('touchend', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      const now = Date.now();
      if (now - (el._lastTouchEnd || 0) <= 300) {
        e.preventDefault();
      }
      el._lastTouchEnd = now;
    }
  }, { passive: false });
});
```
**Effort:** 1 hour

---

### Issue: Long Message Handling
**Severity:** Medium
**Location:** `public/app.js:125-140` (formatMessage)
**Problem:** Very long messages (10,000+ characters) are rendered as-is, potentially causing performance issues and layout problems.
**Impact:** UI lag, horizontal scrolling on mobile.
**Fix:**
```javascript
function formatMessage(text) {
  // Truncate extremely long messages with expansion
  const MAX_LENGTH = 5000;
  let truncated = false;
  if (text.length > MAX_LENGTH) {
    text = text.slice(0, MAX_LENGTH);
    truncated = true;
  }
  
  let formatted = text
    .replace(/&/g, '&amp;')
    // ... rest of formatting ...
  
  if (truncated) {
    formatted += '<p class="truncated">[Message truncated - click to expand]</p>';
  }
  return formatted;
}
```
**Effort:** 1 hour

---

### Issue: Session Cleanup for Stale Sessions
**Severity:** Medium
**Location:** `src/server.js:295-305`
**Problem:** The `sessions` Map grows unbounded. Old sessions are never cleaned up.
**Impact:** Memory growth over time, potential OOM crash on long-running server.
**Fix:**
```javascript
// Add periodic cleanup
setInterval(() => {
  const now = Date.now();
  const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.createdAt > MAX_AGE && !session.ws) {
      sessions.delete(sessionId);
      pendingRequests.delete(sessionId);
      console.log(`🧹 Cleaned up stale session: ${sessionId}`);
    }
  }
}, 60 * 60 * 1000); // Every hour
```
**Effort:** 30 minutes

---

## Low Priority / Nice to Have

### Issue: Magic Numbers Scattered Throughout
**Severity:** Low
**Location:** Multiple files
**Problem:** Numbers like `24000` (sample rate), `50000` (truncate length), `20` (history limit) are hardcoded.
**Impact:** Harder to tune and maintain.
**Fix:** Create a constants file or config section.
**Effort:** 2 hours

---

### Issue: CSS Variables Duplicated for Dark Mode
**Severity:** Low
**Location:** `public/index.html:41-90`
**Problem:** Same dark mode variables are defined twice - once for `@media (prefers-color-scheme: dark)` and once for `[data-theme="dark"]`.
**Impact:** DRY violation, double maintenance burden.
**Fix:** Use CSS custom properties mixin or a single source of truth.
**Effort:** 1 hour

---

### Issue: No Loading State for Shortcut Buttons
**Severity:** Low
**Location:** `public/app.js:909-913`
**Problem:** Clicking a shortcut button immediately sends the message, but there's no visual feedback that the button was clicked (no disabled state, no animation).
**Impact:** User might click multiple times thinking nothing happened.
**Fix:**
```javascript
document.querySelectorAll('.shortcut').forEach(btn => {
  btn.addEventListener('click', () => {
    const msg = btn.dataset.msg;
    if (msg) {
      btn.disabled = true;
      btn.style.opacity = '0.6';
      send(msg, 'chat');
      setTimeout(() => {
        btn.disabled = false;
        btn.style.opacity = '';
      }, 2000);
    }
  });
});
```
**Effort:** 30 minutes

---

### Issue: File Size Limit Not Enforced on Frontend
**Severity:** Low
**Location:** `public/app.js:969-988`
**Problem:** No file size validation before upload. Very large files will be read into memory and sent over WebSocket.
**Impact:** Browser memory issues, slow uploads, potential WebSocket frame size limits hit.
**Fix:**
```javascript
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

fileInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  
  if (file.size > MAX_FILE_SIZE) {
    toast(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`, true);
    fileInput.value = '';
    return;
  }
  // ... rest of handler
});
```
**Effort:** 15 minutes

---

## Architecture Recommendations

### 1. Separate CSS from HTML
Move the 600+ lines of CSS to a separate `styles.css` file. Use a build step (Vite, esbuild) for production bundling.

### 2. Add TypeScript
The codebase would benefit from TypeScript for better IDE support and catching bugs early. The WebSocket message types especially need better typing.

### 3. State Management
Consider a small state management solution (Zustand, or just a central state object) instead of scattered global variables. Current globals:
- `ws`, `mode`, `pageState`, `isListening`, `isProcessing`, `audioContext`, `currentAudio`, `mediaRecorder`, `audioChunks`, `recordStart`, `timerInterval`, `mediaStream`, `realtimeWs`, `realtimeAudioContext`, `realtimeMediaStream`, `realtimeScriptProcessor`, `realtimePlaybackContext`, `audioQueue`, `isPlaying`, `thinkingAudio`, `thinkingInterval`, `currentUserMsg`, `currentAssistantMsg`, `waveAnimationFrame`, `analyserNode`, `ttsAudioBuffer`, `chatSessionId`, `selectedMsg`, `longPressTimer`, `articulationsMode`, `pendingAttachment`, `statusInterval`, `fastPoll`, `hybridWs`

### 4. WebSocket Message Validation
Add Zod or similar for validating WebSocket messages on both client and server. Currently trusting that messages are well-formed.

### 5. Error Boundary Pattern
Wrap major UI sections in error boundaries (even in vanilla JS) to prevent one component's error from crashing the whole app.

---

## Security Considerations

### 1. No XSS Sanitization
**Location:** `public/app.js:125-140`
**Risk:** The `formatMessage` function does basic HTML escaping but doesn't sanitize markdown-style formatting. If user input contains malicious patterns, they might slip through.
**Recommendation:** Use DOMPurify or similar for all HTML rendering.

### 2. File Content Sent Over WebSocket
**Risk:** Entire file contents (up to 50KB+ for PDFs) are sent as JSON over WebSocket. No encryption beyond HTTPS.
**Recommendation:** For sensitive documents, consider additional encryption or limiting what can be uploaded.

### 3. Session ID in URL and LocalStorage
**Risk:** Session IDs are stored in localStorage and sent in WebSocket URLs. XSS could steal them.
**Recommendation:** Consider httpOnly cookies for session management instead.

### 4. API Keys in Config Files
**Location:** Various paths like `/home/heisenberg/.clawdbot/`
**Risk:** Config files contain API keys. If server is compromised, all keys are exposed.
**Recommendation:** Use environment variables or a secrets manager.

---

## Performance Opportunities

### 1. Audio Worklet Instead of ScriptProcessorNode
**Location:** `public/app.js:492-510`
**Issue:** `ScriptProcessorNode` is deprecated and runs on main thread, potentially causing audio glitches.
**Fix:** Migrate to AudioWorklet for better performance.
**Effort:** 4 hours

### 2. Debounce PC Status Checks
**Location:** `public/app.js:853-858`
**Issue:** Status checks run every 30 seconds regardless of user activity.
**Fix:** Only check when user is actively using the app.

### 3. Lazy Load History
**Location:** `public/app.js:105-135`
**Issue:** Loading all messages at once for history view could be slow with large histories.
**Fix:** Implement pagination or virtual scrolling.

### 4. Image Compression Before Upload
**Issue:** Images are sent at full resolution as base64.
**Fix:** Resize/compress images on client before sending.

---

## Appendix: File-by-File Notes

### public/index.html (~1100 lines)
- **Good:** Modern CSS with variables, glassmorphism, responsive design
- **Good:** Proper meta viewport, safe area insets handled
- **Issue:** Inline CSS should be separate file
- **Issue:** 50 hardcoded waveform divs
- **Issue:** Missing ARIA labels on most interactive elements

### public/app.js (~1050 lines)
- **Good:** Well-organized sections with clear comments
- **Good:** Handles multiple modes (chat, voice, notes)
- **Issue:** 30+ global variables
- **Issue:** Multiple AudioContext leaks
- **Issue:** No cleanup on page unload
- **Issue:** Console.log everywhere

### src/server.js (~600 lines)
- **Good:** Clean Express setup
- **Good:** Session persistence across reconnects
- **Good:** PDF/DOCX extraction
- **Issue:** Unbounded session Map growth
- **Issue:** Race condition in pending requests
- **Issue:** No request timeout

### src/realtime.js (~230 lines)
- **Good:** Clean OpenAI Realtime API integration
- **Good:** Tool calling support
- **Issue:** No reconnection logic
- **Issue:** `pendingFunctionCall` can be orphaned

### src/hybrid-realtime.js (~280 lines)
- **Good:** Echo cancellation via speaking state
- **Good:** Fallback to Claude when GPT unavailable
- **Issue:** `speakingTimeout` not cleared on close
- **Issue:** No error recovery for TTS failures

### src/tools.js (~170 lines)
- **Good:** Clean tool abstraction
- **Good:** Proper error handling
- **Minor:** Could cache Google access token

### src/config.js (~70 lines)
- **Good:** Clean config loading
- **Minor:** `getDefaultSystemPrompt()` is defined but never exported/used

### src/providers/tts.js (~130 lines)
- **Good:** Provider abstraction
- **Good:** Multiple provider support
- **Issue:** No timeout on TTS API calls

### src/providers/llm.js (~80 lines)
- **Good:** Clean abstraction
- **Issue:** Hardcoded model, not using config
- **Note:** This file seems unused - server.js has its own chat() function

---

## Summary of Effort Estimates

| Priority | Issue Count | Total Effort |
|----------|-------------|--------------|
| Critical | 5 | ~10 hours |
| High | 6 | ~7 hours |
| Medium | 6 | ~7 hours |
| Low | 4 | ~4 hours |
| **Total** | **21** | **~28 hours** |

Recommended approach: Fix all Critical issues first (1 day), then High priority (1 day), then Medium/Low over time during regular development.
