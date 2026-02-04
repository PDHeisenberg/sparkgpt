/**
 * SparkGPT - Gateway Service
 * 
 * Communication with Clawdbot Gateway for session unification
 */

// Session unification config
export const UNIFIED_SESSION = process.env.UNIFIED_SESSION !== 'false';
export const UNIFIED_GATEWAY_URL = 'http://localhost:18789';
export const UNIFIED_HOOK_TOKEN = 'spark-portal-hook-token-2026';
export const UNIFIED_SESSION_KEY = 'agent:main:main';

// Message queue state
const messageQueue = [];
let gatewayConnecting = false;
let queueDrainTimer = null;
const QUEUE_CHECK_INTERVAL = 3000;
const MAX_QUEUE_SIZE = 50;

// Callbacks for queue processing (set by server.js)
let routeThroughClawdbotFn = null;
let sendToClientFn = null;

export function setQueueCallbacks(routeFn, sendFn) {
  routeThroughClawdbotFn = routeFn;
  sendToClientFn = sendFn;
}

/**
 * Check if gateway/WhatsApp is ready
 */
export async function checkGatewayStatus() {
  try {
    const response = await fetch(`${UNIFIED_GATEWAY_URL}/api/status`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UNIFIED_HOOK_TOKEN}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return { ready: false, connecting: false };
    const status = await response.json();
    const whatsapp = status.channels?.whatsapp;
    if (!whatsapp) return { ready: false, connecting: false };
    const connected = whatsapp.connected === true;
    const running = whatsapp.running === true;
    return { ready: connected, connecting: running && !connected };
  } catch (e) {
    return { ready: false, connecting: false };
  }
}

/**
 * Queue a message for later delivery
 */
export function queueMessage(ws, sessionId, text, resolve) {
  if (messageQueue.length >= MAX_QUEUE_SIZE) {
    console.warn(`⚠️ Message queue full (${MAX_QUEUE_SIZE}), rejecting message`);
    return false;
  }
  messageQueue.push({ ws, sessionId, text, resolve, queuedAt: Date.now() });
  console.log(`📥 [${sessionId}] Message queued (${messageQueue.length} pending)`);
  return true;
}

/**
 * Drain queued messages when connection is restored
 */
export async function drainMessageQueue() {
  if (messageQueue.length === 0) return;
  
  const status = await checkGatewayStatus();
  if (!status.ready) {
    if (status.connecting) {
      console.log(`⏳ Gateway connecting, ${messageQueue.length} messages queued...`);
    }
    return;
  }
  
  console.log(`✅ Gateway ready, draining ${messageQueue.length} queued messages...`);
  gatewayConnecting = false;
  
  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    const waitTime = Date.now() - item.queuedAt;
    console.log(`📤 [${item.sessionId}] Processing queued message (waited ${Math.round(waitTime/1000)}s)`);
    
    try {
      if (routeThroughClawdbotFn) {
        await routeThroughClawdbotFn(item.ws, item.sessionId, item.text, true);
      }
      if (item.resolve) item.resolve(true);
    } catch (e) {
      console.error(`❌ [${item.sessionId}] Failed to process queued message:`, e.message);
      if (sendToClientFn) {
        sendToClientFn(item.sessionId, { type: 'error', message: `Queued message failed: ${e.message}` });
        sendToClientFn(item.sessionId, { type: 'done' });
      }
      if (item.resolve) item.resolve(false);
    }
  }
  
  if (messageQueue.length === 0 && queueDrainTimer) {
    clearInterval(queueDrainTimer);
    queueDrainTimer = null;
  }
}

/**
 * Start queue drain timer
 */
export function startQueueDrainTimer() {
  if (queueDrainTimer) return;
  queueDrainTimer = setInterval(drainMessageQueue, QUEUE_CHECK_INTERVAL);
  console.log(`⏱️ Queue drain timer started`);
}

/**
 * Stop queue drain timer
 */
export function stopQueueDrainTimer() {
  if (queueDrainTimer) {
    clearInterval(queueDrainTimer);
    queueDrainTimer = null;
  }
}

/**
 * Detect if error indicates connecting state (vs permanent failure)
 */
export function isConnectingError(errorText) {
  const connectingPatterns = [
    /no active.*whatsapp.*listener/i,
    /no active.*web.*listener/i,
    /whatsapp.*not.*connected/i,
    /whatsapp.*connecting/i,
    /whatsapp.*reconnect/i,
    /web.*socket.*closed/i,
    /gateway.*connecting/i
  ];
  return connectingPatterns.some(p => p.test(errorText));
}

/**
 * Send message to main session via gateway webhook
 */
export async function sendToMainSession(text, source = 'Spark Portal') {
  if (!UNIFIED_SESSION) {
    return null;
  }
  
  try {
    const response = await fetch(`${UNIFIED_GATEWAY_URL}/hooks/agent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNIFIED_HOOK_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: text,
        name: source,
        sessionKey: UNIFIED_SESSION_KEY,
        deliver: false,
        timeoutSeconds: 120
      })
    });
    
    if (!response.ok) {
      console.error('Gateway webhook error:', response.status, await response.text());
      return null;
    }
    
    const result = await response.json();
    return result;
  } catch (e) {
    console.error('Failed to send to main session:', e.message);
    return null;
  }
}

/**
 * Get message queue length
 */
export function getQueueLength() {
  return messageQueue.length;
}

/**
 * Check if gateway is connecting
 */
export function isGatewayConnecting() {
  return gatewayConnecting;
}

/**
 * Set gateway connecting state
 */
export function setGatewayConnecting(value) {
  gatewayConnecting = value;
}
