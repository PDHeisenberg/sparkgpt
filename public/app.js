/**
 * Spark Voice - Conversational AI Assistant
 */

import * as THREE from 'three';

// ============================================================================
// CONFIG
// ============================================================================

const CONFIG = {
  wsUrl: `wss://${location.host}`,
  reconnectDelay: 2000,
  silenceThreshold: 1200,
};

// ============================================================================
// ELEMENTS
// ============================================================================

const $ = (id) => document.getElementById(id);
const body = document.body;
const canvas = $('robot-canvas');
const statusEl = $('status');
const chatEl = $('chat');
const connectionEl = $('connection');
const muteBtn = $('mute-btn');
const errorEl = $('error');

// ============================================================================
// STATE
// ============================================================================

let ws = null;
let recognition = null;
let isListening = false;
let isMuted = false;
let isProcessing = false;
let audioContext = null;
let robot = null;
let currentInterimEl = null;

// ============================================================================
// CHAT UI
// ============================================================================

function addMessage(text, type = 'user') {
  const msg = document.createElement('div');
  msg.className = `message ${type}`;
  
  if (type === 'bot') {
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = 'Spark';
    msg.appendChild(name);
    
    const content = document.createElement('div');
    content.textContent = text;
    msg.appendChild(content);
  } else {
    msg.textContent = text;
  }
  
  chatEl.appendChild(msg);
  scrollToBottom();
  return msg;
}

function showInterim(text) {
  if (!currentInterimEl) {
    currentInterimEl = document.createElement('div');
    currentInterimEl.className = 'message user interim';
    chatEl.appendChild(currentInterimEl);
  }
  currentInterimEl.textContent = text;
  scrollToBottom();
}

function clearInterim() {
  if (currentInterimEl) {
    currentInterimEl.remove();
    currentInterimEl = null;
  }
}

function showThinking() {
  const msg = document.createElement('div');
  msg.className = 'message bot thinking';
  msg.id = 'thinking-msg';
  
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = 'Spark';
  msg.appendChild(name);
  
  const content = document.createElement('span');
  content.textContent = 'Thinking';
  msg.appendChild(content);
  
  chatEl.appendChild(msg);
  scrollToBottom();
}

function removeThinking() {
  const el = $('thinking-msg');
  if (el) el.remove();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

// ============================================================================
// MINI ROBOT AVATAR
// ============================================================================

class MiniRobot {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    
    this.state = 'idle';
    this.mouthOpen = 0;
    this.targetMouth = 0;
    this.blinkTimer = 2;
    this.isBlinking = false;
    
    this.init();
  }

  init() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    this.camera.position.set(0, 0.3, 4);
    this.camera.lookAt(0, 0.2, 0);

    this.renderer = new THREE.WebGLRenderer({ 
      canvas: this.canvas, 
      antialias: true, 
      alpha: true 
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(2, 3, 3);
    this.scene.add(light);

    this.buildRobot();
    this.animate();
  }

  buildRobot() {
    this.group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f5, roughness: 0.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff });

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 24, 24).scale(1.2, 1, 1),
      bodyMat
    );
    head.position.y = 0.5;
    this.group.add(head);

    // Visor
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 24, 24).scale(1.1, 0.8, 0.4),
      darkMat
    );
    visor.position.set(0, 0.55, 0.3);
    this.group.add(visor);

    // Eyes
    this.leftEye = this.createEye(-0.25, 0.6, 0.45);
    this.rightEye = this.createEye(0.25, 0.6, 0.45);

    // Mouth
    this.mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.05),
      glowMat
    );
    this.mouth.position.set(0, 0.35, 0.5);
    this.group.add(this.mouth);

    // Body
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.4, 12, 16),
      bodyMat
    );
    body.position.y = -0.35;
    this.group.add(body);

    this.scene.add(this.group);
  }

  createEye(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 16),
      new THREE.MeshBasicMaterial({ color: 0x00d4ff, transparent: true, opacity: 0.4 })
    );
    group.add(glow);
    group.userData.glow = glow;

    const eye = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 16),
      new THREE.MeshBasicMaterial({ color: 0x00d4ff })
    );
    eye.position.z = 0.01;
    group.add(eye);

    const lid = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x1a1a2e })
    );
    lid.position.set(0, 0.15, 0.02);
    group.add(lid);
    group.userData.lid = lid;

    this.group.add(group);
    return group;
  }

  setState(state) {
    this.state = state;
  }

  setMouthOpen(val) {
    this.targetMouth = Math.max(0, Math.min(1, val));
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    // Breathing
    this.group.position.y = Math.sin(time * 1.5) * 0.02;
    this.group.rotation.y = Math.sin(time * 0.5) * 0.05;

    // Mouth
    this.mouthOpen += (this.targetMouth - this.mouthOpen) * 0.3;
    this.mouth.scale.y = 1 + this.mouthOpen * 3;

    // Blinking
    this.blinkTimer -= delta;
    if (this.blinkTimer <= 0 && !this.isBlinking) {
      this.isBlinking = true;
      this.blinkTimer = 0.15;
    } else if (this.isBlinking && this.blinkTimer <= 0) {
      this.isBlinking = false;
      this.blinkTimer = 2 + Math.random() * 3;
    }

    const lidY = this.isBlinking ? 0.02 : 0.15;
    [this.leftEye, this.rightEye].forEach(e => {
      e.userData.lid.position.y = lidY;
      // Glow based on state
      const intensity = this.state === 'speaking' ? 0.6 : 
                       this.state === 'thinking' ? 0.3 + Math.sin(time * 4) * 0.2 : 0.4;
      e.userData.glow.material.opacity = intensity;
    });

    this.renderer.render(this.scene, this.camera);
  }
}

