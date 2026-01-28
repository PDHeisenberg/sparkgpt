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
const transcriptEl = $('transcript');
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
let isProcessing = false; // True when waiting for response
let audioContext = null;
let robot = null;

// ============================================================================
// EXPRESSIVE ROBOT AVATAR
// ============================================================================

class ExpressiveRobot {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    
    // Animation state
    this.state = 'idle'; // idle, listening, thinking, speaking
    this.mouthOpenness = 0;
    this.targetMouthOpenness = 0;
    this.blinkProgress = 0;
    this.nextBlink = 2;
    this.breathPhase = 0;
    this.headTilt = { x: 0, y: 0 };
    this.targetHeadTilt = { x: 0, y: 0 };
    this.eyeScale = 1;
    this.targetEyeScale = 1;
    this.pupilOffset = { x: 0, y: 0 };
    this.glowIntensity = 0.3;
    this.targetGlowIntensity = 0.3;
    
    this.init();
  }

  init() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    // Camera
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    this.camera.position.set(0, 0.2, 5);
    this.camera.lookAt(0, 0.2, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: this.canvas, 
      antialias: true, 
      alpha: true 
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(2, 4, 3);
    this.scene.add(keyLight);
    
    const rimLight = new THREE.DirectionalLight(0x00d4ff, 0.4);
    rimLight.position.set(-3, 2, -2);
    this.scene.add(rimLight);

    this.buildRobot();
    window.addEventListener('resize', () => this.resize());
    this.animate();
  }

  buildRobot() {
    this.robotGroup = new THREE.Group();

    // Materials
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0f0f5,
      roughness: 0.2,
      metalness: 0.1,
    });

    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.3,
      metalness: 0.2,
    });

    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.9,
    });

    // Head - smooth capsule shape
    const headGeom = new THREE.SphereGeometry(0.8, 32, 32);
    headGeom.scale(1.2, 1, 1);
    const head = new THREE.Mesh(headGeom, bodyMaterial);
    head.position.y = 0.8;
    this.robotGroup.add(head);

    // Face screen (visor)
    const visorGeom = new THREE.SphereGeometry(0.7, 32, 32);
    visorGeom.scale(1.15, 0.85, 0.5);
    const visor = new THREE.Mesh(visorGeom, darkMaterial);
    visor.position.set(0, 0.85, 0.35);
    this.robotGroup.add(visor);

    // Eyes container
    this.eyesGroup = new THREE.Group();
    this.eyesGroup.position.set(0, 0.9, 0.55);
    this.robotGroup.add(this.eyesGroup);

    // Left eye
    this.leftEye = this.createEye(-0.3, 0);
    this.eyesGroup.add(this.leftEye);

    // Right eye  
    this.rightEye = this.createEye(0.3, 0);
    this.eyesGroup.add(this.rightEye);

    // Mouth
    this.mouthGroup = new THREE.Group();
    this.mouthGroup.position.set(0, 0.55, 0.6);
    this.robotGroup.add(this.mouthGroup);

    const mouthGeom = new THREE.PlaneGeometry(0.3, 0.08);
    this.mouth = new THREE.Mesh(mouthGeom, this.glowMaterial);
    this.mouthGroup.add(this.mouth);

    // Ear accents
    const earGeom = new THREE.CylinderGeometry(0.1, 0.12, 0.2, 16);
    const leftEar = new THREE.Mesh(earGeom, bodyMaterial);
    leftEar.position.set(-1, 0.9, 0);
    leftEar.rotation.z = 0.2;
    this.robotGroup.add(leftEar);

    const rightEar = new THREE.Mesh(earGeom, bodyMaterial);
    rightEar.position.set(1, 0.9, 0);
    rightEar.rotation.z = -0.2;
    this.robotGroup.add(rightEar);

    // Antenna
    const antennaGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8);
    const antenna = new THREE.Mesh(antennaGeom, bodyMaterial);
    antenna.position.set(0, 1.7, 0);
    this.robotGroup.add(antenna);

    const antennaTipGeom = new THREE.SphereGeometry(0.08, 16, 16);
    this.antennaTip = new THREE.Mesh(antennaTipGeom, this.glowMaterial);
    this.antennaTip.position.set(0, 1.9, 0);
    this.robotGroup.add(this.antennaTip);

    // Body
    const bodyGeom = new THREE.CapsuleGeometry(0.5, 0.6, 16, 24);
    const bodyMesh = new THREE.Mesh(bodyGeom, bodyMaterial);
    bodyMesh.position.y = -0.4;
    this.robotGroup.add(bodyMesh);

    // Chest light
    const chestGeom = new THREE.CircleGeometry(0.12, 24);
    this.chestLight = new THREE.Mesh(chestGeom, this.glowMaterial);
    this.chestLight.position.set(0, -0.25, 0.51);
    this.robotGroup.add(this.chestLight);

    // Shadow
    const shadowGeom = new THREE.CircleGeometry(0.7, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.15,
    });
    this.shadow = new THREE.Mesh(shadowGeom, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -1.1;
    this.robotGroup.add(this.shadow);

    this.scene.add(this.robotGroup);
  }

  createEye(x, y) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(x, y, 0);

    // Eye glow (outer)
    const glowGeom = new THREE.CircleGeometry(0.18, 24);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    glow.position.z = -0.01;
    eyeGroup.add(glow);
    eyeGroup.userData.glow = glow;

    // Eye main
    const eyeGeom = new THREE.CircleGeometry(0.14, 24);
    const eye = new THREE.Mesh(eyeGeom, this.glowMaterial.clone());
    eyeGroup.add(eye);
    eyeGroup.userData.main = eye;

    // Pupil (darker center)
    const pupilGeom = new THREE.CircleGeometry(0.05, 16);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x006688 });
    const pupil = new THREE.Mesh(pupilGeom, pupilMat);
    pupil.position.z = 0.01;
    eyeGroup.add(pupil);
    eyeGroup.userData.pupil = pupil;

    // Eyelid (for blinking)
    const lidGeom = new THREE.PlaneGeometry(0.4, 0.2);
    const lidMat = new THREE.MeshBasicMaterial({ color: 0x1a1a2e });
    const lid = new THREE.Mesh(lidGeom, lidMat);
    lid.position.set(0, 0.2, 0.02);
    eyeGroup.add(lid);
    eyeGroup.userData.lid = lid;

    return eyeGroup;
  }

  setState(state) {
    this.state = state;
    
    switch (state) {
      case 'listening':
        this.targetEyeScale = 1.1;
        this.targetGlowIntensity = 0.5;
        this.targetHeadTilt = { x: 0.05, y: 0 };
        break;
      case 'thinking':
        this.targetEyeScale = 0.9;
        this.targetGlowIntensity = 0.7;
        this.targetHeadTilt = { x: -0.1, y: 0.1 };
        break;
      case 'speaking':
        this.targetEyeScale = 1.05;
        this.targetGlowIntensity = 0.6;
        this.targetHeadTilt = { x: 0, y: 0 };
        break;
      default: // idle
        this.targetEyeScale = 1;
        this.targetGlowIntensity = 0.3;
        this.targetHeadTilt = { x: 0, y: 0 };
    }
  }

  setMouthOpen(value) {
    this.targetMouthOpenness = Math.max(0, Math.min(1, value));
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    // Smooth transitions
    const lerp = (a, b, t) => a + (b - a) * Math.min(1, t);
    const smoothing = delta * 8;

    this.mouthOpenness = lerp(this.mouthOpenness, this.targetMouthOpenness, smoothing);
    this.eyeScale = lerp(this.eyeScale, this.targetEyeScale, smoothing);
    this.glowIntensity = lerp(this.glowIntensity, this.targetGlowIntensity, smoothing);
    this.headTilt.x = lerp(this.headTilt.x, this.targetHeadTilt.x, smoothing * 0.5);
    this.headTilt.y = lerp(this.headTilt.y, this.targetHeadTilt.y, smoothing * 0.5);

    // Breathing animation
    this.breathPhase += delta * 1.2;
    const breathOffset = Math.sin(this.breathPhase) * 0.02;
    this.robotGroup.position.y = breathOffset;
    this.shadow.scale.setScalar(1 - breathOffset * 2);

    // Gentle sway
    this.robotGroup.rotation.z = Math.sin(time * 0.5) * 0.02;
    
    // Head tilt
    this.robotGroup.rotation.x = this.headTilt.x;
    this.robotGroup.rotation.y = this.headTilt.y + Math.sin(time * 0.3) * 0.03;

    // Blinking
    this.nextBlink -= delta;
    if (this.nextBlink <= 0) {
      this.blinkProgress = 1;
      this.nextBlink = 2 + Math.random() * 4;
    }
    if (this.blinkProgress > 0) {
      this.blinkProgress = Math.max(0, this.blinkProgress - delta * 8);
    }

    // Update eyes
    [this.leftEye, this.rightEye].forEach((eye, i) => {
      // Scale
      eye.scale.setScalar(this.eyeScale);
      
      // Blink
      const lid = eye.userData.lid;
      const blinkY = 0.2 - this.blinkProgress * 0.35;
      lid.position.y = blinkY;

      // Glow intensity
      eye.userData.glow.material.opacity = this.glowIntensity * 0.5;
      
      // Slight pupil movement (looking around)
      const pupil = eye.userData.pupil;
      pupil.position.x = Math.sin(time * 0.7 + i) * 0.02;
      pupil.position.y = Math.cos(time * 0.5) * 0.015;
    });

    // Mouth animation
    const mouthScale = 1 + this.mouthOpenness * 2;
    this.mouth.scale.y = mouthScale;
    this.mouth.material.opacity = 0.7 + this.mouthOpenness * 0.3;

    // Pulsing glow for thinking state
    if (this.state === 'thinking') {
      const pulse = (Math.sin(time * 4) + 1) * 0.5;
      this.antennaTip.material.opacity = 0.5 + pulse * 0.5;
      this.chestLight.material.opacity = 0.5 + pulse * 0.5;
    } else {
      this.antennaTip.material.opacity = this.glowIntensity + 0.2;
      this.chestLight.material.opacity = this.glowIntensity + 0.2;
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}

// ============================================================================
// SEAMLESS SPEECH RECOGNITION (no start/stop sounds)
// ============================================================================

function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError('Speech recognition not supported');
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';
  let silenceTimer = null;

  recognition.onresult = (event) => {
    // Ignore results while processing (bot is responding)
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

    // Show interim
    if (interim) {
      transcriptEl.textContent = interim;
      transcriptEl.className = 'user';
      robot?.setState('listening');
    }

    // Reset silence timer
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (finalTranscript.trim() && !isProcessing) {
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

  // Auto-restart on end (keeps running continuously)
  recognition.onend = () => {
    if (!isMuted) {
      try {
        recognition.start();
      } catch (e) {
        // Already started
      }
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
    robot?.setState('listening');
  } catch (e) {
    // Already started, that's fine
  }
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
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (e) {
      console.error('Message parse error:', e);
    }
  };
}

function sendMessage(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  isProcessing = true; // Stop processing speech input
  transcriptEl.textContent = text;
  transcriptEl.className = 'user';
  setStatus('thinking', 'Thinking...');
  robot?.setState('thinking');
  
  ws.send(JSON.stringify({ type: 'transcript', text }));
}

// Audio chunk accumulator
let audioChunks = [];

function handleMessage(data) {
  switch (data.type) {
    case 'ready':
      setStatus('listening', 'Ready');
      break;
      
    case 'thinking':
      setStatus('thinking', 'Thinking...');
      robot?.setState('thinking');
      break;
      
    case 'text':
      transcriptEl.textContent = data.content || '';
      transcriptEl.className = 'assistant';
      break;
      
    case 'audio_start':
      audioChunks = [];
      setStatus('speaking', '');
      robot?.setState('speaking');
      break;
      
    case 'audio_chunk':
      audioChunks.push(data.data);
      if (data.final) {
        const fullAudio = audioChunks.join('');
        playAudio(fullAudio);
      }
      break;
      
    case 'audio_end':
      // Resume listening seamlessly
      isProcessing = false;
      setStatus('listening', 'Listening...');
      robot?.setState('listening');
      break;
      
    case 'tts_error':
      isProcessing = false;
      robot?.setState('idle');
      break;
      
    case 'error':
      showError(data.message || 'Something went wrong');
      isProcessing = false;
      setStatus('listening', 'Listening...');
      robot?.setState('idle');
      break;
  }
}

// ============================================================================
// AUDIO PLAYBACK WITH LIP SYNC
// ============================================================================

let currentSource = null;

async function playAudio(base64) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const buffer = await audioContext.decodeAudioData(bytes.buffer);
    
    // Stop any current playback
    if (currentSource) {
      try { currentSource.stop(); } catch (e) {}
    }

    currentSource = audioContext.createBufferSource();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    
    currentSource.buffer = buffer;
    currentSource.connect(analyser);
    analyser.connect(audioContext.destination);
    
    // Lip sync animation
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animating = true;
    
    const updateMouth = () => {
      if (!animating) return;
      analyser.getByteFrequencyData(dataArray);
      // Focus on voice frequency range (100-400 Hz)
      const voiceRange = dataArray.slice(2, 12);
      const avg = voiceRange.reduce((a, b) => a + b, 0) / voiceRange.length;
      robot?.setMouthOpen(avg / 200);
      requestAnimationFrame(updateMouth);
    };
    updateMouth();
    
    currentSource.onended = () => {
      animating = false;
      robot?.setMouthOpen(0);
      currentSource = null;
    };
    
    currentSource.start(0);
  } catch (e) {
    console.error('Audio playback error:', e);
    robot?.setMouthOpen(0);
  }
}

// ============================================================================
// UI HELPERS
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

async function init() {
  // Create expressive robot
  robot = new ExpressiveRobot(canvas);

  // Init speech (runs continuously, no beeps)
  if (!initSpeech()) {
    showError('Speech recognition not available');
  }

  // Mute button
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.classList.toggle('active', isMuted);
    
    if (isMuted) {
      try { recognition?.stop(); } catch (e) {}
      setStatus('', 'Muted');
      robot?.setState('idle');
    } else {
      startListening();
    }
  });

  // Connect
  connect();
}

// Auto-start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
