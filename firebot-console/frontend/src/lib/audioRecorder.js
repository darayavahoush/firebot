// High-fidelity in-browser audio capture for voice calibration and testing.
// Downsamples any microphone sample rate to clean 16 kHz 16-bit mono PCM WAV,
// perfectly matched to Whisper, Vosk, and SpeechBrain ECAPA-TDNN requirements.

export class AudioRecorder {
  constructor() {
    this.stream = null;
    this.audioCtx = null;
    this.workletNode = null;
    this.processor = null;
    this.source = null;
    this.samples = [];
    this.isRecording = false;
    this.analyser = null;
    this.animFrame = null;
  }

  async start(onVolume) {
    if (this.isRecording) return;
    this.samples = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: false, // keep natural acoustics for voiceprints
        autoGainControl: true,
      },
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass();
    const inputSampleRate = this.audioCtx.sampleRate;

    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.source.connect(this.analyser);

    // Prefer modern AudioWorkletNode to avoid ScriptProcessorNode deprecation
    let workletReady = false;
    if (this.audioCtx.audioWorklet) {
      try {
        const code = `
          class RecorderProcessor extends AudioWorkletProcessor {
            process(inputs) {
              const input = inputs[0];
              if (input && input[0]) {
                this.port.postMessage(input[0]);
              }
              return true;
            }
          }
          registerProcessor('recorder-worklet', RecorderProcessor);
        `;
        const blob = new Blob([code], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        await this.audioCtx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);

        this.workletNode = new AudioWorkletNode(this.audioCtx, "recorder-worklet");
        this.workletNode.port.onmessage = (e) => {
          if (!this.isRecording) return;
          this.samples.push(new Float32Array(e.data));
        };
        this.source.connect(this.workletNode);
        workletReady = true;
      } catch (err) {
        console.warn("AudioWorklet fallback:", err);
      }
    }

    if (!workletReady) {
      // Legacy fallback for environments lacking AudioWorklet
      this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.source.connect(this.processor);
      this.processor.connect(this.audioCtx.destination);
      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const input = e.inputBuffer.getChannelData(0);
        this.samples.push(new Float32Array(input));
      };
    }

    if (onVolume && this.analyser) {
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      const pollVolume = () => {
        if (!this.isRecording) return;
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        onVolume(Math.min(1.0, avg / 128.0));
        this.animFrame = requestAnimationFrame(pollVolume);
      };
      this.animFrame = requestAnimationFrame(pollVolume);
    }

    this.isRecording = true;
    this.inputSampleRate = inputSampleRate;
  }

  async stop() {
    if (!this.isRecording) return null;
    this.isRecording = false;

    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      await this.audioCtx.close().catch(() => {});
    }

    // Flatten all collected buffers
    let totalLength = 0;
    for (const chunk of this.samples) {
      totalLength += chunk.length;
    }
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.samples) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    if (merged.length === 0) return null;

    // Downsample from native device rate (e.g. 44.1k/48k) to 16 kHz
    const samples16k = downsampleTo16k(merged, this.inputSampleRate);

    // Trim silence from start and end
    const trimmed = trimAudioSilence(samples16k, 16000);

    // Encode to WAV Blob
    return encodeWav16k(trimmed, 16000);
  }
}

function downsampleTo16k(inputBuffer, inputSampleRate) {
  if (inputSampleRate === 16000) return inputBuffer;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(inputBuffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputBuffer.length; i++) {
      accum += inputBuffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : inputBuffer[offsetBuffer];
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function trimAudioSilence(audio, sampleRate = 16000, threshold = 0.015, padMs = 80) {
  const hop = Math.max(1, Math.floor(sampleRate * 0.02)); // 20ms windows
  const n = Math.floor(audio.length / hop);
  if (n < 4) return audio;

  let firstLoud = -1;
  let lastLoud = -1;

  for (let i = 0; i < n; i++) {
    let sumSq = 0;
    const start = i * hop;
    for (let j = 0; j < hop; j++) {
      const s = audio[start + j] || 0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / hop);
    if (rms > threshold) {
      if (firstLoud === -1) firstLoud = i;
      lastLoud = i;
    }
  }

  if (firstLoud === -1 || lastLoud === -1) {
    return audio; // no clear speech, return as-is
  }

  const pad = Math.floor((sampleRate * padMs) / 1000);
  const startIdx = Math.max(0, firstLoud * hop - pad);
  const endIdx = Math.min(audio.length, (lastLoud + 1) * hop + pad);
  return audio.subarray(startIdx, endIdx);
}

function encodeWav16k(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");

  // fmt chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (16-bit mono)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: "audio/wav" });
}

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
