/**
 * Audio Worklet Processor for ElevenLabs Voice Mode
 * Converts audio to PCM 16-bit format and sends chunks every ~100ms
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.bufferSize = 1600; // ~100ms at 16kHz
    this.sampleRate = 16000;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const inputChannel = input[0]; // Mono channel
      
      // Add samples to buffer
      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer.push(inputChannel[i]);
        
        // Send chunk when buffer is full
        if (this.buffer.length >= this.bufferSize) {
          this.sendAudioChunk();
        }
      }
    }
    
    return true; // Keep processor alive
  }
  
  sendAudioChunk() {
    if (this.buffer.length === 0) return;
    
    // Create Float32Array from buffer
    const audioData = new Float32Array(this.buffer);
    this.buffer = []; // Reset buffer
    
    // Send to main thread
    this.port.postMessage({
      audioData: audioData
    });
  }
}

registerProcessor('audio-processor', AudioProcessor);