/**
 * Configuration loader
 * Loads from environment, .env file, and clawdbot auth stores
 */

import { readFileSync, existsSync } from 'fs';
import { config as dotenvConfig } from 'dotenv';

// Load .env if present
dotenvConfig();

// Load gateway token from clawdbot config
function loadGatewayToken() {
  const configPath = '/home/heisenberg/.clawdbot/clawdbot.json';
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.gateway?.auth?.token;
    } catch {}
  }
  return null;
}

// Helper to load key from clawdbot auth
function loadAuthKey(provider) {
  // Try auth-profiles.json first (clawdbot standard)
  const profilesPath = '/home/heisenberg/.clawdbot/agents/main/agent/auth-profiles.json';
  if (existsSync(profilesPath)) {
    try {
      const data = JSON.parse(readFileSync(profilesPath, 'utf8'));
      // Find a profile for this provider
      for (const [id, profile] of Object.entries(data.profiles || {})) {
        if (profile.provider === provider && profile.token) {
          return profile.token;
        }
      }
    } catch {}
  }
  
  // Fallback to simple key file
  const keyPath = `/home/heisenberg/.clawdbot/auth/${provider}.key`;
  if (existsSync(keyPath)) {
    return readFileSync(keyPath, 'utf8').trim();
  }
  
  return null;
}

export function loadConfig() {
  return {
    port: parseInt(process.env.PORT || '3456'),
    
    llm: {
      provider: 'clawdbot',  // Route through Clawdbot gateway
      gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:18789',
      gatewayToken: process.env.GATEWAY_TOKEN || loadGatewayToken(),
    },
    
    tts: {
      provider: process.env.TTS_PROVIDER || 'elevenlabs',
      apiKey: process.env.ELEVENLABS_API_KEY || loadAuthKey('elevenlabs'),
      voiceId: process.env.TTS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Adam
      model: process.env.TTS_MODEL || 'eleven_turbo_v2_5',
    },
    
    stt: {
      provider: process.env.STT_PROVIDER || 'browser', // browser | deepgram | whisper
      apiKey: process.env.DEEPGRAM_API_KEY || loadAuthKey('deepgram'),
    },
    
    avatar: {
      type: process.env.AVATAR_TYPE || 'robot', // robot | talkinghead | custom
      model: process.env.AVATAR_MODEL || null,
    },
    
    features: {
      interruptible: true,
      streamAudio: true,
      saveHistory: false,
    },
  };
}

// Default system prompt removed - voice/chat prompts are defined inline in server.js and realtime handlers
