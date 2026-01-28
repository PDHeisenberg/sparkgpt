/**
 * Spark Voice - Minimal Edition
 */

import * as THREE from 'three';

// ============================================================================
// CONFIG
// ============================================================================

const CONFIG = {
  // Use current host (works for both Tailscale and local dev)
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
let audioContext = null;
let robot = null;

// ============================================================================
// CUTE ROBOT AVATAR
// ============================================================================

class CuteRobot {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    
    // State
    this.mouthOpen = 0;
    this.targetMouth = 0;
    this.eyeState = 'normal'; // normal, happy, thinking
    this.blinkTimer = 0;
    this.isBlinking = false;
    this.floatPhase = 0;
    
    this.init();
  }

  init() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    // Camera
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    this.camera.position.set(0, 0.5, 4);
    this.camera.lookAt(0, 0.3, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(3, 5, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88ccff, 0.3);
    fill.position.set(-2, 2, 2);
    this.scene.add(fill);

    // Build robot
    this.buildRobot();

    // Handle resize
    window.addEventListener('resize', () => this.resize());

    // Start animation
    this.animate();
  }

  buildRobot() {
    this.group = new THREE.Group();

    // Materials
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: 0xe8e8f0,
      roughness: 0.3,
      metalness: 0.1
    });
    const darkMat = new THREE.MeshStandardMaterial({ 
      color: 0x2a2a35,
      roughness: 0.5,
      metalness: 0.2
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff });
    const accentMat = new THREE.MeshStandardMaterial({ 
      color: 0x00d4ff,
      emissive: 0x00d4ff,
      emissiveIntensity: 0.3
    });

    // Head (pill shape)
    const headGeo = new THREE.CapsuleGeometry(0.6, 0.3, 16, 24);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.rotation.z = Math.PI / 2;
    head.position.y = 1.2;
    this.group.add(head);

    // Visor (dark screen area)
    const visorGeo = new THREE.CapsuleGeometry(0.48, 0.15, 12, 20);
    const visor = new THREE.Mesh(visorGeo, darkMat);
    visor.rotation.z = Math.PI / 2;
    visor.position.set(0, 1.2, 0.35);
    visor.scale.z = 0.5;
    this.group.add(visor);

    // Eyes
    this.leftEye = this.createEye(-0.22, 1.25, 0.52);
    this.rightEye = this.createEye(0.22, 1.25, 0.52);
    
    // Mouth (simple line that opens)
    const mouthGeo = new THREE.BoxGeometry(0.25, 0.04, 0.05);
    this.mouth = new THREE.Mesh(mouthGeo, glowMat);
    this.mouth.position.set(0, 1.05, 0.52);
    this.group.add(this.mouth);

    // Ears/antennas
    const earGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.15, 12);
    const leftEar = new THREE.Mesh(earGeo, bodyMat);
    leftEar.position.set(-0.75, 1.3, 0);
    this.group.add(leftEar);
    const rightEar = new THREE.Mesh(earGeo, bodyMat);
    rightEar.position.set(0.75, 1.3, 0);
    this.group.add(rightEar);

    // Body (rounded rectangle)
    const bodyGeo = new THREE.CapsuleGeometry(0.4, 0.5, 12, 20);
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = 0.35;
    this.group.add(bodyMesh);

    // Chest light
    const chestGeo = new THREE.CircleGeometry(0.1, 16);
    const chest = new THREE.Mesh(chestGeo, accentMat);
    chest.position.set(0, 0.45, 0.41);
    this.group.add(chest);

    // Arms (small stubs)
    const armGeo = new THREE.CapsuleGeometry(0.1, 0.15, 8, 12);
    const leftArm = new THREE.Mesh(armGeo, bodyMat);
    leftArm.position.set(-0.55, 0.4, 0);
    leftArm.rotation.z = 0.3;
    this.group.add(leftArm);
    const rightArm = new THREE.Mesh(armGeo, bodyMat);
    rightArm.position.set(0.55, 0.4, 0);
    rightArm.rotation.z = -0.3;
    this.group.add(rightArm);

    // Shadow
    const shadowGeo = new THREE.CircleGeometry(0.5, 24);
    const shadowMat = new THREE.MeshBasicMaterial({ 
      color: 0x000000, 
      transparent: true, 
      opacity: 0.2 
    });
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = -0.35;
    this.group.add(this.shadow);

    this.scene.add(this.group);
  }

  createEye(x, y, z) {
    const group = new THREE.Group();
    
    // Outer glow
    const outerGeo = new THREE.CircleGeometry(0.12, 16);
    const outerMat = new THREE.MeshBasicMaterial({ 
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.3
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    group.add(outer);

    // Inner eye
    const innerGeo = new THREE.CircleGeometry(0.08, 16);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x00d4ff });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.z = 0.01;
    group.add(inner);

    // Eyelid for blinking
    const lidGeo = new THREE.PlaneGeometry(0.3, 0.15);
    const lidMat = new THREE.MeshBasicMaterial({ color: 0x2a2a35 });
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.set(0, 0.15, 0.02);
    lid.name = 'lid';
    group.add(lid);

    group.position.set(x, y, z);
    this.group.add(group);
    return group;
  }

  setExpression(type) {
    this.eyeState = type;
  }

  setMouthOpen(value) {
    this.targetMouth = Math.max(0, Math.min(1, value));
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    const delta = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    // Floating animation
    this.floatPhase += delta * 1.5;
    this.group.position.y = Math.sin(this.floatPhase) * 0.05;
    this.shadow.scale.setScalar(1 - Math.sin(this.floatPhase) * 0.1);

    // Gentle sway
    this.group.rotation.z = Math.sin(time * 0.5) * 0.02;
    this.group.rotation.y = Math.sin(time * 0.3) * 0.05;

    // Smooth mouth animation
    this.mouthOpen += (this.targetMouth - this.mouthOpen) * 0.3;
    this.mouth.scale.y = 1 + this.mouthOpen * 3;
    this.mouth.position.y = 1.05 - this.mouthOpen * 0.05;

    // Blinking
    this.blinkTimer -= delta;
    if (this.blinkTimer <= 0 && !this.isBlinking) {
      this.isBlinking = true;
      this.blinkTimer = 0.15;
    } else if (this.isBlinking && this.blinkTimer <= 0) {
      this.isBlinking = false;
      this.blinkTimer = 2 + Math.random() * 3;
    }

    const lidY = this.isBlinking ? 0 : 0.15;
    [this.leftEye, this.rightEye].forEach(eye => {
      const lid = eye.getObjectByName('lid');
      if (lid) lid.position.y = lidY;
    });

    // Expression-based eye changes
    if (this.eyeState === 'happy') {
      this.leftEye.rotation.z = 0.2;
      this.rightEye.rotation.z = -0.2;
    } else if (this.eyeState === 'thinking') {
      this.leftEye.position.y = 1.28;
      this.rightEye.position.y = 1.28;
    } else {
      this.leftEye.rotation.z = 0;
      this.rightEye.rotation.z = 0;
      this.leftEye.position.y = 1.25;
      this.rightEye.position.y = 1.25;
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
// SPEECH RECOGNITION
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
    }

    // Reset silence timer
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (finalTranscript.trim()) {
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
    if (isListening && !isMuted) {
      recognition.start();
    }
  };

  return true;
}

