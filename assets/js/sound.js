(function () {
  "use strict";

  // JB//OS sound engine. Every sound is synthesised live with WebAudio: no audio files, no network.
  // Off by default; the choice persists in localStorage "jb-sound". The AudioContext is only created
  // (or resumed) once the visitor has interacted with the page, so browsers never block or warn.

  const doc = document;
  const JBOS = window.JBOS = window.JBOS || {};
  const STORAGE_KEY = "jb-sound";
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
    if (!context) return;
    try {
      const silent = context.createBuffer(1, 1, 22050);
      const source = context.createBufferSource();
      source.buffer = silent;
      source.connect(context.destination);
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
    },
    party: function () {
      // A tiny 124 BPM drum machine with a square-wave bassline: twelve beats, about 5.6 seconds,
      // so it wraps up with the party effect's own 5.9-second light show.
      const beat = 60 / 124;
      const steps = 12;
      const bass = [NOTE.A2, NOTE.A2, NOTE.C3, NOTE.A2, NOTE.D3, NOTE.A2, NOTE.E3, NOTE.G3];
      for (let step = 0; step < steps; step += 1) {
        const at = step * beat;
        const last = step === steps - 1;
        tone({ freq: 150, to: 45, glide: 0.12, delay: at, dur: last ? 0.4 : 0.22, gain: 0.26, dest: longBus });
        if (!last) noise({ filterType: "highpass", freq: 7000, delay: at + beat / 2, dur: 0.05, gain: 0.05, dest: longBus });
        if (step % 2 === 1) noise({ freq: 1500, q: 0.7, delay: at, dur: 0.12, gain: 0.08, dest: longBus });
        if (!last) tone({ type: "square", freq: bass[step % bass.length], delay: at + beat / 2, dur: beat * 0.45, gain: 0.05, filter: 700, dest: longBus });
      }
      arpeggio([NOTE.E5, NOTE.G5, NOTE.A5, NOTE.C6], beat / 2, { type: "triangle", delay: beat * 4, dur: 0.18, gain: 0.03, dest: longBus });
      arpeggio([NOTE.C6, NOTE.A5, NOTE.G5, NOTE.E5], beat / 2, { type: "triangle", delay: beat * 8, dur: 0.18, gain: 0.03, dest: longBus });
      // Final stab: a bright A-minor chord on the last downbeat.
      [NOTE.A4, NOTE.C5, NOTE.E5, NOTE.A5].forEach(function (freq) {
        tone({ type: "triangle", freq: freq, delay: beat * (steps - 1), dur: 0.5, gain: 0.03, attack: 0.01, dest: longBus });
      });
    }
  };

  // Long sounds (party, wave) run through their own bus so a skipped effect can silence them: the bus
  // fades out, and every source on it is stopped (queued ones never start), so nothing keeps playing
  // or holds a voice slot after the effect is gone.
  function stopAll() {
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

  // Terminal command.
  if (typeof JBOS.registerCommand === "function") {
    JBOS.registerCommand("sound", {
      help: "sound on | off | status | test",
      run: function (args) {
        const print = JBOS.terminal && JBOS.terminal.print ? JBOS.terminal.print : noop;
        const sub = String(args[0] || "status").toLowerCase();
        if (!AudioCtor) {
          print("sound: this browser has no WebAudio support. Enjoy the silence.");
          return;
        }
        if (sub === "on" || sub === "enable" || sub === "1") {
          setEnabled(true);
          print("SOUND ON · synthesised live in WebAudio, zero audio files.", true);
        } else if (sub === "off" || sub === "disable" || sub === "mute" || sub === "0") {
          setEnabled(false);
          print("SOUND OFF.", true);
        } else if (sub === "toggle") {
          print(api.toggle() ? "SOUND ON." : "SOUND OFF.", true);
        } else if (sub === "test" || sub === "demo") {
          if (!enabled) {
            print("sound: currently off. Type `sound on` first.");
            return;
          }
          const lineup = ["click", "type", "open", "close", "pop", "whoosh", "success", "error", "powerup", "boot"];
          const line = print("Testing: ");
          lineup.forEach(function (name, index) {
            window.setTimeout(function () {
              play(name);
              if (line) line.textContent = "Testing: " + lineup.slice(0, index + 1).join(" · ");
            }, index * 420);
          });
        } else if (sub === "status") {
          print("sound: " + (enabled ? "ON" : "OFF") + " · usage: sound on | off | status | test", true);
        } else {
          print("sound: unknown option \"" + sub + "\". Try: sound on | off | status | test");
        }
      }
    });
  }

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