// ============================================================================
// SEAMLESS SPEECH RECOGNITION
// ============================================================================

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError('Speech not supported');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';
  let silenceTimer = null;

  recognition.onresult = (event) => {
    if (isProcessing) return;

    let interim = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript + ' ';
      } else {
        interim += result[0].transcript;
      }
    }

    if (interim) {
      showInterim(interim);
      robot?.setState('listening');
    }

    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (finalTranscript.trim() && !isProcessing) {
        clearInterim();
        sendMessage(finalTranscript.trim());
        finalTranscript = '';
      }
    }, CONFIG.silenceThreshold);
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      console.error('Speech error:', e.error);
    }
  };

  recognition.onend = () => {
    if (!isMuted) {
      try { recognition.start(); } catch (e) {}
    }
  };

  return true;
}

function startListening() {
  if (!recognition || isMuted) return;
  isProcessing = false;
  try {
    recognition.start();
    isListening = true;
    setStatus('listening', 'Listening...');
    muteBtn.classList.add('listening');
    muteBtn.classList.remove('active');
    robot?.setState('listening');
  } catch (e) {}
}

// ============================================================================
// WEBSOCKET
// ============================================================================

function connect() {
  ws = new WebSocket(CONFIG.wsUrl);

  ws.onopen = () => {
    connectionEl.className = 'connected';
    body.classList.remove('loading');
    startListening();
  };

  ws.onclose = () => {
    connectionEl.className = '';
    setStatus('', 'Disconnected');
    setTimeout(connect, CONFIG.reconnectDelay);
  };

  ws.onerror = () => {
    connectionEl.className = 'error';
  };

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (e) {
      console.error('Parse error:', e);
    }
  };
}

function sendMessage(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  isProcessing = true;
  addMessage(text, 'user');
  showThinking();
  setStatus('thinking', 'Thinking...');
  robot?.setState('thinking');
  
  ws.send(JSON.stringify({ type: 'transcript', text }));
}

function handleMessage(data) {
  switch (data.type) {
    case 'ready':
      setStatus('listening', 'Listening...');
      break;
      
    case 'thinking':
      setStatus('thinking', 'Thinking...');
      robot?.setState('thinking');
      break;
      
    case 'text':
      removeThinking();
      addMessage(data.content, 'bot');
      break;
      
    case 'audio':
      playAudio(data.data);
      setStatus('speaking', '');
      robot?.setState('speaking');
      break;
      
    case 'done':
      isProcessing = false;
      setStatus('listening', 'Listening...');
      robot?.setState('idle');
      break;
      
    case 'error':
      removeThinking();
      showError(data.message || 'Error');
      isProcessing = false;
      setStatus('listening', 'Listening...');
      robot?.setState('idle');
      break;
  }
}

// ============================================================================
// AUDIO PLAYBACK
// ============================================================================

let currentSource = null;

async function playAudio(base64) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  try {
    // Decode base64
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const buffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));
    
    if (currentSource) {
      try { currentSource.stop(); } catch (e) {}
    }

    currentSource = audioContext.createBufferSource();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    currentSource.buffer = buffer;
    currentSource.connect(analyser);
    analyser.connect(audioContext.destination);
    
    // Lip sync
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let active = true;
    
    const updateMouth = () => {
      if (!active) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.slice(2, 12).reduce((a, b) => a + b, 0) / 10;
      robot?.setMouthOpen(avg / 180);
      requestAnimationFrame(updateMouth);
    };
    updateMouth();
    
    currentSource.onended = () => {
      active = false;
      robot?.setMouthOpen(0);
      currentSource = null;
    };
    
    currentSource.start(0);
  } catch (e) {
    console.error('Audio error:', e);
    robot?.setMouthOpen(0);
  }
}

// ============================================================================
// UI
// ============================================================================

function setStatus(state, text) {
  statusEl.textContent = text;
  statusEl.className = state;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add('show');
  setTimeout(() => errorEl.classList.remove('show'), 3000);
}

// ============================================================================
// INIT
// ============================================================================

function init() {
  robot = new MiniRobot(canvas);

  if (!initSpeech()) {
    showError('Speech not supported');
  }

  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    
    if (isMuted) {
      muteBtn.classList.remove('listening');
      muteBtn.classList.add('active');
      try { recognition?.stop(); } catch (e) {}
      setStatus('', 'Muted');
      robot?.setState('idle');
    } else {
      startListening();
    }
  });

  connect();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