function startListening() {
  if (!recognition || isMuted) return;
  try {
    recognition.start();
    isListening = true;
    setStatus('listening', 'Listening...');
    robot?.setExpression('normal');
  } catch (e) {
    // Already started
  }
}

function stopListening() {
  if (!recognition) return;
  try {
    recognition.stop();
    isListening = false;
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
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (e) {
      console.error('Message parse error:', e);
    }
  };
}

function sendMessage(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  
  transcriptEl.textContent = text;
  transcriptEl.className = 'user';
  setStatus('thinking', 'Thinking...');
  robot?.setExpression('thinking');
  stopListening();
  
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
      robot?.setExpression('thinking');
      break;
      
    case 'text':
      transcriptEl.textContent = data.content || '';
      transcriptEl.className = 'assistant';
      break;
      
    case 'audio_start':
      audioChunks = [];
      setStatus('speaking', 'Speaking...');
      robot?.setExpression('happy');
      break;
      
    case 'audio_chunk':
      audioChunks.push(data.data);
      if (data.final) {
        const fullAudio = audioChunks.join('');
        playAudio(fullAudio);
      }
      break;
      
    case 'audio_end':
      setStatus('listening', 'Listening...');
      robot?.setExpression('normal');
      startListening();
      break;
      
    case 'tts_error':
      showError('Voice failed, see text');
      setStatus('listening', 'Listening...');
      startListening();
      break;
      
    case 'error':
      showError(data.message || 'Something went wrong');
      setStatus('listening', 'Listening...');
      startListening();
      break;
  }
}

// ============================================================================
// AUDIO PLAYBACK
// ============================================================================

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
    const source = audioContext.createBufferSource();
    const analyser = audioContext.createAnalyser();
    
    source.buffer = buffer;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    
    // Lip sync
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const updateMouth = () => {
      if (!source.buffer) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
      robot?.setMouthOpen(avg / 255);
      requestAnimationFrame(updateMouth);
    };
    updateMouth();
    
    source.onended = () => {
      robot?.setMouthOpen(0);
    };
    
    source.start(0);
  } catch (e) {
    console.error('Audio playback error:', e);
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
  // Tailscale provides device-level auth - no additional auth needed
  // Only devices on Parth's Tailscale network can reach this

  // Create robot
  robot = new CuteRobot(canvas);

  // Init speech
  if (!initSpeech()) {
    showError('Speech recognition not available');
  }

  // Mute button
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.classList.toggle('active', isMuted);
    
    if (isMuted) {
      stopListening();
      setStatus('', 'Muted');
    } else {
      startListening();
    }
  });

  // Connect
  connect();
}

// Auto-start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
