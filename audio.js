/**
 * GrooveBox Audio Engine
 * Web Audio API: playback, visualizer, EQ, bass boost, trim
 */

const AudioEngine = (() => {
  let ctx        = null;
  let source     = null;
  let gainNode   = null;
  let analyser   = null;
  let bassFilter = null;
  let eqNodes    = [];
  let audioEl    = null;
  let mediaSource = null;

  // Trim state
  let trimStart  = 0;
  let trimEnd    = Infinity;
  let trimActive = false;

  // Playback state
  let isPlaying  = false;
  let volume     = 0.8;
  let isMuted    = false;
  let speed      = 1.0;
  let bassBoost  = false;
  let eqEnabled  = true;

  // EQ settings: 5 bands
  const EQ_FREQS   = [60, 250, 1000, 4000, 16000];
  let eqValues     = [0, 0, 0, 0, 0]; // dB, -12 to +12

  function initContext() {
    if (ctx) return;
    ctx      = new (window.AudioContext || window.webkitAudioContext)();
    audioEl  = new Audio();
    audioEl.crossOrigin = 'anonymous';
    audioEl.preload = 'auto';

    // Node graph: source → (eq chain) → bass → gain → analyser → destination
    gainNode = ctx.createGain();
    gainNode.gain.value = volume;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    bassFilter = ctx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 120;
    bassFilter.gain.value = 0;

    // Build EQ chain
    eqNodes = EQ_FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1;
      f.gain.value = 0;
      return f;
    });

    // Chain: audioEl → mediaSource → eq[0] → eq[1] → ... → bassFilter → gain → analyser → dest
    mediaSource = ctx.createMediaElementSource(audioEl);
    let node = mediaSource;
    for (const eq of eqNodes) { node.connect(eq); node = eq; }
    node.connect(bassFilter);
    bassFilter.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(ctx.destination);

    audioEl.ontimeupdate  = onTimeUpdate;
    audioEl.onended       = onEnded;
    audioEl.onloadedmetadata = onLoaded;
  }

  function onTimeUpdate() {
    // Trim enforcement
    if (trimActive && audioEl) {
      const t = audioEl.currentTime;
      const end = trimEnd !== Infinity ? trimEnd : audioEl.duration;
      if (t >= end) {
        audioEl.currentTime = trimStart;
        if (!audioEl.loop) { audioEl.pause(); isPlaying = false; }
      }
      if (t < trimStart) audioEl.currentTime = trimStart;
    }
    if (typeof AudioEngine.onProgress === 'function') AudioEngine.onProgress();
  }
  function onEnded() {
    isPlaying = false;
    if (typeof AudioEngine.onEnded === 'function') AudioEngine.onEnded();
  }
  function onLoaded() {
    if (typeof AudioEngine.onLoaded === 'function') AudioEngine.onLoaded();
  }

  return {
    // Callbacks (set from app.js)
    onProgress: null,
    onEnded:    null,
    onLoaded:   null,

    get duration()    { return audioEl ? audioEl.duration || 0 : 0; },
    get currentTime() { return audioEl ? audioEl.currentTime     : 0; },
    get playing()     { return isPlaying; },
    get trimStart()   { return trimStart; },
    get trimEnd()     { return trimEnd; },

    init() { initContext(); },

    async loadBlob(blob, startSec = 0) {
      initContext();
      if (ctx.state === 'suspended') await ctx.resume();
      if (audioEl.src && audioEl.src.startsWith('blob:')) URL.revokeObjectURL(audioEl.src);
      const url = URL.createObjectURL(blob);
      audioEl.src = url;
      audioEl.load();
      audioEl.playbackRate = speed;
      audioEl.currentTime  = startSec;
    },

    async play() {
      initContext();
      if (ctx.state === 'suspended') await ctx.resume();
      if (trimActive && audioEl.currentTime < trimStart) audioEl.currentTime = trimStart;
      await audioEl.play();
      isPlaying = true;
    },

    pause() { audioEl && audioEl.pause(); isPlaying = false; },

    seek(pct) {
      if (!audioEl) return;
      const dur = audioEl.duration;
      if (!dur) return;
      const t = pct * dur;
      const s = trimActive ? trimStart : 0;
      const e = trimActive && trimEnd !== Infinity ? trimEnd : dur;
      audioEl.currentTime = Math.max(s, Math.min(e, t));
    },

    seekTo(sec) {
      if (!audioEl) return;
      audioEl.currentTime = sec;
    },

    setVolume(v) {
      volume = v;
      if (gainNode) gainNode.gain.value = isMuted ? 0 : v;
    },

    toggleMute() {
      isMuted = !isMuted;
      if (gainNode) gainNode.gain.value = isMuted ? 0 : volume;
      return isMuted;
    },

    setSpeed(s) {
      speed = s;
      if (audioEl) audioEl.playbackRate = s;
    },

    setLoop(v) {
      if (audioEl) audioEl.loop = v;
    },

    // ---- EQ ----
    setEQBand(index, dB) {
      eqValues[index] = dB;
      if (eqNodes[index] && eqEnabled) eqNodes[index].gain.value = dB;
    },

    toggleEQ(enabled) {
      eqEnabled = enabled;
      eqNodes.forEach((n, i) => n.gain.value = enabled ? eqValues[i] : 0);
    },

    applyEQPreset(preset) {
      const presets = {
        flat:  [0,  0,  0,  0,  0],
        rock:  [4,  2,  0,  2,  4],
        jazz:  [2,  1,  0, -1,  2],
        bass:  [8,  5,  0,  0,  0],
        vocal: [-2, 0,  4,  2, -1],
      };
      const vals = presets[preset] || presets.flat;
      vals.forEach((v, i) => this.setEQBand(i, v));
      return vals;
    },

    // ---- BASS BOOST ----
    toggleBassBoost() {
      bassBoost = !bassBoost;
      if (bassFilter) bassFilter.gain.value = bassBoost ? 10 : 0;
      return bassBoost;
    },

    // ---- TRIM ----
    setTrim(start, end) {
      trimStart  = start;
      trimEnd    = end;
      trimActive = true;
    },

    clearTrim() {
      trimActive = false;
      trimStart  = 0;
      trimEnd    = Infinity;
    },

    // ---- VISUALIZER ----
    getVisualizerData() {
      if (!analyser) return null;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      return data;
    },

    getWaveformData() {
      if (!analyser) return null;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      return data;
    },

    // Draw waveform thumbnail from buffer
    async drawWaveformToCanvas(blob, canvas) {
      const ctx2 = canvas.getContext('2d');
      const arrayBuf = await blob.arrayBuffer();
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuf = await tmpCtx.decodeAudioData(arrayBuf);
      tmpCtx.close();

      const data   = audioBuf.getChannelData(0);
      const step   = Math.ceil(data.length / canvas.width);
      const amp    = canvas.height / 2;
      ctx2.clearRect(0, 0, canvas.width, canvas.height);
      ctx2.strokeStyle = '#C8873A';
      ctx2.lineWidth   = 1;

      for (let i = 0; i < canvas.width; i++) {
        let min = 1, max = -1;
        for (let j = 0; j < step; j++) {
          const d = data[i * step + j];
          if (d < min) min = d;
          if (d > max) max = d;
        }
        ctx2.beginPath();
        ctx2.moveTo(i, amp * (1 + min));
        ctx2.lineTo(i, amp * (1 + max));
        ctx2.stroke();
      }
    }
  };
})();
