(function () {
  "use strict";

  // JB//OS sound engine. Every sound is synthesised live with WebAudio: no audio files, no network.
  // Off by default; the choice persists in localStorage "jb-sound-v2". The AudioContext is only created
  // (or resumed) once the visitor has interacted with the page, so browsers never block or warn.
  // The one exception to "off" is the party track, which only plays when someone types `party`.

  const doc = document;
  const JBOS = window.JBOS = window.JBOS || {};
  // v2: the key was renamed so browsers that turned sound on before start muted again.
  const STORAGE_KEY = "jb-sound-v2";
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  const MASTER_VOLUME = 0.55;
  // Cap on voices sounding at the same moment. Voices scheduled for later (a drum pattern, an
  // arpeggio) do not count until they are about to start, so a long pattern never mutes the UI.
  const MAX_VOICES = 36;
  const LOOKAHEAD = 0.03;

  let enabled = false;
  try { enabled = window.localStorage.getItem(STORAGE_KEY) === "on"; } catch (error) { /* storage blocked */ }
  if (!AudioCtor) enabled = false;

  let ctx = null;
  let master = null;
  let longBus = null;
  let noiseBuffer = null;
  let gestured = false;
  // Every scheduled voice: { source, nodes, start, end, bus, done }. Removed when it ends or is stopped.
  const voices = new Set();
  const lastPlayed = Object.create(null);

  // Minimum gap between repeats of the same sound, so held keys and double events never machine-gun.
  const MIN_GAP = { type: 24, click: 45, pop: 40, tick: 30, coin: 50, default: 70 };

  function noop() {}

  function hasActivation() {
    if (gestured) return true;
    const activation = navigator.userActivation;
    return Boolean(activation && (activation.hasBeenActive || activation.isActive));
  }

  function ensureContext() {
    if (!AudioCtor) return null;
    if (!ctx) {
      if (!hasActivation()) return null;
      try {
        ctx = new AudioCtor({ latencyHint: "interactive" });
      } catch (error) {
        try { ctx = new AudioCtor(); } catch (innerError) { return null; }
      }
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 18;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      longBus = ctx.createGain();
      longBus.connect(master);
    }
    if (ctx.state !== "running" && ctx.state !== "closed" && hasActivation()) {
      const resumed = ctx.resume();
      if (resumed && resumed.catch) resumed.catch(noop);
    }
    return ctx;
  }

  // iOS only unlocks audio inside a gesture handler, so warm the context up on the first real input.
  function unlock() {
    gestured = true;
    if (!enabled || (ctx && ctx.state === "running")) return;
    const context = ensureContext();
    if (context) playSilence(context);
  }

  // One silent sample: enough for iOS to unlock the context inside a gesture.
  function playSilence(context) {
    try {
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, 22050);
      source.connect(context.destination);
      source.onended = function () { source.disconnect(); };
      source.start(0);
    } catch (error) { /* nothing to unlock */ }
  }
  ["pointerdown", "keydown", "touchend"].forEach(function (type) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  });

  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden && ctx && ctx.state === "running") {
      const suspended = ctx.suspend();
      if (suspended && suspended.catch) suspended.catch(noop);
    }
  });

  function getNoise() {
    if (noiseBuffer) return noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 1.2);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function finish(voice) {
    if (voice.done) return;
    voice.done = true;
    voices.delete(voice);
    voice.nodes.forEach(function (node) {
      try { node.disconnect(); } catch (error) { /* already detached */ }
    });
  }

  function track(source, nodes, start, end, bus) {
    const voice = { source: source, nodes: nodes, start: start, end: end, bus: bus, done: false };
    voices.add(voice);
    source.onended = function () { finish(voice); };
    return voice;
  }

  // Voices audible now (or within a few milliseconds), not everything queued for later.
  function soundingVoices() {
    if (!ctx) return 0;
    const now = ctx.currentTime;
    let count = 0;
    voices.forEach(function (voice) {
      if (voice.start <= now + LOOKAHEAD && voice.end > now) count += 1;
    });
    return count;
  }

  function envelope(param, start, attack, peak, duration, sustain) {
    const floor = 0.0001;
    param.cancelScheduledValues(start);
    param.setValueAtTime(floor, start);
    param.exponentialRampToValueAtTime(Math.max(peak, floor * 2), start + Math.max(attack, 0.001));
    if (sustain) param.setValueAtTime(Math.max(peak, floor * 2), start + Math.max(attack, 0.001) + sustain);
    param.exponentialRampToValueAtTime(floor, start + duration);
  }

  // One oscillator voice: { type, freq, to, glide, delay, dur, gain, attack, hold, detune, filter, q, dest }
  function tone(spec) {
    const start = ctx.currentTime + (spec.delay || 0);
    const duration = spec.dur || 0.2;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const nodes = [osc, amp];
    osc.type = spec.type || "sine";
    osc.frequency.setValueAtTime(spec.freq, start);
    if (spec.to) osc.frequency.exponentialRampToValueAtTime(spec.to, start + (spec.glide || duration));
    if (spec.detune) osc.detune.setValueAtTime(spec.detune, start);
    envelope(amp.gain, start, spec.attack || 0.004, spec.gain || 0.1, duration, spec.hold);
    osc.connect(amp);
    let out = amp;
    if (spec.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = spec.filterType || "lowpass";
      filter.frequency.setValueAtTime(spec.filter, start);
      if (spec.q) filter.Q.setValueAtTime(spec.q, start);
      amp.connect(filter);
      nodes.push(filter);
      out = filter;
    }
    const bus = spec.dest || master;
    out.connect(bus);
    track(osc, nodes, start, start + duration + 0.05, bus);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  // One filtered-noise voice: { delay, dur, gain, attack, hold, filterType, freq, to, glide, back, q, dest }
  function noise(spec) {
    const start = ctx.currentTime + (spec.delay || 0);
    const duration = spec.dur || 0.1;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    source.buffer = getNoise();
    source.loop = duration > 1;
    filter.type = spec.filterType || "bandpass";
    filter.frequency.setValueAtTime(spec.freq || 2000, start);
    if (spec.to) filter.frequency.exponentialRampToValueAtTime(spec.to, start + (spec.glide || duration));
    if (spec.back) filter.frequency.exponentialRampToValueAtTime(spec.back, start + duration);
    filter.Q.setValueAtTime(spec.q || 1, start);
    envelope(amp.gain, start, spec.attack || 0.002, spec.gain || 0.08, duration, spec.hold);
    source.connect(filter);
    filter.connect(amp);
    const bus = spec.dest || master;
    amp.connect(bus);
    track(source, [source, filter, amp], start, start + duration + 0.05, bus);
    source.start(start, Math.random() * 0.2);
    source.stop(start + duration + 0.05);
  }

  function arpeggio(notes, step, spec) {
    notes.forEach(function (freq, index) {
      tone(Object.assign({}, spec, { freq: freq, delay: (spec.delay || 0) + index * step }));
    });
  }

  function random(min, max) { return min + Math.random() * (max - min); }

  const NOTE = {
    A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220,
    C4: 261.63, E4: 329.63, G4: 392, A4: 440, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77,
    C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98
  };

  // Every contract sound (click, open, close, boot, type, success, error, whoosh, powerup, pop)
  // plus a few extras the easter eggs use.
  const recipes = {
    click: function () {
      tone({ type: "square", freq: 1500, to: 820, glide: 0.03, dur: 0.05, gain: 0.05, filter: 3800 });
      noise({ filterType: "highpass", freq: 3200, dur: 0.018, gain: 0.035 });
    },
    type: function () {
      noise({ freq: random(1700, 2900), q: 1.4, dur: random(0.022, 0.034), gain: random(0.05, 0.085) });
      tone({ freq: random(150, 210), dur: 0.025, gain: 0.03 });
    },
    open: function () {
      tone({ freq: 520, to: 1040, glide: 0.09, dur: 0.17, gain: 0.1 });
      tone({ type: "triangle", freq: 780, to: 1560, glide: 0.08, delay: 0.06, dur: 0.15, gain: 0.05 });
    },
    close: function () {
      tone({ freq: 900, to: 420, glide: 0.12, dur: 0.17, gain: 0.1 });
      tone({ type: "triangle", freq: 600, to: 300, glide: 0.1, delay: 0.05, dur: 0.15, gain: 0.045 });
    },
    boot: function () {
      tone({ freq: NOTE.C3, dur: 1.5, gain: 0.07, attack: 0.12 });
      tone({ type: "triangle", freq: NOTE.C3 * 2, dur: 1.4, gain: 0.03, attack: 0.2, detune: 6 });
      arpeggio([NOTE.C4, NOTE.E4, NOTE.G4, NOTE.B4, NOTE.C5], 0.075, { type: "triangle", dur: 1.15, gain: 0.055, attack: 0.02 });
      tone({ freq: NOTE.C6, delay: 0.4, dur: 0.95, gain: 0.02, attack: 0.05 });
      tone({ freq: NOTE.G6, delay: 0.46, dur: 0.8, gain: 0.012, attack: 0.05 });
    },
    success: function () {
      tone({ type: "square", freq: NOTE.E5, dur: 0.14, gain: 0.045, filter: 3600 });
      tone({ type: "square", freq: NOTE.B5, delay: 0.085, dur: 0.32, gain: 0.045, filter: 3600 });
      tone({ freq: NOTE.E4, dur: 0.12, gain: 0.05 });
      tone({ freq: NOTE.B4, delay: 0.085, dur: 0.3, gain: 0.05 });
    },
    error: function () {
      tone({ type: "sawtooth", freq: NOTE.A3, to: NOTE.G3, dur: 0.16, gain: 0.06, filter: 1100 });
      tone({ type: "sawtooth", freq: NOTE.F3, to: NOTE.E3, delay: 0.15, dur: 0.26, gain: 0.065, filter: 900 });
    },
    whoosh: function () {
      noise({ freq: 380, to: 2800, glide: 0.22, back: 520, q: 0.8, dur: 0.46, attack: 0.13, gain: 0.13 });
    },
    powerup: function () {
      arpeggio([NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6], 0.045, { type: "square", dur: 0.09, gain: 0.035, filter: 4200 });
      tone({ type: "square", freq: NOTE.G6, delay: 0.27, dur: 0.26, gain: 0.03, filter: 4200 });
    },
    pop: function () {
      tone({ freq: random(820, 980), to: 150, glide: 0.07, dur: 0.09, gain: 0.15, attack: 0.002 });
      noise({ filterType: "highpass", freq: 2200, dur: 0.014, gain: 0.03 });
    },

    // Extras used by the easter eggs.
    tick: function () {
      tone({ freq: 2100, dur: 0.018, gain: 0.03 });
    },
    coin: function () {
      tone({ type: "square", freq: NOTE.B5, dur: 0.07, gain: 0.04, filter: 5000 });
      tone({ type: "square", freq: NOTE.E6, delay: 0.07, dur: 0.26, gain: 0.04, filter: 5000 });
    },
    gameover: function () {
      arpeggio([NOTE.C5, NOTE.G4, NOTE.E4], 0.16, { type: "triangle", dur: 0.2, gain: 0.08 });
      tone({ type: "triangle", freq: NOTE.C4, to: NOTE.C4 * 0.94, delay: 0.48, dur: 0.6, gain: 0.08 });
    },
    fanfare: function () {
      arpeggio([NOTE.C5, NOTE.E5, NOTE.G5], 0.09, { type: "square", dur: 0.12, gain: 0.035, filter: 4000 });
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach(function (freq) {
        tone({ type: "triangle", freq: freq, delay: 0.3, dur: 0.75, gain: 0.04, attack: 0.02 });
      });
    },
    glitch: function () {
      for (let i = 0; i < 7; i += 1) {
        tone({ type: "square", freq: random(70, 1900), delay: random(0, 0.28), dur: random(0.02, 0.05), gain: 0.04 });
      }
      noise({ filterType: "highpass", freq: 1200, delay: 0.12, dur: 0.06, gain: 0.05 });
    },
    powerdown: function () {
      tone({ type: "sawtooth", freq: 620, to: 32, glide: 0.9, dur: 0.95, gain: 0.07, filter: 1400 });
      tone({ freq: 310, to: 24, glide: 0.9, dur: 0.95, gain: 0.06 });
    },
    thud: function () {
      tone({ freq: 130, to: 42, glide: 0.2, dur: 0.26, gain: 0.2, attack: 0.002 });
      noise({ filterType: "lowpass", freq: 600, dur: 0.08, gain: 0.05 });
    },
    chime: function () {
      tone({ freq: NOTE.G5, dur: 0.5, gain: 0.05, attack: 0.004 });
      tone({ freq: NOTE.C6, delay: 0.11, dur: 0.7, gain: 0.05, attack: 0.004 });
      tone({ freq: NOTE.C6 * 2, delay: 0.11, dur: 0.35, gain: 0.008 });
    },
    snow: function () {
      const scale = [NOTE.C6, NOTE.D6, NOTE.E6, NOTE.G6, NOTE.A5, NOTE.E5];
      for (let i = 0; i < 9; i += 1) {
        tone({ freq: scale[Math.floor(Math.random() * scale.length)], delay: i * 0.32 + random(0, 0.2), dur: 0.9, gain: 0.018, attack: 0.01 });
      }
    },
    wave: function () {
      noise({ filterType: "lowpass", freq: 260, to: 1600, glide: 0.9, back: 300, dur: 1.9, attack: 0.5, gain: 0.16, dest: longBus });
      tone({ freq: 55, to: 82, glide: 1, dur: 1.8, gain: 0.08, attack: 0.3, dest: longBus });
    },
    beep: function () {
      tone({ type: "square", freq: NOTE.A5, dur: 0.1, gain: 0.03, filter: 3000 });
    }
  };

  // Long sounds (the wave) run through their own bus so a skipped effect can silence them: the bus
  // fades out, and every source on it is stopped (queued ones never start), so nothing keeps playing
  // or holds a voice slot after the effect is gone.
  function stopAll() {
    stopMusic();
    if (!ctx || !longBus) return;
    const now = ctx.currentTime;
    const fadeEnd = now + 0.12;
    const oldBus = longBus;
    oldBus.gain.cancelScheduledValues(now);
    oldBus.gain.setValueAtTime(oldBus.gain.value, now);
    oldBus.gain.linearRampToValueAtTime(0, fadeEnd);
    longBus = ctx.createGain();
    longBus.connect(master);
    const stopped = [];
    voices.forEach(function (voice) {
      if (voice.bus !== oldBus) return;
      // A stop time before a queued voice's start means it never sounds at all.
      try { voice.source.stop(fadeEnd); } catch (error) { /* already stopped */ }
      stopped.push(voice);
    });
    // Stop the count right away; onended (or this timer, if a never-started source stays quiet) tidies up.
    stopped.forEach(function (voice) { voices.delete(voice); });
    window.setTimeout(function () {
      stopped.forEach(finish);
      try { oldBus.disconnect(); } catch (error) { /* already detached */ }
    }, 400);
  }

  /* ---------- Party music ----------
   * The one sound that plays while the site's sound toggle is off: typing `party` is the opt-in.
   * About 26 seconds of big-room house at 128 BPM in A minor (Am F C G), synthesised and scheduled
   * live on the audio clock:
   *   bars 1-4   the build: supersaw pads under a lowpass that opens up, a kick for two bars, a snare
   *              roll that doubles every bar, a noise riser and a pitch riser, then an eighth of silence;
   *   bars 5-12  the drop: four-on-the-floor kick, claps on 2 and 4, off-beat open hats, a rolling
   *              bass and supersaw chord stabs pumped by a sidechain on every kick, with a pluck hook
   *              over the last four bars;
   *   bar 13     one last hit, then the reverb tail fades out.
   * It runs on its own bus (glue compressor, limiter, a moderate output level), separate from the UI
   * sounds. stop() ramps that bus to silence in 20 ms, stops every source (queued ones never start),
   * clears the scheduler and disconnects every node. */
  const PARTY_PLAN = Object.freeze({ bpm: 128, dropBeat: 16, endBeat: 48, lengthBeats: 56 });
  const PARTY_VOLUME = 0.5;
  // MIDI voicings for Am, F, C and G, with the bass roots an octave or two below.
  const PARTY_CHORDS = [[57, 60, 64, 69], [57, 60, 65, 69], [55, 60, 64, 67], [55, 59, 62, 67]];
  const PARTY_ROOTS = [45, 41, 48, 43];
  // The pluck hook, one bar per chord, in eighths (null rests).
  const PARTY_HOOK = [
    [76, null, 72, 76, null, 79, 76, 72],
    [77, null, 72, 77, null, 81, 77, 72],
    [76, null, 72, 76, null, 79, 76, 72],
    [74, null, 71, 74, null, 79, 74, 71]
  ];
  // Supersaw: five detuned saws per note, spread left and right.
  const SAW_DETUNE = [-24, -11, 0, 12, 23];
  const SAW_SIDE = [0, 1, 0, 1, 1];

  let music = null;
  let reverbImpulse = null;

  function midi(note) { return 440 * Math.pow(2, (note - 69) / 12); }

  // A dark stereo plate: decaying noise, generated once per sample rate.
  function impulseFor(context) {
    if (reverbImpulse && reverbImpulse.sampleRate === context.sampleRate) return reverbImpulse;
    const length = Math.floor(context.sampleRate * 2.2);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < length; i += 1) {
        smooth += ((Math.random() * 2 - 1) - smooth) * 0.55;
        data[i] = smooth * Math.pow(1 - i / length, 3.2);
      }
    }
    reverbImpulse = buffer;
    return buffer;
  }

  // Sidechain shapes: duck in 8 ms, then breathe back over the rest of the beat.
  function pumpCurve(depth, beat) {
    const points = 192;
    const curve = new Float32Array(points);
    const span = beat * 0.95;
    for (let i = 0; i < points; i += 1) {
      const x = i / (points - 1) * span;
      curve[i] = x < 0.008 ? 1 - depth * (x / 0.008) : 1 - depth * Math.exp(-(x - 0.008) / 0.07);
    }
    curve[points - 1] = 1;
    return curve;
  }

  function stopMusic() {
    if (music) music.stop();
  }

  function startParty() {
    stopMusic();
    const context = ensureContext();
    if (!context || context.state === "closed") return null;

    const beat = 60 / PARTY_PLAN.bpm;
    const step = beat / 4;
    const startAt = context.currentTime + 0.12;
    const endTime = startAt + PARTY_PLAN.lengthBeats * beat;
    const lastStep = PARTY_PLAN.endBeat * 4;
    const buses = [];
    const live = new Set();
    let nextStep = 0;
    let timer = 0;
    let finished = false;

    // Long-lived nodes (buses, compressors, returns), disconnected when the track ends.
    function bus(created) { buses.push(created); return created; }
    function gainNode(value, into) {
      const gain = context.createGain();
      gain.gain.value = value;
      if (into) gain.connect(into);
      return gain;
    }
    function filterNode(type, frequency, q) {
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      if (q) filter.Q.value = q;
      return filter;
    }
    // A short-lived chain: its nodes are disconnected once every source has ended (or on stop).
    function hold(sources, nodes) {
      const entry = { sources: sources, nodes: sources.concat(nodes) };
      live.add(entry);
      let pending = sources.length;
      sources.forEach(function (source) {
        source.onended = function () {
          pending -= 1;
          if (pending > 0 || !live.has(entry)) return;
          live.delete(entry);
          entry.nodes.forEach(function (item) { try { item.disconnect(); } catch (error) { /* detached */ } });
        };
      });
    }
    function voice(sources, nodes, start, stop) {
      hold(sources, nodes);
      sources.forEach(function (source) {
        source.start(start);
        source.stop(stop);
      });
    }
    function noiseSource(loop) {
      const source = context.createBufferSource();
      source.buffer = getNoise();
      source.loop = Boolean(loop);
      return source;
    }

    // Bus: drums, pumped synths and returns -> glue compressor -> limiter -> output level.
    const out = bus(gainNode(PARTY_VOLUME, context.destination));
    const limiter = bus(context.createDynamicsCompressor());
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    limiter.connect(out);
    const glue = bus(context.createDynamicsCompressor());
    glue.threshold.value = -14;
    glue.knee.value = 8;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.012;
    glue.release.value = 0.15;
    glue.connect(limiter);
    const mix = bus(gainNode(1, glue));
    const drums = bus(gainNode(1, mix));
    const effects = bus(gainNode(1, mix));
    const pump = bus(gainNode(1, mix));
    const synths = bus(gainNode(1, pump));
    const verbSend = bus(gainNode(1));
    const verb = bus(context.createConvolver());
    verb.buffer = impulseFor(context);
    const verbReturn = bus(gainNode(0.3, pump));
    verbSend.connect(verb);
    verb.connect(verbReturn);
    // Dotted-eighth echo for the hook, darkened on every repeat.
    const delaySend = bus(gainNode(1));
    const delay = bus(context.createDelay(1));
    delay.delayTime.value = beat * 0.75;
    const delayTone = bus(filterNode("lowpass", 2600));
    const feedback = bus(gainNode(0.3));
    const delayReturn = bus(gainNode(0.32, pump));
    delaySend.connect(delay);
    delay.connect(delayTone);
    delayTone.connect(feedback);
    feedback.connect(delay);
    delayTone.connect(delayReturn);
    // The build's pads share one lowpass that opens across the four bars.
    const sweep = bus(filterNode("lowpass", 320, 4));
    sweep.connect(synths);
    sweep.frequency.setValueAtTime(320, startAt);
    sweep.frequency.exponentialRampToValueAtTime(5200, startAt + 15.5 * beat);
    // The outro fades the whole bus out under the reverb tail.
    out.gain.setValueAtTime(PARTY_VOLUME, endTime - 1.4);
    out.gain.linearRampToValueAtTime(0, endTime - 0.05);

    const pumpDeep = pumpCurve(0.72, beat);
    const pumpSoft = pumpCurve(0.4, beat);

    function kick(t, level, deep) {
      const osc = context.createOscillator();
      const amp = gainNode(0, drums);
      osc.frequency.setValueAtTime(170, t);
      osc.frequency.exponentialRampToValueAtTime(56, t + 0.06);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.32);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.002);
      amp.gain.exponentialRampToValueAtTime(level * 0.45, t + 0.1);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      amp.gain.linearRampToValueAtTime(0, t + 0.4);
      osc.connect(amp);
      voice([osc], [amp], t, t + 0.41);
      // The beater click.
      const click = noiseSource();
      const tone = filterNode("highpass", 2600);
      const clickAmp = gainNode(0, drums);
      clickAmp.gain.setValueAtTime(0, t);
      clickAmp.gain.linearRampToValueAtTime(level * 0.3, t + 0.001);
      clickAmp.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
      clickAmp.gain.linearRampToValueAtTime(0, t + 0.014);
      click.connect(tone);
      tone.connect(clickAmp);
      voice([click], [tone, clickAmp], t, t + 0.02);
      try { pump.gain.setValueCurveAtTime(deep ? pumpDeep : pumpSoft, t, beat * 0.95); } catch (error) { /* running late */ }
    }

    function clap(t) {
      const source = noiseSource();
      const band = filterNode("bandpass", 1500, 0.9);
      const amp = gainNode(0, drums);
      const send = gainNode(0.35, verbSend);
      const g = amp.gain;
      g.setValueAtTime(0, t);
      [0, 0.011, 0.022].forEach(function (offset, index) {
        g.linearRampToValueAtTime(0.42, t + offset + 0.001);
        if (index < 2) g.exponentialRampToValueAtTime(0.05, t + offset + 0.01);
      });
      g.exponentialRampToValueAtTime(0.001, t + 0.2);
      g.linearRampToValueAtTime(0, t + 0.21);
      source.connect(band);
      band.connect(amp);
      amp.connect(send);
      voice([source], [band, amp, send], t, t + 0.22);
    }

    function hat(t, open) {
      const source = noiseSource();
      const high = filterNode("highpass", open ? 7200 : 9000);
      const amp = gainNode(0, drums);
      const length = open ? 0.2 : 0.04;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(open ? 0.13 : 0.06, t + 0.002);
      amp.gain.exponentialRampToValueAtTime(0.001, t + length);
      amp.gain.linearRampToValueAtTime(0, t + length + 0.01);
      source.connect(high);
      high.connect(amp);
      voice([source], [high, amp], t, t + length + 0.02);
    }

    function snare(t, level, lift, gap) {
      const length = Math.min(0.1, gap * 0.95);
      const source = noiseSource();
      const band = filterNode("bandpass", 1300 + 1900 * lift, 0.9);
      const amp = gainNode(0, drums);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.001);
      amp.gain.exponentialRampToValueAtTime(0.001, t + length);
      amp.gain.linearRampToValueAtTime(0, t + length + 0.004);
      source.connect(band);
      band.connect(amp);
      voice([source], [band, amp], t, t + length + 0.01);
      const body = context.createOscillator();
      const bodyAmp = gainNode(0, drums);
      body.type = "triangle";
      body.frequency.setValueAtTime(190 + 90 * lift, t);
      bodyAmp.gain.setValueAtTime(0, t);
      bodyAmp.gain.linearRampToValueAtTime(level * 0.5, t + 0.001);
      bodyAmp.gain.exponentialRampToValueAtTime(0.001, t + length * 0.7);
      bodyAmp.gain.linearRampToValueAtTime(0, t + length * 0.7 + 0.004);
      body.connect(bodyAmp);
      voice([body], [bodyAmp], t, t + length * 0.7 + 0.01);
    }

    function crash(t, level) {
      const source = noiseSource(true);
      const high = filterNode("highpass", 4200);
      const amp = gainNode(0, effects);
      const send = gainNode(0.3, verbSend);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.003);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
      amp.gain.linearRampToValueAtTime(0, t + 1.92);
      source.connect(high);
      high.connect(amp);
      amp.connect(send);
      voice([source], [high, amp, send], t, t + 1.95);
    }

    function boom(t) {
      const osc = context.createOscillator();
      const amp = gainNode(0, effects);
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(36, t + 0.6);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.38, t + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      amp.gain.linearRampToValueAtTime(0, t + 1.42);
      osc.connect(amp);
      voice([osc], [amp], t, t + 1.45);
    }

    // Five detuned saws per note into one filter and one amp; `shape(gain, cutoff)` automates both.
    // `sends` maps extra destinations (reverb) to their levels.
    function supersaw(notes, t0, t1, dest, level, shape, sends) {
      const filter = filterNode("lowpass", 6000, 0.7);
      const amp = gainNode(0, dest);
      const sides = [gainNode(1), gainNode(1)];
      const nodes = [filter, amp].concat(sides);
      if (typeof context.createStereoPanner === "function") {
        [-0.6, 0.6].forEach(function (pan, index) {
          const panner = context.createStereoPanner();
          panner.pan.value = pan;
          sides[index].connect(panner);
          panner.connect(filter);
          nodes.push(panner);
        });
      } else {
        sides.forEach(function (side) { side.connect(filter); });
      }
      (sends || []).forEach(function (send) {
        const level = gainNode(send[1], send[0]);
        amp.connect(level);
        nodes.push(level);
      });
      const sources = [];
      const perSaw = level / (notes.length * 2.4);
      notes.forEach(function (note) {
        const freq = midi(note);
        SAW_DETUNE.forEach(function (cents, index) {
          const osc = context.createOscillator();
          const trim = gainNode(perSaw, sides[SAW_SIDE[index]]);
          osc.type = "sawtooth";
          osc.frequency.value = freq;
          osc.detune.value = cents + (Math.random() * 4 - 2);
          osc.connect(trim);
          nodes.push(trim);
          sources.push(osc);
        });
      });
      filter.connect(amp);
      shape(amp.gain, filter.frequency);
      hold(sources, nodes);
      // Staggered starts keep the saws out of phase, so no chord begins with a spike.
      sources.forEach(function (osc) {
        osc.start(Math.max(context.currentTime, t0 - Math.random() * 0.012));
        osc.stop(t1);
      });
    }
    function pad(bar, t0, t1, level) {
      supersaw(PARTY_CHORDS[bar % 4], t0, t1 + 0.06, sweep, level, function (gain) {
        gain.setValueAtTime(0, t0);
        gain.linearRampToValueAtTime(1, t0 + 0.04);
        gain.setValueAtTime(1, t1 - 0.03);
        gain.linearRampToValueAtTime(0, t1 + 0.03);
      });
    }

    // Chord stabs on a 3-3-2 rhythm, each with its own filter blip.
    function stabs(bar, t0) {
      const hits = [0, 3, 6, 8, 11, 14];
      supersaw(PARTY_CHORDS[bar % 4], t0, t0 + 16 * step + 0.05, synths, 1, function (gain, cutoff) {
        gain.setValueAtTime(0, t0);
        cutoff.setValueAtTime(1800, t0);
        hits.forEach(function (hit, index) {
          const at = t0 + hit * step;
          const length = Math.min(((hits[index + 1] || 16) - hit) * step - 0.012, 0.24);
          gain.setValueAtTime(0, at);
          gain.linearRampToValueAtTime(1, at + 0.004);
          gain.linearRampToValueAtTime(0.55, at + length - 0.03);
          gain.linearRampToValueAtTime(0, at + length);
          cutoff.setValueAtTime(7200, at);
          cutoff.exponentialRampToValueAtTime(1800, at + length);
        });
      }, [[verbSend, 0.22]]);
    }

    // Rolling bass: the three sixteenths after every kick, jumping an octave on the last one of the bar.
    function bass(bar, t0) {
      const root = midi(PARTY_ROOTS[bar % 4]);
      const saw = context.createOscillator();
      const sub = context.createOscillator();
      const tone = filterNode("lowpass", 400, 2);
      const subLevel = gainNode(0.7);
      const amp = gainNode(0, synths);
      saw.type = "sawtooth";
      saw.frequency.value = root;
      sub.frequency.value = root / 2;
      saw.connect(tone);
      tone.connect(amp);
      sub.connect(subLevel);
      subLevel.connect(amp);
      const g = amp.gain;
      g.setValueAtTime(0, t0);
      for (let s = 0; s < 16; s += 1) {
        if (s % 4 === 0) continue;
        const at = t0 + s * step;
        const high = s === 15;
        saw.frequency.setValueAtTime(high ? root * 2 : root, at);
        sub.frequency.setValueAtTime(high ? root : root / 2, at);
        tone.frequency.setValueAtTime(1500, at);
        tone.frequency.exponentialRampToValueAtTime(380, at + 0.1);
        g.setValueAtTime(0, at);
        g.linearRampToValueAtTime(0.36, at + 0.004);
        g.linearRampToValueAtTime(0.24, at + 0.07);
        g.linearRampToValueAtTime(0, at + 0.105);
      }
      voice([saw, sub], [tone, subLevel, amp], t0, t0 + 16 * step + 0.02);
    }

    function pluck(note, t) {
      const freq = midi(note);
      const tone = filterNode("lowpass", 4200, 3);
      const amp = gainNode(0, synths);
      const echo = gainNode(0.4, delaySend);
      const space = gainNode(0.3, verbSend);
      const oscs = [-8, 8].map(function (cents) {
        const osc = context.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = cents;
        osc.connect(tone);
        return osc;
      });
      tone.frequency.setValueAtTime(4200, t);
      tone.frequency.exponentialRampToValueAtTime(700, t + 0.2);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.1, t + 0.003);
      amp.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      amp.gain.linearRampToValueAtTime(0, t + 0.3);
      tone.connect(amp);
      amp.connect(echo);
      amp.connect(space);
      voice(oscs, [tone, amp, echo, space], t, t + 0.31);
    }

    function riser(t0, t1) {
      const source = noiseSource(true);
      const band = filterNode("bandpass", 500, 1.4);
      const amp = gainNode(0, effects);
      band.frequency.setValueAtTime(500, t0);
      band.frequency.exponentialRampToValueAtTime(9000, t1);
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.exponentialRampToValueAtTime(0.28, t1 - 0.012);
      amp.gain.linearRampToValueAtTime(0, t1);
      source.connect(band);
      band.connect(amp);
      voice([source], [band, amp], t0, t1 + 0.01);
      const osc = context.createOscillator();
      const tone = filterNode("lowpass", 2400);
      const lift = gainNode(0, effects);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(110, t0);
      osc.frequency.exponentialRampToValueAtTime(880, t1);
      lift.gain.setValueAtTime(0.0001, t0);
      lift.gain.exponentialRampToValueAtTime(0.04, t1 - 0.012);
      lift.gain.linearRampToValueAtTime(0, t1);
      osc.connect(tone);
      tone.connect(lift);
      voice([osc], [tone, lift], t0, t1 + 0.01);
    }

    function outroChord(t) {
      supersaw(PARTY_CHORDS[0], t, t + 2.5, synths, 1, function (gain, cutoff) {
        gain.setValueAtTime(0, t);
        gain.linearRampToValueAtTime(1, t + 0.005);
        gain.linearRampToValueAtTime(0.5, t + 0.5);
        gain.linearRampToValueAtTime(0, t + 2.45);
        cutoff.setValueAtTime(7000, t);
        cutoff.exponentialRampToValueAtTime(700, t + 2.4);
      }, [[verbSend, 0.35]]);
    }

    function scheduleStep(s, t) {
      const bar = Math.floor(s / 16);
      const pos = s % 16;
      if (s === lastStep) {
        kick(t, 0.95, true);
        crash(t, 0.2);
        boom(t);
        outroChord(t);
        return;
      }
      if (bar < 4) {
        const buildGap = startAt + 15.5 * beat;
        if (s === 0) riser(t, buildGap);
        if (pos === 0) pad(bar, t, bar === 3 ? buildGap : t + 16 * step, 0.28 + bar * 0.14);
        if (bar < 2 && pos % 4 === 0) kick(t, 0.6, false);
        const lift = s / 62;
        const level = 0.06 + 0.4 * Math.pow(lift, 1.6);
        let hits = 0;
        if (bar === 0) hits = pos % 4 === 0 ? 1 : 0;
        else if (bar === 1) hits = pos % 2 === 0 ? 1 : 0;
        else if (bar === 2 || pos < 8) hits = 1;
        else if (pos < 14) hits = 2;
        for (let h = 0; h < hits; h += 1) snare(t + h * step / 2, level, lift, step / hits);
        return;
      }
      const drop = bar - 4;
      if (pos === 0) {
        stabs(drop, t);
        bass(drop, t);
        if (drop === 0) { crash(t, 0.22); boom(t); }
        if (drop === 4) crash(t, 0.12);
      }
      if (pos % 4 === 0) {
        kick(t, 0.95, true);
        if (pos === 4 || pos === 12) clap(t);
      } else if (pos % 4 === 2) {
        hat(t, true);
      } else {
        hat(t, false);
      }
      if (drop >= 4 && pos % 2 === 0) {
        const note = PARTY_HOOK[drop % 4][pos / 2];
        if (note) pluck(note, t);
      }
    }

    function teardown() {
      window.clearTimeout(timer);
      live.forEach(function (entry) {
        entry.sources.forEach(function (source) { try { source.stop(); } catch (error) { /* not started or done */ } });
        entry.nodes.forEach(function (item) { try { item.disconnect(); } catch (error) { /* detached */ } });
      });
      live.clear();
      buses.forEach(function (item) { try { item.disconnect(); } catch (error) { /* detached */ } });
      buses.length = 0;
      // Nothing else uses the context while sound is off, so let the audio device sleep.
      if (!enabled && ctx && ctx.state === "running" && !music) {
        const suspended = ctx.suspend();
        if (suspended && suspended.catch) suspended.catch(noop);
      }
    }

    function end(natural) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      if (music === handle) music = null;
      if (natural) {
        teardown();
      } else {
        // Instant, but never a click: 20 ms to silence, then every source stops.
        const now = context.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(0, now + 0.02);
        live.forEach(function (entry) {
          entry.sources.forEach(function (source) { try { source.stop(now + 0.025); } catch (error) { /* done */ } });
        });
        window.setTimeout(teardown, 60);
      }
      if (typeof handle.onstop === "function") {
        try { handle.onstop(natural); } catch (error) { /* listener failed */ }
      }
    }

    function tick() {
      if (finished) return;
      const horizon = context.currentTime + 0.25;
      while (nextStep <= lastStep && startAt + nextStep * step < horizon) {
        try { scheduleStep(nextStep, startAt + nextStep * step); } catch (error) { /* keep the beat going */ }
        nextStep += 1;
      }
      if (context.currentTime >= endTime) {
        end(true);
        return;
      }
      timer = window.setTimeout(tick, 40);
    }

    const handle = {
      plan: PARTY_PLAN,
      startAt: startAt,
      // Seconds since the first beat, as heard: the audio clock minus the output latency.
      time: function () {
        let heard = context.currentTime;
        if (context.state === "running" && typeof context.getOutputTimestamp === "function") {
          const stamp = context.getOutputTimestamp();
          if (stamp && stamp.contextTime > 0 && stamp.performanceTime > 0) {
            heard = Math.min(heard, stamp.contextTime + Math.max(0, (window.performance.now() - stamp.performanceTime) / 1000));
          }
        } else {
          heard -= context.outputLatency || context.baseLatency || 0;
        }
        return heard - startAt;
      },
      running: function () { return !finished && context.state === "running"; },
      stop: function () { end(false); },
      onstop: null
    };
    Object.defineProperty(handle, "playing", { enumerable: true, get: function () { return !finished; } });
    music = handle;
    tick();
    return handle;
  }

  // Called from the gesture that asks for music (the `party` command), so iOS lets the context run.
  function warm() {
    const context = ensureContext();
    if (!context) return false;
    playSilence(context);
    return true;
  }

  function play(name) {
    if (!enabled || !recipes[name]) return false;
    const now = window.performance ? window.performance.now() : Date.now();
    const gap = MIN_GAP[name] || MIN_GAP.default;
    if (lastPlayed[name] && now - lastPlayed[name] < gap) return false;
    const context = ensureContext();
    if (!context || !master) return false;
    if (soundingVoices() >= MAX_VOICES) return false;
    lastPlayed[name] = now;
    try {
      recipes[name]();
      return true;
    } catch (error) {
      return false;
    }
  }

  function syncToggles() {
    doc.querySelectorAll("[data-sound-toggle]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(enabled));
      button.setAttribute("data-sound-state", enabled ? "on" : "off");
      button.classList.toggle("is-on", enabled);
      if (!AudioCtor) {
        button.setAttribute("aria-disabled", "true");
        button.title = "Sound is not supported in this browser";
      } else {
        button.title = enabled ? "Sound effects on (click to mute)" : "Sound effects off (click to unmute)";
      }
      const label = button.querySelector("[data-sound-label]");
      if (label) {
        label.textContent = enabled
          ? (button.getAttribute("data-label-on") || "SOUND ON")
          : (button.getAttribute("data-label-off") || "SOUND OFF");
      }
      const icon = button.querySelector("[data-sound-icon]");
      if (icon) icon.textContent = enabled ? "♪" : "×";
    });
  }

  function setEnabled(value, options) {
    const next = Boolean(value) && Boolean(AudioCtor);
    const changed = next !== enabled;
    enabled = next;
    try { window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off"); } catch (error) { /* storage blocked */ }
    if (next) {
      ensureContext();
      if (!(options && options.silent)) play("powerup");
    } else {
      stopAll();
    }
    syncToggles();
    if (changed && typeof JBOS.emit === "function") JBOS.emit("sound-change", { enabled: next });
    return next;
  }

  const api = {
    play: play,
    setEnabled: setEnabled,
    toggle: function (options) { return setEnabled(!enabled, options); },
    stopAll: stopAll,
    // The party track: plays even while sound is off (asking for a party is the opt-in).
    // warm() must run inside the gesture that asked for it; party() returns a handle or null.
    warm: warm,
    party: startParty,
    supported: Boolean(AudioCtor),
    names: Object.keys(recipes)
  };
  Object.defineProperty(api, "enabled", {
    enumerable: true,
    get: function () { return enabled; },
    set: function (value) { setEnabled(value, { silent: true }); }
  });
  JBOS.sound = api;

  // Header toggle (rendered by the theme module): document-level delegation, so it can appear at any time.
  doc.addEventListener("click", function (event) {
    const button = event.target.closest ? event.target.closest("[data-sound-toggle]") : null;
    if (!button) return;
    event.preventDefault();
    if (!AudioCtor) {
      if (JBOS.toast) JBOS.toast("SOUND IS NOT SUPPORTED IN THIS BROWSER");
      return;
    }
    const on = api.toggle();
    if (JBOS.toast) JBOS.toast(on ? "SOUND ON · EVERY BLEEP IS SYNTHESISED LIVE" : "SOUND OFF · BACK TO SILENT MODE");
  });

  syncToggles();
  doc.addEventListener("DOMContentLoaded", syncToggles);
  window.addEventListener("pageshow", syncToggles);

  // Default hooks. play() is a no-op while sound is off, so these cost nothing for most visitors.
  const terminalInput = JBOS.terminal && JBOS.terminal.input;
  if (terminalInput) {
    terminalInput.addEventListener("keydown", function (event) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") play("type");
      else if (event.key === "Enter") play("click");
    });
  }

  // Any <dialog> (terminal, lightbox, book reader) chirps as it opens and closes.
  if ("MutationObserver" in window) {
    const dialogObserver = new MutationObserver(function (records) {
      records.forEach(function (record) {
        const target = record.target;
        if (!target || target.tagName !== "DIALOG") return;
        const isOpen = target.hasAttribute("open");
        const wasOpen = record.oldValue !== null;
        if (isOpen && !wasOpen) play("open");
        else if (!isOpen && wasOpen) play("close");
      });
    });
    dialogObserver.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["open"], attributeOldValue: true });

    let leaving = false;
    const leaveObserver = new MutationObserver(function () {
      const now = doc.body.classList.contains("is-leaving");
      if (now && !leaving) play("whoosh");
      leaving = now;
    });
    leaveObserver.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
  }

  doc.addEventListener("click", function (event) {
    if (!enabled || !event.target.closest) return;
    if (event.target.closest(".primary-nav a, .brand, .header-contact, .footer-links a, .cta, [data-transition-link]")) play("click");
  });
})();
