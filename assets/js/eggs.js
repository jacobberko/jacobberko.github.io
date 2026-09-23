(function () {
  "use strict";

  // JB//OS easter eggs. Terminal commands: gravity, barrel, party, hack, snake and screensaver, plus
  // the hidden `do` and `shake` (theme lives in themes.js). On the page: the hero name bursts on five
  // quick clicks, a mouse or phone shake wobbles the page, 60 idle seconds start a screensaver (any
  // click or key wakes it), the chrome star charges up, and the 404 page has a runaway page to catch.
  // Effects run one at a time, stop on Escape, and swap motion for a toast under reduced motion.
  // Nothing here lists the page secrets: finding them is the point.

  const doc = document;
  const root = doc.documentElement;
  const body = doc.body;
  const JBOS = window.JBOS;
  if (!JBOS || !body) return;

  /* ---------------------------------------------------------------------------------------------
   * Environment
   * ------------------------------------------------------------------------------------------- */

  const reduceMotion = Boolean(JBOS.reduceMotion);
  const finePointer = Boolean(JBOS.finePointer);
  const term = JBOS.terminal || {};
  const terminalEl = term.element || null;
  const terminalOutput = term.output || null;
  const terminalInput = term.input || null;
  const terminalForm = terminalEl ? terminalEl.querySelector("[data-terminal-form]") : null;
  const terminalLabel = terminalForm ? terminalForm.querySelector("label") : null;
  const PROMPT = terminalLabel ? terminalLabel.textContent : "visitor@jb:~$";
  const EMAIL = "business@jacobberko.com";
  const MAILTO = "mailto:" + EMAIL + "?subject=" + encodeURIComponent("Let's build something");
  const supportsPopover = typeof HTMLElement === "function" &&
    Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");
  const supportsTransforms = Boolean(window.CSS && CSS.supports &&
    CSS.supports("translate", "1px 1px") && CSS.supports("rotate", "1deg"));
  // Built-ins handled directly by site.js.
  const BUILTINS = ["help", "clear"];

  /* ---------------------------------------------------------------------------------------------
   * Small helpers
   * ------------------------------------------------------------------------------------------- */

  function clock() { return window.performance ? window.performance.now() : Date.now(); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

  function sfx(name) {
    try {
      if (JBOS.sound && typeof JBOS.sound.play === "function") JBOS.sound.play(name);
    } catch (error) { /* sound is optional */ }
  }

  function toast(message) {
    if (typeof JBOS.toast === "function") JBOS.toast(message);
  }

  function readStore(key, session) {
    try { return (session ? window.sessionStorage : window.localStorage).getItem(key); } catch (error) { return null; }
  }

  function writeStore(key, value, session) {
    try { (session ? window.sessionStorage : window.localStorage).setItem(key, value); } catch (error) { /* storage blocked */ }
  }

  function make(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function cssVar(name, fallback, scope) {
    const value = window.getComputedStyle(scope || root).getPropertyValue(name).trim();
    return value || fallback;
  }

  function themePalette() {
    return [
      cssVar("--acid", "#d9ff43"),
      cssVar("--cyan", "#35e6df"),
      cssVar("--magenta", "#ff58c8"),
      cssVar("--orange", "#ff6740"),
      cssVar("--violet", "#7357ff")
    ];
  }

  function isEditable(node) {
    return Boolean(node && (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable));
  }

  // Real <dialog>s, plus any module that marks itself modal (body.dialog-open / aria-modal="true").
  function dialogOpen() {
    return Boolean(doc.querySelector("dialog[open]")) || body.classList.contains("dialog-open") ||
      Boolean(doc.querySelector("[aria-modal='true']:not(dialog):not([hidden])"));
  }
  function terminalOpen() { return Boolean(terminalEl && terminalEl.open); }
  function closeTerminal() { if (terminalOpen() && typeof term.close === "function") term.close(); }
  function openTerminal() { if (!terminalOpen() && typeof term.open === "function") term.open(); }

  function mediaPlaying() {
    return Array.prototype.some.call(doc.querySelectorAll("video, audio"), function (media) {
      return !media.paused && !media.ended;
    });
  }

  function ithacaTime(options) {
    try {
      return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: "America/New_York" }, options)).format(new Date());
    } catch (error) {
      return new Date().toLocaleString();
    }
  }

  function textBar(percent, width) {
    const filled = Math.round(clamp(percent, 0, 100) / 100 * width);
    return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
  }

  // Optimal-string-alignment distance: like Levenshtein, but a swapped pair ("cta") costs 1.
  function editDistance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i += 1) {
      d.push([i]);
      for (let j = 1; j <= b.length; j += 1) d[i].push(i ? 0 : j);
    }
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  /* ---------------------------------------------------------------------------------------------
   * Terminal output helpers
   * ------------------------------------------------------------------------------------------- */

  function print(text, className) {
    return typeof term.print === "function" ? term.print(String(text), className || false) : null;
  }

  function scrollTerminal() {
    if (terminalOutput) terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  function appendToTerminal(node) {
    if (!terminalOutput) return null;
    terminalOutput.appendChild(node);
    scrollTerminal();
    return node;
  }

  // Prefer the terminal when it is open (the toast would sit behind the modal backdrop).
  function say(message, className) {
    if (terminalOpen()) print(message, className || "egg-ok");
    else toast(message);
  }

  /* ---------------------------------------------------------------------------------------------
   * FX runtime: one top-layer host (a manual popover, so effects can sit above an open terminal)
   * that holds every overlay, a one-at-a-time effect runner, canvases and a confetti engine.
   * ------------------------------------------------------------------------------------------- */

  let fxHost = null;
  // Counts other popovers opening, so an already-open host is only re-raised when something may
  // have been stacked above it (a popover from another module, or any open dialog such as the terminal).
  let foreignLayers = 0;
  let raisedAt = -1;
  doc.addEventListener("beforetoggle", function (event) {
    if (event.target !== fxHost && event.newState === "open") foreignLayers += 1;
  }, true);

  function raise(node) {
    if (!supportsPopover || !node || !node.isConnected) return;
    try {
      if (node.matches(":popover-open")) {
        if (raisedAt === foreignLayers && !doc.querySelector("dialog[open]")) return;
        node.hidePopover();
      }
      node.showPopover();
      raisedAt = foreignLayers;
    } catch (error) { /* popover unavailable: the fixed-position fallback still renders */ }
  }

  function host() {
    if (!fxHost) {
      fxHost = make("div", "egg-fx");
      fxHost.setAttribute("aria-hidden", "true");
      if (supportsPopover) fxHost.setAttribute("popover", "manual");
      body.appendChild(fxHost);
    }
    raise(fxHost);
    return fxHost;
  }

  function settleHost() {
    if (!fxHost || fxHost.childElementCount || !supportsPopover) return;
    try { if (fxHost.matches(":popover-open")) fxHost.hidePopover(); } catch (error) { /* already hidden */ }
  }

  let active = null;

  function effect(name, setup, options) {
    options = options || {};
    if (active) return null;
    const fx = {
      name: name,
      ended: false,
      startedAt: clock(),
      skippable: options.skippable !== false,
      timers: [],
      raf: 0,
      cleanups: [],
      onSkip: null,
      after: function (ms, fn) {
        const id = window.setTimeout(function () { if (!fx.ended) fn(); }, ms);
        fx.timers.push(id);
        return id;
      },
      loop: function (step) {
        let last = clock();
        function frame(time) {
          if (fx.ended) return;
          const dt = Math.min(Math.max((time - last) / 1000, 0), 0.05);
          last = time;
          let keep;
          try { keep = step(dt, time); } catch (error) { keep = false; fx.end(); }
          if (keep === false || fx.ended) return;
          fx.raf = window.requestAnimationFrame(frame);
        }
        fx.raf = window.requestAnimationFrame(frame);
      },
      onEnd: function (fn) { fx.cleanups.push(fn); },
      end: function () {
        if (fx.ended) return;
        fx.ended = true;
        fx.timers.forEach(window.clearTimeout);
        window.cancelAnimationFrame(fx.raf);
        while (fx.cleanups.length) {
          try { fx.cleanups.pop()(); } catch (error) { /* keep cleaning */ }
        }
        if (active === fx) active = null;
        settleHost();
      },
      skip: function () {
        if (fx.onSkip) {
          const handler = fx.onSkip;
          fx.onSkip = null;
          handler();
        } else {
          fx.end();
        }
      }
    };
    active = fx;
    try {
      setup(fx);
    } catch (error) {
      fx.end();
      return null;
    }
    return fx.ended ? null : fx;
  }

  // Escape (or a click, once the effect has had a moment) always gets the page back.
  doc.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && active && active.skippable) active.skip();
  }, true);
  window.addEventListener("pointerdown", function () {
    if (active && active.skippable && clock() - active.startedAt > 320) active.skip();
  }, true);
  window.addEventListener("pagehide", function () {
    if (active) active.end();
  });

  function makeCanvas(className) {
    const canvas = make("canvas", "egg-canvas" + (className ? " " + className : ""));
    const context = canvas.getContext("2d");
    if (!context) return null;
    const view = { canvas: canvas, ctx: context, w: 0, h: 0 };
    view.resize = function () {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      view.w = window.innerWidth;
      view.h = window.innerHeight;
      canvas.width = Math.round(view.w * dpr);
      canvas.height = Math.round(view.h * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    view.destroy = function () {
      window.removeEventListener("resize", view.resize);
      canvas.remove();
      settleHost();
    };
    view.resize();
    window.addEventListener("resize", view.resize, { passive: true });
    host().appendChild(canvas);
    return view;
  }

  function fxCanvas(fx, className) {
    const view = makeCanvas(className);
    if (!view) throw new Error("canvas unavailable");
    fx.onEnd(view.destroy);
    return view;
  }

  function confettiField(view) {
    const pieces = [];
    const GRAVITY = 520;
    return {
      burst: function (options) {
        options = options || {};
        const small = view.w < 640;
        const colors = options.colors || themePalette();
        const count = Math.round((options.count || 130) * (small ? 0.55 : 1));
        let origin = options.origin || { x: view.w / 2, y: view.h * 0.55 };
        let baseAngle = options.angle === undefined ? -Math.PI / 2 : options.angle;
        let spread = options.spread === undefined ? Math.PI / 2.6 : options.spread;
        if (origin === "left") { origin = { x: -10, y: view.h + 10 }; baseAngle = -Math.PI / 3; spread = 0.32; }
        if (origin === "right") { origin = { x: view.w + 10, y: view.h + 10 }; baseAngle = -2 * Math.PI / 3; spread = 0.32; }
        const power = (options.power || (origin.y > view.h ? 1500 : 1100)) * (small ? 0.82 : 1);
        for (let i = 0; i < count; i += 1) {
          const angle = baseAngle + rand(-spread, spread);
          const speed = power * rand(0.35, 1);
          const kind = Math.random();
          pieces.push({
            x: origin.x + rand(-6, 6),
            y: origin.y + rand(-6, 6),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            w: kind < 0.15 ? rand(5, 8) : rand(6, 10),
            h: kind > 0.85 ? rand(14, 22) : rand(8, 14),
            shape: kind < 0.15 ? "dot" : (kind > 0.85 ? "ribbon" : "rect"),
            rot: rand(0, Math.PI * 2),
            vr: rand(-9, 9),
            tilt: rand(0, Math.PI * 2),
            vt: rand(5, 13),
            color: pick(colors),
            age: 0,
            life: rand(2.6, 4.2) * (options.life || 1)
          });
        }
        if (pieces.length > 900) pieces.splice(0, pieces.length - 900);
      },
      step: function (dt) {
        const dragX = Math.pow(0.08, dt);
        const dragY = Math.pow(0.2, dt);
        for (let i = pieces.length - 1; i >= 0; i -= 1) {
          const piece = pieces[i];
          piece.age += dt;
          piece.vx *= dragX;
          piece.vy = piece.vy * dragY + GRAVITY * dt;
          piece.tilt += piece.vt * dt;
          piece.rot += piece.vr * dt;
          piece.x += (piece.vx + Math.sin(piece.tilt) * 28) * dt;
          piece.y += piece.vy * dt;
          if (piece.age > piece.life || piece.y > view.h + 40) pieces.splice(i, 1);
        }
        return pieces.length;
      },
      // keep: draw over whatever is already on the canvas this frame.
      draw: function (keep) {
        const ctx = view.ctx;
        if (!keep) ctx.clearRect(0, 0, view.w, view.h);
        pieces.forEach(function (piece) {
          ctx.globalAlpha = clamp((piece.life - piece.age) / 0.6, 0, 1);
          ctx.fillStyle = piece.color;
          ctx.save();
          ctx.translate(piece.x, piece.y);
          ctx.rotate(piece.rot);
          if (piece.shape === "dot") {
            ctx.beginPath();
            ctx.arc(0, 0, piece.w / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.scale(1, Math.cos(piece.tilt));
            const width = piece.shape === "ribbon" ? piece.w * 0.45 : piece.w;
            ctx.fillRect(-width / 2, -piece.h / 2, width, piece.h);
          }
          ctx.restore();
        });
        ctx.globalAlpha = 1;
      },
      count: function () { return pieces.length; }
    };
  }

  // A confetti show that holds the effect lock until the last piece lands.
  function confettiEffect(name, bursts, options) {
    if (reduceMotion) return null;
    return effect(name, function (fx) {
      const view = fxCanvas(fx);
      const field = confettiField(view);
      let lastBurst = 0;
      bursts.forEach(function (burst) {
        lastBurst = Math.max(lastBurst, burst.delay || 0);
        fx.after(burst.delay || 0, function () { field.burst(burst); });
      });
      fx.loop(function (dt) {
        const alive = field.step(dt);
        field.draw();
        if (!alive && clock() - fx.startedAt > lastBurst + 120) {
          fx.end();
          return false;
        }
        return true;
      });
    }, options);
  }

  // Small, lock-free sparkle bursts for toys (the orb, the 404 catch).
  function sparkle(origin, options) {
    if (reduceMotion) return;
    const view = makeCanvas();
    if (!view) return;
    const field = confettiField(view);
    field.burst(Object.assign({ origin: origin, count: 42, power: 620, spread: Math.PI }, options));
    let last = clock();
    const started = last;
    function frame(time) {
      const dt = Math.min(Math.max((time - last) / 1000, 0), 0.05);
      last = time;
      if (field.step(dt) && time - started < 6000) {
        field.draw();
        window.requestAnimationFrame(frame);
      } else {
        view.destroy();
      }
    }
    window.requestAnimationFrame(frame);
  }

  function pickChunks(limit) {
    const selector = [
      ".site-header .header-shell",
      "main h1", "main h2", "main h3", "main h4", "main p", "main li", "main figure", "main img",
      "main .window", "main .cta", "main .tag", "main .stat-item", "main .chrome-orb", "main .ticker",
      "main blockquote", "main pre", "main table", "main button", "main a", "main iframe", "main video",
      "main canvas", "main svg", "main [class*='card']", ".site-footer a", ".site-footer p"
    ].join(",");
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxArea = vw * vh * 0.45;
    const chosen = [];
    const nodes = doc.querySelectorAll(selector);
    for (let i = 0; i < nodes.length && chosen.length < limit; i += 1) {
      const node = nodes[i];
      if (node.closest("dialog, .egg-fx, [hidden]")) continue;
      if (chosen.some(function (chunk) { return chunk.el.contains(node); })) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 12) continue;
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
      if (rect.width * rect.height > maxArea) continue;
      const style = window.getComputedStyle(node);
      if (style.display === "inline" && !/^(IMG|SVG|CANVAS|VIDEO|IFRAME)$/i.test(node.tagName)) continue;
      if (style.visibility === "hidden" || style.position === "fixed" || Number(style.opacity) === 0) continue;
      chosen.push({ el: node, rect: rect });
    }
    return chosen;
  }

  function parseTranslate(value) {
    if (!value || value === "none") return { x: 0, y: 0 };
    const numbers = value.match(/-?\d*\.?\d+(?:e-?\d+)?px/g) || [];
    return { x: parseFloat(numbers[0]) || 0, y: parseFloat(numbers[1]) || 0 };
  }

  /* ---------------------------------------------------------------------------------------------
   * Effects
   * ------------------------------------------------------------------------------------------- */

  // The hero name bursts into letters that obey gravity, then springs back together.
  function textPaint(node, parent) {
    const cs = window.getComputedStyle(node);
    const paint = [
      ["font-family", cs.fontFamily], ["font-size", cs.fontSize], ["font-weight", cs.fontWeight],
      ["font-style", cs.fontStyle], ["text-transform", cs.textTransform], ["color", cs.color],
      ["text-shadow", cs.textShadow]
    ];
    const fill = cs.getPropertyValue("-webkit-text-fill-color");
    const strokeWidth = cs.getPropertyValue("-webkit-text-stroke-width");
    if (strokeWidth && parseFloat(strokeWidth) > 0) {
      paint.push(["-webkit-text-stroke-width", strokeWidth]);
      paint.push(["-webkit-text-stroke-color", cs.getPropertyValue("-webkit-text-stroke-color")]);
    }
    function clipsText(style) {
      return /text/.test(style.getPropertyValue("-webkit-background-clip") + " " + style.getPropertyValue("background-clip")) &&
        style.backgroundImage && style.backgroundImage !== "none";
    }
    const parentStyle = parent ? window.getComputedStyle(parent) : null;
    const gradientSource = clipsText(cs) ? cs : (parentStyle && clipsText(parentStyle) ? parentStyle : null);
    if (gradientSource) {
      paint.push(["background-image", gradientSource.backgroundImage]);
      paint.push(["-webkit-background-clip", "text"]);
      paint.push(["background-clip", "text"]);
      paint.push(["-webkit-text-fill-color", "transparent"]);
    } else {
      const transparent = /^(transparent|rgba\([^)]*,\s*0\))$/.test((fill || cs.color || "").replace(/\s+/g, " ").trim());
      paint.push(["-webkit-text-fill-color", transparent ? cssVar("--ink", "#11110f") : (fill || cs.color)]);
    }
    return paint;
  }

  function burstName(title) {
    if (reduceMotion || !supportsTransforms) {
      toast("JAKE BERKO IS STRUCTURALLY SOUND. (REDUCED MOTION IS ON.)");
      return;
    }
    effect("burst", function (fx) {
      const selection = window.getSelection ? window.getSelection() : null;
      if (selection && selection.removeAllRanges) selection.removeAllRanges();

      const overlay = make("div", "egg-burst");
      overlay.setAttribute("aria-hidden", "true");
      const titleRect = title.getBoundingClientRect();
      const centerX = titleRect.left + titleRect.width / 2;
      const startScroll = window.scrollY;
      const range = doc.createRange();
      const letters = [];

      Array.prototype.forEach.call(title.querySelectorAll("span"), function (line) {
        const original = line.dataset.original || line.textContent;
        if (line.textContent !== original) line.textContent = original;
        const node = line.firstChild;
        if (!node || node.nodeType !== 3) return;
        const paint = textPaint(line, title);
        for (let i = 0; i < node.length; i += 1) {
          const character = node.data.charAt(i);
          if (!character.trim()) continue;
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getBoundingClientRect();
          if (!rect.width) continue;
          const glyph = make("span", "egg-burst__char", character);
          paint.forEach(function (entry) { if (entry[1]) glyph.style.setProperty(entry[0], entry[1]); });
          glyph.style.left = rect.left + "px";
          glyph.style.top = rect.top + "px";
          glyph.style.width = rect.width + "px";
          glyph.style.height = rect.height + "px";
          glyph.style.lineHeight = rect.height + "px";
          overlay.appendChild(glyph);
          const offset = rect.left + rect.width / 2 - centerX;
          letters.push({
            el: glyph, rect: rect, x: 0, y: 0, a: 0,
            vx: offset * rand(2.2, 4.2) + rand(-260, 260),
            vy: rand(-1350, -650),
            va: rand(-560, 560)
          });
        }
      });
      if (range.detach) range.detach();
      if (!letters.length) throw new Error("nothing to burst");

      body.appendChild(overlay);
      title.classList.add("egg-title-hidden");
      fx.onEnd(function () {
        overlay.remove();
        title.classList.remove("egg-title-hidden");
      });

      sfx("pop");
      let t = 0;
      let phase = "fall";
      let returnAt = 0;
      fx.loop(function (dt) {
        t += dt;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const scrollDelta = window.scrollY - startScroll;
        let settled = true;
        letters.forEach(function (letter) {
          if (phase === "fall") {
            letter.vy += 2600 * dt;
            letter.x += letter.vx * dt;
            letter.y += letter.vy * dt;
            letter.a += letter.va * dt;
            const floor = vh - letter.rect.bottom + scrollDelta;
            if (letter.y > floor) {
              letter.y = floor;
              if (letter.vy > 320) sfx("thud");
              letter.vy *= -0.5;
              letter.vx *= 0.82;
              letter.va *= 0.7;
            }
            const minX = -letter.rect.left;
            const maxX = vw - letter.rect.right;
            if (letter.x < minX) { letter.x = minX; letter.vx = Math.abs(letter.vx) * 0.6; }
            else if (letter.x > maxX) { letter.x = maxX; letter.vx = -Math.abs(letter.vx) * 0.6; }
          } else {
            // Underdamped spring home, so the letters overshoot a touch and click into place.
            letter.vx += (-150 * letter.x - 15 * letter.vx) * dt;
            letter.vy += (-150 * letter.y - 15 * letter.vy) * dt;
            letter.va += (-150 * letter.a - 15 * letter.va) * dt;
            letter.x += letter.vx * dt;
            letter.y += letter.vy * dt;
            letter.a += letter.va * dt;
            if (Math.abs(letter.x) + Math.abs(letter.y) + Math.abs(letter.a) > 0.9 ||
              Math.abs(letter.vx) + Math.abs(letter.vy) > 6) settled = false;
          }
          // Physics runs in page space; the layer is fixed, so follow any scrolling.
          letter.el.style.transform = "translate3d(" + letter.x.toFixed(2) + "px," + (letter.y - scrollDelta).toFixed(2) + "px,0) rotate(" + letter.a.toFixed(2) + "deg)";
        });
        if (phase === "fall" && t > 1.75) {
          phase = "return";
          returnAt = t;
          sfx("whoosh");
          letters.forEach(function (letter) { letter.vx *= 0.15; letter.vy = 0; letter.va *= 0.15; });
        } else if (phase === "return" && ((settled && t - returnAt > 0.35) || t - returnAt > 2.4)) {
          fx.end();
          sfx("success");
          return false;
        }
        return true;
      });
    });
  }

  function gravity() {
    if (reduceMotion || !supportsTransforms) {
      toast("GRAVITY CHECK: STILL 9.81 M/S². (MOTION IS REDUCED, SO EVERYTHING STAYS PUT.)");
      return;
    }
    effect("gravity", function (fx) {
      const chunks = pickChunks(44);
      if (!chunks.length) throw new Error("nothing to drop");
      const startScroll = window.scrollY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pieces = chunks.map(function (chunk, index) {
        const node = chunk.el;
        const style = window.getComputedStyle(node);
        const saved = {
          translate: node.style.translate,
          rotate: node.style.rotate,
          transition: node.style.transition,
          willChange: node.style.willChange
        };
        node.style.transition = "none";
        node.style.willChange = "translate, rotate";
        return {
          el: node, rect: chunk.rect, saved: saved,
          base: parseTranslate(style.translate),
          baseRotate: parseFloat(style.rotate) || 0,
          x: 0, y: 0, a: 0,
          vx: rand(-70, 70), vy: rand(-170, -20), va: rand(-45, 45),
          delay: rand(0, 0.42) + (index % 5) * 0.03,
          landed: false
        };
      });
      fx.onEnd(function () {
        pieces.forEach(function (piece) {
          piece.el.style.translate = piece.saved.translate;
          piece.el.style.rotate = piece.saved.rotate;
          piece.el.style.transition = piece.saved.transition;
          piece.el.style.willChange = piece.saved.willChange;
        });
      });

      toast("GRAVITY: ENABLED. SIR ISAAC WOULD BE PROUD.");
      sfx("whoosh");
      let t = 0;
      let phase = "fall";
      let returnAt = 0;
      fx.loop(function (dt) {
        t += dt;
        const scrollDelta = window.scrollY - startScroll;
        let settled = true;
        pieces.forEach(function (piece) {
          if (phase === "fall") {
            if (t < piece.delay) return;
            piece.vy += 2600 * dt;
            piece.x += piece.vx * dt;
            piece.y += piece.vy * dt;
            piece.a = clamp(piece.a + piece.va * dt, -38, 38);
            const floor = Math.max(vh - piece.rect.bottom, 0) + scrollDelta;
            if (piece.y >= floor) {
              piece.y = floor;
              if (!piece.landed || piece.vy > 500) sfx("thud");
              piece.landed = true;
              piece.vy = piece.vy > 140 ? -piece.vy * 0.28 : 0;
              piece.vx *= 0.7;
              piece.va *= 0.5;
            }
            const minX = -piece.rect.left;
            const maxX = vw - piece.rect.right;
            if (piece.x < minX) { piece.x = minX; piece.vx = Math.abs(piece.vx) * 0.5; }
            else if (piece.x > maxX) { piece.x = maxX; piece.vx = -Math.abs(piece.vx) * 0.5; }
          } else {
            piece.vx += (-120 * piece.x - 14 * piece.vx) * dt;
            piece.vy += (-120 * piece.y - 14 * piece.vy) * dt;
            piece.va += (-120 * piece.a - 14 * piece.va) * dt;
            piece.x += piece.vx * dt;
            piece.y += piece.vy * dt;
            piece.a += piece.va * dt;
            if (Math.abs(piece.x) + Math.abs(piece.y) + Math.abs(piece.a) > 0.8 ||
              Math.abs(piece.vx) + Math.abs(piece.vy) > 5) settled = false;
          }
          piece.el.style.translate = (piece.base.x + piece.x).toFixed(2) + "px " + (piece.base.y + piece.y).toFixed(2) + "px";
          piece.el.style.rotate = (piece.baseRotate + piece.a).toFixed(2) + "deg";
        });
        if (phase === "fall" && t > 2.7) {
          phase = "return";
          returnAt = t;
          sfx("powerup");
          pieces.forEach(function (piece) { piece.vx = 0; piece.vy = 0; piece.va = 0; });
        } else if (phase === "return" && ((settled && t - returnAt > 0.3) || t - returnAt > 2.6)) {
          fx.end();
          return false;
        }
        return true;
      });
    });
  }

  function animateMain(name, keyframes, timing, message, reducedMessage) {
    const main = doc.getElementById("main-content") || doc.querySelector("main");
    if (reduceMotion || !main || typeof main.animate !== "function") {
      toast(reducedMessage || message);
      return;
    }
    effect(name, function (fx) {
      const rect = main.getBoundingClientRect();
      const savedOrigin = main.style.transformOrigin;
      main.style.transformOrigin = (window.innerWidth / 2 - rect.left) + "px " + (window.innerHeight / 2 - rect.top) + "px";
      const animation = main.animate(keyframes, timing);
      fx.onEnd(function () {
        animation.cancel();
        main.style.transformOrigin = savedOrigin;
      });
      animation.onfinish = function () { fx.end(); };
      toast(message);
    });
  }

  function barrelRoll() {
    sfx("whoosh");
    animateMain("barrel", [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 1250, easing: "cubic-bezier(0.65, 0, 0.35, 1)" },
      "DO A BARREL ROLL!", "BARREL ROLL DECLINED: REDUCED MOTION IS ON. (IMAGINE IT. VERY IMPRESSIVE.)");
  }

  function busy() {
    if (!active) return false;
    say("JB//OS IS BUSY WITH ANOTHER EFFECT. ONE AT A TIME!", "egg-dim");
    return true;
  }

  // PARTY: about 26 seconds of after-hours with a real track. sound.js synthesises the music live
  // (a build, a silent eighth, the drop, an outro) and everything on screen follows the audio clock:
  // the room dims and the disco ball lowers through the build, then the drop brings the lasers, the
  // beams, the banner and the confetti, and every kick pulses the lights. Pulses stay at the tempo
  // (about two a second), well under strobe territory. Typing `party` is the opt-in, so the music
  // plays even though the site's sound toggle is off. Esc, a click, hiding the tab or leaving the
  // page stops the music on the spot. Reduced motion keeps the music and a still, dimmed room.
  const PARTY_PLAN = { bpm: 128, dropBeat: 16, endBeat: 48, lengthBeats: 56 };
  const PARTY_BANNER = "NOW PLAYING ✱ JB//OS — AFTER HOURS (EXTENDED MIX) ✱ 128 BPM ✱ LIVE FROM ITHACA, NY ✱ ";

  function party(music) {
    if (busy()) {
      if (music) music.stop();
      return;
    }
    if (reduceMotion && !music) {
      say("PARTY MODE (QUIET EDITION): PLEASE IMAGINE LASERS, A DISCO BALL AND A VERY GOOD DJ.");
      return;
    }
    closeTerminal();
    const started = effect("party", function (fx) {
      const plan = music && music.plan ? music.plan : PARTY_PLAN;
      const beat = 60 / plan.bpm;
      const dropAt = plan.dropBeat * beat;
      const outroAt = plan.endBeat * beat;
      const lengthAt = plan.lengthBeats * beat;

      const stage = make("div", "egg-club" + (reduceMotion ? " is-still" : ""));
      stage.appendChild(make("div", "egg-club__dim"));
      stage.appendChild(make("div", "egg-club__wash"));
      const lights = make("div", "egg-club__lights");
      for (let i = 0; i < 6; i += 1) lights.appendChild(make("i"));
      const ball = make("div", "egg-club__ball");
      ball.appendChild(make("span"));
      const banner = make("div", "egg-club__banner");
      const track = make("div", "egg-club__track");
      if (reduceMotion) track.appendChild(make("span", "", PARTY_BANNER.replace(/ ✱ $/, "")));
      else for (let i = 0; i < 4; i += 1) track.appendChild(make("span", "", PARTY_BANNER));
      banner.appendChild(track);
      const stop = make("p", "egg-club__stop", finePointer ? "♪ ESC TO STOP" : "♪ TAP TO STOP");
      // The stop hint rides just above the banner, whatever height the banner wraps to.
      const dock = make("div", "egg-club__dock");
      dock.appendChild(stop);
      dock.appendChild(banner);
      if (!reduceMotion) {
        stage.appendChild(lights);
        stage.appendChild(ball);
      }
      stage.appendChild(dock);
      stage.style.setProperty("--beat", (beat * 1000).toFixed(2) + "ms");
      host().appendChild(stage);

      let view = null;
      let field = null;
      if (!reduceMotion) {
        view = fxCanvas(fx, "egg-club__canvas");
        stage.insertBefore(view.canvas, ball);
        field = confettiField(view);
      }

      function onHidden() { if (doc.hidden) fx.end(); }
      doc.addEventListener("visibilitychange", onHidden);
      if (music) music.onstop = function () { if (!fx.ended) fx.end(); };
      fx.onEnd(function () {
        doc.removeEventListener("visibilitychange", onHidden);
        if (music) {
          music.onstop = null;
          music.stop();
        }
        stage.remove();
        body.classList.remove("egg-party");
        body.style.removeProperty("--egg-beat");
      });
      window.requestAnimationFrame(function () { stage.classList.add("is-visible"); });

      // The audio clock drives everything. Without audio (or if the browser never lets it start),
      // the same timeline runs on the page clock instead.
      let wallStart = clock() + 120;
      let last = -1;
      function musicTime() {
        if (music) {
          if (music.running()) return music.time();
          if (clock() - fx.startedAt < 1500) return Math.min(last, 0);
          music.onstop = null;
          music.stop();
          music = null;
          wallStart = clock() - Math.max(last, 0) * 1000;
        }
        return (clock() - wallStart) / 1000;
      }

      let flash = 0;
      const cues = [
        { at: dropAt, run: function () {
          stage.classList.add("is-dropped");
          if (reduceMotion) return;
          body.style.setProperty("--egg-beat", (beat * 1000).toFixed(2) + "ms");
          body.classList.add("egg-party");
          flash = 0.7;
          field.burst({ origin: "left", count: 120 });
          field.burst({ origin: "right", count: 120 });
        } },
        { at: outroAt, run: function () {
          stage.classList.add("is-outro");
          body.classList.remove("egg-party");
          if (reduceMotion) return;
          flash = 0.45;
          [0.2, 0.5, 0.8, 0.35, 0.65].forEach(function (x, i) {
            fx.after(i * beat * 1000 / 3, function () {
              field.burst({ origin: { x: view.w * x, y: view.h * (i < 3 ? 0.3 : 0.2) }, spread: Math.PI, count: 70, power: 620 });
            });
          });
        } },
        { at: lengthAt - 0.7, run: function () { stage.classList.remove("is-visible"); } },
        { at: lengthAt, run: function () { fx.end(); } }
      ];
      if (!reduceMotion) {
        // Confetti cannons every other bar of the drop, from both sides when the hook comes in.
        [2, 4, 6].forEach(function (bar) {
          cues.push({ at: dropAt + bar * 4 * beat, run: function () {
            if (bar === 4) {
              field.burst({ origin: "left", count: 80 });
              field.burst({ origin: "right", count: 80 });
            } else {
              field.burst({ origin: bar === 2 ? "right" : "left", count: 80 });
            }
          } });
        });
        cues.sort(function (a, b) { return a.at - b.at; });
      }
      let cue = 0;

      const palette = themePalette();
      let sweep = 0;

      // Lasers fan out from three points on the floor; they sweep with the bar and flare on the kick.
      function drawLasers(alpha, spread) {
        const ctx = view.ctx;
        const length = Math.hypot(view.w, view.h);
        const origins = [{ x: 0, dir: 1 }, { x: view.w, dir: -1 }, { x: view.w / 2, dir: 0 }];
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        origins.forEach(function (origin, o) {
          for (let k = 0; k < 4; k += 1) {
            const swing = Math.sin(sweep + o * 2.1 + k * 0.55);
            const lean = origin.dir === 0 ? (k - 1.5) * 0.28 * spread : origin.dir * (0.2 + 0.5 * k / 3) * spread;
            const angle = -Math.PI / 2 + lean + swing * 0.32 * spread;
            const x = origin.x + Math.cos(angle) * length;
            const y = view.h + Math.sin(angle) * length;
            ctx.strokeStyle = palette[(o * 2 + k) % palette.length];
            ctx.globalAlpha = alpha * 0.18;
            ctx.lineWidth = 9;
            ctx.beginPath();
            ctx.moveTo(origin.x, view.h + 2);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
        });
        ctx.restore();
      }

      fx.loop(function (dt) {
        const t = musicTime();
        last = t;
        while (cue < cues.length && t >= cues[cue].at) {
          cues[cue].run();
          cue += 1;
          if (fx.ended) return false;
        }
        if (reduceMotion) return true;

        // kick: 1 on every kick, decaying over the beat. build: 0 -> 1 across the build.
        let kick = 0;
        let dim;
        let wash;
        let beams = 0;
        let lasers;
        let spread;
        let speed;
        const build = clamp(t / dropAt, 0, 1);
        if (t < dropAt) {
          const beats = t / beat;
          if (beats >= 0 && beats < 8) kick = 0.5 * Math.exp(-5 * (beats % 1));
          const gap = t >= dropAt - beat / 2;
          dim = gap ? 0.86 : 0.12 + 0.5 * Math.pow(build, 1.3);
          wash = gap ? 0 : 0.04 + 0.18 * build + 0.12 * kick;
          lasers = gap ? 0 : 0.04 + 0.26 * build;
          spread = 0.35 + 0.5 * build;
          speed = 0.6 + 3.4 * build * build;
        } else if (t < outroAt) {
          kick = Math.exp(-5 * (((t - dropAt) / beat) % 1));
          dim = 0.5 - 0.18 * kick;
          wash = 0.2 + 0.28 * kick;
          beams = 0.35 + 0.45 * kick;
          lasers = 0.32 + 0.5 * kick;
          spread = 1;
          speed = Math.PI * 2 / (beat * 4);
        } else {
          const fade = clamp(1 - (t - outroAt) / (beat * 4), 0, 1);
          kick = Math.exp(-2 * (t - outroAt) / beat);
          dim = 0.3 + 0.2 * fade;
          wash = 0.12 * fade + 0.2 * kick;
          beams = 0.5 * fade * fade;
          lasers = 0.5 * fade * fade;
          spread = 1;
          speed = 1.5;
        }
        sweep += speed * dt;
        stage.style.setProperty("--kick", kick.toFixed(3));
        stage.style.setProperty("--dim", dim.toFixed(3));
        stage.style.setProperty("--wash", wash.toFixed(3));
        stage.style.setProperty("--beams", beams.toFixed(3));
        stage.style.setProperty("--build", (build * build * (3 - 2 * build)).toFixed(3));

        const ctx = view.ctx;
        ctx.clearRect(0, 0, view.w, view.h);
        if (lasers > 0.01) drawLasers(lasers, spread);
        field.step(dt);
        field.draw(true);
        if (flash > 0.01) {
          ctx.globalAlpha = flash;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, view.w, view.h);
          ctx.globalAlpha = 1;
          flash *= Math.exp(-dt * 7);
        }
        return true;
      });
    });
    if (!started && music) music.stop();
  }

  function wobble() {
    const lines = [
      "WHOA, EASY. THE PIXELS ARE GETTING DIZZY.",
      "SHAKING IT WON'T MAKE IT LOAD FASTER. (IT'S ALREADY LOADED.)",
      "JB//OS IS NOT A SNOW GLOBE.",
      "EARTHQUAKE DETECTED. MAGNITUDE: ENTHUSIASTIC."
    ];
    toast(pick(lines));
    if (reduceMotion) return;
    sfx("glitch");
    body.classList.remove("egg-wobble");
    void body.offsetWidth;
    body.classList.add("egg-wobble");
    window.setTimeout(function () { body.classList.remove("egg-wobble"); }, 800);
  }

  // Swallows the rest of the gesture that woke the screensaver (a held key's repeats and release, or
  // the click that follows a press), so waking never also opens the terminal or follows a link.
  // A fresh press afterwards goes through as normal.
  function swallowWakeGesture(key) {
    const types = key === null
      ? ["pointerup", "mouseup", "click", "auxclick", "dblclick", "contextmenu"]
      : ["keydown", "keypress", "keyup"];
    const ends = key === null ? ["click", "auxclick", "contextmenu"] : ["keyup"];
    let timer = 0;
    function release() {
      window.clearTimeout(timer);
      types.forEach(function (type) { window.removeEventListener(type, swallow, true); });
    }
    function swallow(event) {
      if (key !== null && (event.key !== key || (event.type === "keydown" && !event.repeat))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (ends.indexOf(event.type) >= 0) release();
    }
    types.forEach(function (type) { window.addEventListener(type, swallow, true); });
    timer = window.setTimeout(release, 1500);
  }

  function screensaver(manual) {
    if (active || (!manual && (dialogOpen() || doc.hidden))) return;
    closeTerminal();
    // Not skippable by the global Escape/click handlers: the screensaver handles its own wake-up.
    effect("saver", function (fx) {
      const layer = make("div", "egg-saver");
      const logo = make("div", "egg-saver__logo");
      logo.appendChild(make("strong", "", "JB//OS"));
      logo.appendChild(make("small", "", "PORTFOLIO.26"));
      const time = make("p", "egg-saver__clock");
      const hint = make("p", "egg-saver__hint", finePointer ? "Click the mouse or press any key" : "Tap the screen or press any key");
      const corner = make("p", "egg-saver__corner", "CORNER!");
      layer.appendChild(logo);
      layer.appendChild(time);
      layer.appendChild(hint);
      layer.appendChild(corner);
      host().appendChild(layer);
      window.requestAnimationFrame(function () { layer.classList.add("is-visible"); });

      const palette = themePalette();
      let colorIndex = 0;
      logo.style.setProperty("--saver-color", palette[0]);
      let x = rand(0, Math.max(window.innerWidth - logo.offsetWidth, 1));
      let y = rand(0, Math.max(window.innerHeight - logo.offsetHeight, 1));
      let vx = (Math.random() < 0.5 ? -1 : 1) * 150;
      let vy = (Math.random() < 0.5 ? -1 : 1) * 115;
      let lastHitX = -1;
      let lastHitY = -1;
      let elapsed = 0;
      let tick = 0;
      // Reduced motion: the logo rests in the middle and only the clock ticks.
      if (reduceMotion) { vx = 0; vy = 0; }

      function updateClock() {
        time.textContent = ithacaTime({ hour: "numeric", minute: "2-digit", second: "2-digit" }) + " · ITHACA, NY";
      }
      updateClock();

      fx.loop(function (dt) {
        elapsed += dt;
        const w = window.innerWidth;
        const h = window.innerHeight;
        const lw = logo.offsetWidth;
        const lh = logo.offsetHeight;
        if (reduceMotion) { x = (w - lw) / 2; y = (h - lh) / 2; }
        x += vx * dt;
        y += vy * dt;
        let hitX = false;
        let hitY = false;
        if (x <= 0) { x = 0; vx = Math.abs(vx); hitX = true; }
        else if (x + lw >= w) { x = Math.max(w - lw, 0); vx = -Math.abs(vx); hitX = true; }
        if (y <= 0) { y = 0; vy = Math.abs(vy); hitY = true; }
        else if (y + lh >= h) { y = Math.max(h - lh, 0); vy = -Math.abs(vy); hitY = true; }
        if (hitX) lastHitX = elapsed;
        if (hitY) lastHitY = elapsed;
        if (hitX || hitY) {
          colorIndex = (colorIndex + 1) % palette.length;
          logo.style.setProperty("--saver-color", palette[colorIndex]);
          if (lastHitX >= 0 && lastHitY >= 0 && Math.abs(lastHitX - lastHitY) < 0.1) {
            corner.classList.remove("is-visible");
            void corner.offsetWidth;
            corner.classList.add("is-visible");
            sfx("coin");
            lastHitX = -1;
            lastHitY = -1;
          }
        }
        logo.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";
        tick += dt;
        if (tick >= 1) { tick = 0; updateClock(); }
        return true;
      });

      // Any click, tap or key wakes it; moving the mouse or scrolling does not. The waking input is
      // swallowed (backtick must not also open the terminal, a click must not land on a link). Input
      // in the first moments is swallowed too, so the gesture that started it cannot end it.
      const armedAt = clock() + 450;
      const wakeEvents = ["pointerdown", "keydown"];
      function wake(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (clock() < armedAt || fx.ended) return;
        swallowWakeGesture(event.type === "keydown" ? event.key : null);
        fx.end();
      }
      wakeEvents.forEach(function (type) { window.addEventListener(type, wake, true); });
      fx.onEnd(function () {
        wakeEvents.forEach(function (type) { window.removeEventListener(type, wake, true); });
        layer.classList.remove("is-visible");
        window.setTimeout(function () { layer.remove(); settleHost(); }, 340);
        if (elapsed > 4) toast("WELCOME BACK. JB//OS KEPT YOUR SEAT WARM.");
      });
    }, { skippable: false });
  }

  /* ---------------------------------------------------------------------------------------------
   * Page-wide secrets
   * ------------------------------------------------------------------------------------------- */

  // Five quick clicks on the hero name.
  const scrambleTitle = doc.querySelector("h1[data-scramble]");
  if (scrambleTitle) {
    let nameClicks = 0;
    let lastNameClick = 0;
    scrambleTitle.addEventListener("click", function () {
      const now = clock();
      nameClicks = now - lastNameClick < 520 ? nameClicks + 1 : 1;
      lastNameClick = now;
      if (nameClicks >= 2 && nameClicks < 5) sfx("tick");
      if (nameClicks >= 5) {
        nameClicks = 0;
        if (!active) burstName(scrambleTitle);
      }
    });
  }

  // A shake, from the mouse or the phone itself. Either way it is rate-limited and skipped while an
  // effect runs or a dialog is open.
  let lastShake = -Infinity;
  function shakeDetected(now) {
    if (now - lastShake < 12000 || active || dialogOpen()) return;
    lastShake = now;
    wobble();
  }

  // Mouse: six quick direction reversals within a second.
  if (finePointer) {
    let lastX = null;
    let direction = 0;
    let travel = 0;
    let flips = [];
    window.addEventListener("pointermove", function (event) {
      if (event.pointerType && event.pointerType !== "mouse") return;
      if (lastX === null) { lastX = event.clientX; return; }
      const dx = event.clientX - lastX;
      lastX = event.clientX;
      if (Math.abs(dx) < 1) return;
      const next = dx > 0 ? 1 : -1;
      if (next === direction) { travel += Math.abs(dx); return; }
      const now = clock();
      if (travel > 45) flips.push(now);
      direction = next;
      travel = Math.abs(dx);
      flips = flips.filter(function (time) { return now - time < 1000; });
      if (flips.length >= 6) {
        flips = [];
        shakeDetected(now);
      }
    }, { passive: true });
  }

  // Phone: four hard jolts (linear acceleration above ~14 m/s², far beyond walking or scrolling)
  // within about a second. Android delivers motion events straight away; iOS only after the visitor
  // allows it from a gesture, which the hidden `shake` terminal command asks for. Readings never
  // leave the page.
  const motion = (function () {
    const Motion = window.DeviceMotionEvent;
    if (finePointer || typeof Motion !== "function") return null;
    const state = { armed: false, needsPermission: typeof Motion.requestPermission === "function", seen: false };
    let gravityEstimate = null;
    let jolts = [];
    let lastJolt = 0;
    function onMotion(event) {
      let x;
      let y;
      let z;
      const linear = event.acceleration;
      if (linear && typeof linear.x === "number") {
        x = linear.x; y = linear.y || 0; z = linear.z || 0;
      } else {
        // Older devices only report acceleration with gravity: strip it with a slow low-pass.
        const raw = event.accelerationIncludingGravity;
        if (!raw || typeof raw.x !== "number") return;
        if (!gravityEstimate) gravityEstimate = { x: raw.x, y: raw.y || 0, z: raw.z || 0 };
        gravityEstimate.x += (raw.x - gravityEstimate.x) * 0.2;
        gravityEstimate.y += ((raw.y || 0) - gravityEstimate.y) * 0.2;
        gravityEstimate.z += ((raw.z || 0) - gravityEstimate.z) * 0.2;
        x = raw.x - gravityEstimate.x; y = (raw.y || 0) - gravityEstimate.y; z = (raw.z || 0) - gravityEstimate.z;
      }
      state.seen = true;
      if (doc.hidden || Math.sqrt(x * x + y * y + z * z) < 14) return;
      const now = clock();
      if (now - lastJolt < 90) return;
      lastJolt = now;
      jolts = jolts.filter(function (time) { return now - time < 1100; });
      jolts.push(now);
      if (jolts.length >= 4) {
        jolts = [];
        shakeDetected(now);
      }
    }
    state.arm = function () {
      if (state.armed) return;
      state.armed = true;
      window.addEventListener("devicemotion", onMotion, { passive: true });
    };
    // Resolves true once motion events are flowing (or allowed to). Must be called from a gesture on iOS.
    state.request = function () {
      if (!state.needsPermission) {
        state.arm();
        return Promise.resolve(true);
      }
      let pending;
      try { pending = Motion.requestPermission(); } catch (error) { return Promise.resolve(false); }
      return Promise.resolve(pending).then(function (answer) {
        if (answer === "granted") state.arm();
        return answer === "granted";
      }, function () { return false; });
    };
    if (!state.needsPermission) state.arm();
    return state;
  })();

  // A minute of stillness starts the screensaver.
  const IDLE_MS = 60000;
  let lastActivity = clock();
  let idleNoticeShown = false;
  function markActivity() {
    lastActivity = clock();
    idleNoticeShown = false;
  }
  ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach(function (type) {
    window.addEventListener(type, markActivity, { capture: true, passive: true });
  });
  window.setInterval(function () {
    if (clock() - lastActivity < IDLE_MS) return;
    if (doc.hidden || active || snakeGame || dialogOpen() || body.classList.contains("nav-open")) return;
    const focused = doc.activeElement;
    if (isEditable(focused) || (focused && focused.tagName === "IFRAME") || mediaPlaying()) return;
    if (reduceMotion) {
      if (!idleNoticeShown) {
        idleNoticeShown = true;
        toast("STILL THERE? JB//OS IS HOLDING YOUR PLACE.");
      }
      return;
    }
    screensaver(false);
  }, 4000);

  // Little extras in the home hero (the markup stays untouched; behaviour is attached here).
  const heroSection = doc.querySelector(".home-hero");
  if (heroSection) {

    const hintKey = heroSection.querySelector(".terminal-hint kbd");
    if (hintKey) {
      hintKey.classList.add("egg-clickable");
      if (!hintKey.hasAttribute("data-cursor")) hintKey.setAttribute("data-cursor", "OPEN");
      hintKey.addEventListener("click", openTerminal);
    }

    // The orb charges up: hover it for a while with a mouse, or press and hold it on a touch screen.
    const orb = heroSection.querySelector(".chrome-orb");
    if (orb) {
      let chargeTimer = 0;
      let press = null;
      let swallowClickUntil = 0;
      const charge = function (byTouch) {
        toast(byTouch ? "THE ORB IS PLEASED. (TAP IT FOR THE TERMINAL.)" : "THE ORB IS PLEASED. (CLICK IT FOR THE TERMINAL.)");
        sfx("powerup");
        if (reduceMotion) return;
        orb.classList.add("egg-orb-charged");
        const rect = orb.getBoundingClientRect();
        sparkle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, { count: 46 });
        window.setTimeout(function () { orb.classList.remove("egg-orb-charged"); }, 2200);
      };
      const cancelPress = function () {
        window.clearTimeout(chargeTimer);
        press = null;
        orb.classList.remove("egg-orb-pressing");
      };

      if (finePointer) {
        orb.addEventListener("pointerenter", function (event) {
          if (event.pointerType && event.pointerType !== "mouse") return;
          window.clearTimeout(chargeTimer);
          chargeTimer = window.setTimeout(function () { charge(false); }, 2600);
        });
        orb.addEventListener("pointerleave", function (event) {
          if (!press) window.clearTimeout(chargeTimer);
          if (event.pointerType && event.pointerType !== "mouse") cancelPress();
        });
      }

      orb.addEventListener("pointerdown", function (event) {
        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
        cancelPress();
        const current = { id: event.pointerId, x: event.clientX, y: event.clientY, charged: false };
        press = current;
        orb.classList.add("egg-orb-pressing");
        chargeTimer = window.setTimeout(function () {
          if (press !== current) return;
          current.charged = true;
          orb.classList.remove("egg-orb-pressing");
          charge(true);
        }, 1100);
      });
      orb.addEventListener("pointermove", function (event) {
        if (press && !press.charged && event.pointerId === press.id &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) cancelPress();
      });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (type) {
        orb.addEventListener(type, function (event) {
          if (!press || event.pointerId !== press.id) return;
          // The finger lifting after a full charge should not also open the terminal.
          if (press.charged) swallowClickUntil = clock() + 600;
          cancelPress();
        });
      });
      orb.addEventListener("contextmenu", function (event) {
        if (press || clock() < swallowClickUntil) event.preventDefault();
      });
      // Capture on window runs before the orb's own "open the terminal" listener.
      window.addEventListener("click", function (event) {
        if (!event.target || !event.target.closest || event.target.closest(".chrome-orb") !== orb) return;
        if (clock() < swallowClickUntil) {
          swallowClickUntil = 0;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        cancelPress();
      }, true);
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * Terminal: async jobs, input modes, history, tab completion, did-you-mean
   * ------------------------------------------------------------------------------------------- */

  let job = null;

  function runJobCleanups(target) {
    while (target.cleanups.length) {
      try { target.cleanups.pop()(); } catch (error) { /* keep cleaning */ }
    }
  }

  // A job is a command that keeps printing after run() returns. Its promise settles when the output is
  // finished or the job is cancelled; run() returns it so site.js puts the command menu back after it.
  function startJob() {
    cancelJob();
    let settle = null;
    const current = {
      cancelled: false,
      timers: [],
      cleanups: [],
      promise: new Promise(function (resolve) { settle = resolve; }),
      after: function (ms, fn) {
        const id = window.setTimeout(function () { if (!current.cancelled) fn(); }, ms);
        current.timers.push(id);
      },
      onCancel: function (fn) { current.cleanups.push(fn); },
      done: function () {
        if (job === current) job = null;
        runJobCleanups(current);
        settle();
      }
    };
    current.onCancel(settle);
    job = current;
    return current;
  }

  function cancelJob() {
    if (!job) return;
    const current = job;
    job = null;
    current.cancelled = true;
    current.timers.forEach(window.clearTimeout);
    runJobCleanups(current);
  }

  // Input modes (vim, y/N prompts) take over the prompt before site.js sees the submit.
  let inputMode = null;
  function setInputMode(mode) {
    inputMode = mode || null;
    if (terminalLabel) terminalLabel.textContent = inputMode && inputMode.prompt ? inputMode.prompt : PROMPT;
  }
  if (terminalForm && terminalInput) {
    doc.addEventListener("submit", function (event) {
      if (!inputMode || event.target !== terminalForm) return;
      event.preventDefault();
      event.stopPropagation();
      const raw = terminalInput.value.trim();
      terminalInput.value = "";
      const mode = inputMode;
      try { mode.handle(raw); } catch (error) { setInputMode(null); }
    }, true);
  }

  function commandNames(includeHidden) {
    const names = BUILTINS.slice();
    Object.keys(JBOS.commands || {}).forEach(function (name) {
      if (includeHidden || !JBOS.commands[name].hidden) names.push(name);
    });
    return Array.from(new Set(names)).sort();
  }

  function isKnownCommand(name) {
    return Boolean(BUILTINS.indexOf(name) >= 0 ||
      (JBOS.commands && JBOS.commands[name]) || (JBOS.aliases && JBOS.aliases[name]));
  }

  function suggestCommand(word) {
    let best = null;
    let bestScore = Infinity;
    commandNames(false).forEach(function (name) {
      const score = editDistance(word, name);
      if (score < bestScore) { bestScore = score; best = name; }
    });
    return bestScore <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
  }

  const HISTORY_KEY = "jb-term-history";
  let history = [];
  try {
    const stored = JSON.parse(readStore(HISTORY_KEY, true) || "[]");
    if (Array.isArray(stored)) history = stored.filter(function (item) { return typeof item === "string"; }).slice(-60);
  } catch (error) { history = []; }
  let historyIndex = history.length;
  let historyDraft = "";

  function remember(raw) {
    if (!raw) return;
    if (history[history.length - 1] !== raw) history.push(raw);
    if (history.length > 60) history = history.slice(-60);
    historyIndex = history.length;
    historyDraft = "";
    writeStore(HISTORY_KEY, JSON.stringify(history), true);
  }

  function setInputValue(value) {
    if (!terminalInput) return;
    terminalInput.value = value;
    try { terminalInput.setSelectionRange(value.length, value.length); } catch (error) { /* unsupported input type */ }
  }

  function commonPrefix(list) {
    if (!list.length) return "";
    let prefix = list[0];
    list.forEach(function (item) {
      while (item.indexOf(prefix) !== 0) prefix = prefix.slice(0, -1);
    });
    return prefix;
  }

  // Tab completes command names; it only swallows Tab when it actually did something,
  // so keyboard users can still tab out of the prompt.
  function complete() {
    const value = terminalInput.value;
    if (!value.trim()) return false;
    const parts = value.replace(/^\s+/, "").split(/\s+/);
    if (parts.length === 1) {
      const prefix = parts[0].toLowerCase();
      const matches = commandNames(false).filter(function (name) { return name.indexOf(prefix) === 0; });
      if (!matches.length) return false;
      if (matches.length === 1) {
        if (matches[0] === prefix) return false;
        setInputValue(matches[0] + " ");
        return true;
      }
      const shared = commonPrefix(matches);
      if (shared.length > prefix.length) setInputValue(shared);
      else print(matches.join("   "), "egg-dim");
      return true;
    }
    return false;
  }

  if (terminalInput && !JBOS.terminalExtras) {
    JBOS.terminalExtras = "eggs";
    terminalInput.addEventListener("keydown", function (event) {
      if (event.defaultPrevented || snakeGame || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return;
      if (event.key === "ArrowUp") {
        if (!history.length) return;
        event.preventDefault();
        if (historyIndex === history.length) historyDraft = terminalInput.value;
        historyIndex = Math.max(0, historyIndex - 1);
        setInputValue(history[historyIndex]);
      } else if (event.key === "ArrowDown") {
        if (historyIndex >= history.length) return;
        event.preventDefault();
        historyIndex += 1;
        setInputValue(historyIndex === history.length ? historyDraft : history[historyIndex]);
      } else if (event.key === "Tab" && !event.shiftKey) {
        if (complete()) event.preventDefault();
      }
    });
  }

  if (typeof JBOS.on === "function") {
    JBOS.on("terminal-command", function (detail) {
      if (!detail) return;
      cancelJob();
      remember(detail.raw);
      const command = detail.command;
      if (command !== "help" && !isKnownCommand(command)) {
        window.setTimeout(function () {
          const suggestion = suggestCommand(command);
          if (suggestion) print("Did you mean `" + suggestion + "`?", "egg-dim");
        }, 0);
      }
    });
  }

  if (terminalEl) {
    terminalEl.addEventListener("close", function () {
      cancelJob();
      if (inputMode) {
        const mode = inputMode;
        setInputMode(null);
        if (mode.onClose) mode.onClose();
      }
      if (snakeGame) stopSnake(true);
      terminalEl.classList.remove("egg-hacking");
    });
  }

  /* ---------------------------------------------------------------------------------------------
   * Terminal commands
   * ------------------------------------------------------------------------------------------- */

  function register(name, spec) {
    if (typeof JBOS.registerCommand !== "function") return;
    const taken = function (candidate) {
      return Boolean((JBOS.commands && JBOS.commands[candidate]) || (JBOS.aliases && JBOS.aliases[candidate]) ||
        BUILTINS.indexOf(candidate) >= 0);
    };
    // Never clobber a command another module already registered.
    if (taken(name)) return;
    spec.aliases = (spec.aliases || []).filter(function (alias) { return !taken(alias); });
    JBOS.registerCommand(name, spec);
  }

  // Runs fn once the terminal has fully closed (its close handlers have released the page).
  function afterTerminalCloses(fn) {
    if (!terminalOpen()) { fn(); return; }
    terminalEl.addEventListener("close", function () { window.setTimeout(fn, 0); }, { once: true });
    closeTerminal();
  }

  // Page effects launched from the terminal: it closes first so the effect plays on the page itself.
  function pageEffectCommand(name, spec) {
    register(name, {
      hidden: Boolean(spec.hidden),
      aliases: spec.aliases || [],
      help: spec.help,
      run: function () {
        if (active) { print(name + ": another effect is running. Try again in a sec."); return; }
        print(spec.line, "egg-ok");
        window.setTimeout(function () {
          if (!active) afterTerminalCloses(spec.run);
        }, 340);
      }
    });
  }

  pageEffectCommand("gravity", { help: "gravity: turn on physics and watch the page fall", line: "Enabling gravity. Hold on to something.", aliases: ["newton"], run: gravity });
  pageEffectCommand("barrel", { help: "barrel: do a barrel roll", line: "Do a barrel roll!", aliases: ["barrelroll", "roll"], run: barrelRoll });

  register("do", {
    hidden: true,
    help: "do <something>: e.g. do a barrel roll",
    run: function (args) {
      const request = args.join(" ").toLowerCase();
      if (/barrel\s*roll/.test(request) && JBOS.commands.barrel) { JBOS.commands.barrel.run([], "barrel"); return; }
      print(request ? "do: I would, but I don't know how to " + request.slice(0, 40) + "." : "do: do what? (There is one famous thing to do.)");
    }
  });

  register("shake", {
    hidden: true,
    help: "shake: shake things up (phones: switches on the motion sensor)",
    run: function () {
      if (finePointer) {
        print("shake: shake your mouse, not your monitor. Side to side, fast, like it owes you money.");
        return;
      }
      const current = startJob();
      const shakeForThem = function (reason) {
        print("shake: " + reason + ", so JB//OS will do the shaking.", "egg-ok");
        current.after(340, function () {
          current.done();
          afterTerminalCloses(function () {
            lastShake = clock();
            wobble();
          });
        });
      };
      if (!motion) { shakeForThem("no motion sensor here"); return current.promise; }
      print("shake: checking the motion sensor…", "egg-dim");
      // iOS shows its own "allow motion" prompt here; this command is the only thing that asks.
      motion.request().then(function (allowed) {
        if (current.cancelled) return;
        if (!allowed) { shakeForThem("no motion access"); return; }
        current.after(700, function () {
          if (!motion.seen) { shakeForThem("the motion sensor is quiet"); return; }
          print("shake: sensor ready. Close the terminal and shake your phone like it owes you money.", "egg-ok");
          current.done();
        });
      });
      return current.promise;
    }
  });

  register("screensaver", {
    aliases: ["zzz", "afk"],
    help: "screensaver: start it now",
    run: function () {
      print("Starting screensaver…", "egg-ok");
      window.setTimeout(function () { screensaver(true); }, 300);
    }
  });

  register("party", {
    aliases: ["disco", "rave"],
    help: "party: 26 seconds of after-hours, with music (sound on, Esc to stop)",
    run: function () {
      if (active) { print("party: the last party is still going."); return; }
      const sound = JBOS.sound || {};
      // Wake the audio up inside this keypress or click; browsers only allow it from a gesture.
      const audible = typeof sound.warm === "function" && typeof sound.party === "function" && sound.warm();
      print(audible ? "Cueing the track. Sound on, Esc to stop." : "Cueing the lights. (No audio in this browser.)", "egg-ok");
      window.setTimeout(function () {
        let music = null;
        try { music = audible ? sound.party() : null; } catch (error) { music = null; }
        party(music);
      }, 300);
    }
  });

  register("hack", {
    aliases: ["hacker", "hax"],
    help: "hack: hollywood mode",
    run: function () {
      const current = startJob();
      if (terminalEl) terminalEl.classList.add("egg-hacking");
      current.onCancel(function () { if (terminalEl) terminalEl.classList.remove("egg-hacking"); });
      const hex = function (length) {
        let out = "";
        for (let i = 0; i < length; i += 1) out += "0123456789abcdef".charAt(randInt(0, 15));
        return out;
      };
      const ip = function () { return randInt(10, 223) + "." + randInt(0, 255) + "." + randInt(0, 255) + "." + randInt(1, 254); };
      const templates = [
        function () { return "ssh root@" + ip() + " -p " + randInt(1024, 65535); },
        function () { return "Bypassing firewall on port " + pick([22, 80, 443, 1337, 8080]) + "… OK"; },
        function () { return "0x" + hex(8) + "  " + hex(2) + " " + hex(2) + " " + hex(2) + " " + hex(2) + " " + hex(2) + " " + hex(2) + " " + hex(2) + " " + hex(2) + "  |JB//OS..|"; },
        function () { return "Decrypting RSA-4096 key… " + textBar(randInt(20, 100), 14); },
        function () { return "Injecting coffee into mainframe… " + pick(["done", "OK", "caffeinated"]); },
        function () { return "Downloading more RAM… " + randInt(8, 128) + " GB"; },
        function () { return "Rerouting through Ithaca proxy " + ip() + "… OK"; },
        function () { return "Compiling kernel with -O" + pick(["3", "fast", "∞"]); },
        function () { return "Tracing packets: " + ip() + " → " + ip() + " → " + ip(); },
        function () { return "Enhancing image… enhance… ENHANCE"; },
        function () { return "SELECT * FROM side_projects WHERE finished = TRUE;  -- 0 rows"; },
        function () { return "Brute-forcing password: " + hex(randInt(4, 10)) + "… no"; },
        function () { return "Uploading virus.exe… just kidding, it's a résumé"; },
        function () { return "sudo chmod 777 /dev/motivation"; },
        function () { return "git push --force origin main  # yolo"; }
      ];
      print("Initiating hack sequence…", "egg-warn");
      const total = 46;
      for (let i = 0; i < total; i += 1) {
        current.after(120 + i * 58, function () {
          print(pick(templates)(), "egg-hack");
          sfx("type");
        });
      }
      current.after(120 + total * 58 + 180, function () {
        print("ACCESS GRANTED", "egg-banner");
        sfx("success");
      });
      current.after(120 + total * 58 + 900, function () {
        print("Relax: nothing was hacked. It's a portfolio.", "egg-dim");
      });
      current.after(120 + total * 58 + 1900, function () {
        print("You now have root on a static site. You can read everything you could already read.");
      });
      current.after(120 + total * 58 + 3000, function () {
        print("Incident reported to the security team. (Also Jake. He's not worried.)", "egg-dim");
        current.done();
      });
      return current.promise;
    }
  });

  register("snake", {
    help: "snake: the classic, in your terminal",
    run: function () { return startSnake(); }
  });

  /* ---------------------------------------------------------------------------------------------
   * Snake, drawn on a canvas inside the terminal output
   * ------------------------------------------------------------------------------------------- */

  let snakeGame = null;

  function stopSnake(silent, handOff) {
    const game = snakeGame;
    if (!game) return;
    snakeGame = null;
    game.settle();
    window.cancelAnimationFrame(game.raf);
    window.removeEventListener("keydown", game.onKey, true);
    game.detach();
    game.wrap.classList.add("is-ended");
    game.status.textContent = "EXITED · SCORE " + game.score + " · BEST " + game.best;
    if (!silent) print("snake: exited · score " + game.score + " · best " + game.best, "egg-dim");
    if ((handOff || !silent) && terminalInput && terminalOpen()) terminalInput.focus({ preventScroll: true });
  }

  function startSnake() {
    if (!terminalOutput || !terminalEl) return;
    openTerminal();
    if (snakeGame) stopSnake(true);

    const COLS = 21;
    const ROWS = 13;
    const DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const wrap = make("div", "egg-snake");
    wrap.tabIndex = -1;
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Snake game");
    const hud = make("p", "egg-snake__hud");
    const canvas = make("canvas", "egg-snake__board");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Snake board. Arrow keys or WASD steer, P pauses, Q or Escape quits.");
    const pad = make("div", "egg-snake__pad");
    [["up", "↑"], ["left", "←"], ["down", "↓"], ["right", "→"]].forEach(function (entry) {
      const button = make("button", "egg-snake__key egg-snake__key--" + entry[0], entry[1]);
      button.type = "button";
      button.dataset.dir = entry[0];
      button.setAttribute("aria-label", "Steer " + entry[0]);
      pad.appendChild(button);
    });
    const pauseButton = make("button", "egg-snake__key egg-snake__key--pause", "PAUSE");
    pauseButton.type = "button";
    pauseButton.dataset.action = "pause";
    const quitButton = make("button", "egg-snake__key egg-snake__key--quit", "QUIT");
    quitButton.type = "button";
    quitButton.dataset.action = "quit";
    pad.appendChild(pauseButton);
    pad.appendChild(quitButton);
    const status = make("p", "egg-snake__status");
    status.setAttribute("aria-live", "polite");
    wrap.appendChild(hud);
    wrap.appendChild(canvas);
    wrap.appendChild(pad);
    wrap.appendChild(status);
    appendToTerminal(wrap);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      wrap.remove();
      print("snake: no canvas support here. The snake escaped.");
      return;
    }
    const available = clamp(terminalOutput.clientWidth - 34, 168, 546);
    const cell = Math.max(8, Math.floor(available / COLS));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = COLS * cell * dpr;
    canvas.height = ROWS * cell * dpr;
    canvas.style.width = COLS * cell + "px";
    ctx.scale(dpr, dpr);

    const styles = window.getComputedStyle(terminalEl);
    const colors = {
      bg: styles.backgroundColor || "#111528",
      snake: styles.getPropertyValue("--acid").trim() || "#d9ff43",
      food: styles.getPropertyValue("--magenta").trim() || "#ff58c8",
      bonus: styles.getPropertyValue("--orange").trim() || "#ff6740",
      text: styles.getPropertyValue("--paper").trim() || "#f7f5ee",
      grid: "rgba(247, 245, 238, 0.1)"
    };
    const mono = cssVar("--font-mono", "monospace");

    const game = {
      wrap: wrap, status: status, raf: 0, last: 0, acc: 0, time: 0,
      mode: "ready", snake: [], dir: DIRS.right, queue: [], food: null, bonus: null,
      score: 0, eaten: 0, interval: 0.14, newBest: false,
      best: Number(readStore("jb-snake-best")) || 0,
      onKey: null, detach: function () {}, settle: function () {}
    };
    // Settles when the game exits, so the command menu lands under the board, not over it.
    const finished = new Promise(function (resolve) { game.settle = resolve; });
    snakeGame = game;

    function occupied(x, y) {
      return game.snake.some(function (part) { return part.x === x && part.y === y; }) ||
        (game.food && game.food.x === x && game.food.y === y) ||
        (game.bonus && game.bonus.x === x && game.bonus.y === y);
    }

    function freeCell() {
      for (let tries = 0; tries < 200; tries += 1) {
        const x = randInt(0, COLS - 1);
        const y = randInt(0, ROWS - 1);
        if (!occupied(x, y)) return { x: x, y: y };
      }
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) if (!occupied(x, y)) return { x: x, y: y };
      }
      return null;
    }

    function updateHud() {
      hud.textContent = "SCORE " + game.score + " · BEST " + Math.max(game.best, game.score) + " · ARROWS/WASD · P PAUSE · Q QUIT";
    }

    function reset() {
      game.snake = [{ x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }];
      game.dir = DIRS.right;
      game.queue = [];
      game.food = null;
      game.bonus = null;
      game.food = freeCell();
      game.score = 0;
      game.eaten = 0;
      game.interval = 0.14;
      game.acc = 0;
      game.newBest = false;
      game.mode = "ready";
      status.textContent = "PRESS AN ARROW KEY (OR SWIPE) TO START";
      updateHud();
    }

    function turn(name) {
      const next = DIRS[name];
      if (!next) return;
      if (game.mode === "over") return;
      if (game.mode === "ready") {
        game.mode = "playing";
        status.textContent = "GO!";
        sfx("powerup");
      } else if (game.mode === "paused") {
        game.mode = "playing";
        status.textContent = "";
      }
      const lastDir = game.queue.length ? game.queue[game.queue.length - 1] : game.dir;
      if (next.x === -lastDir.x && next.y === -lastDir.y) return;
      if (next.x === lastDir.x && next.y === lastDir.y) return;
      if (game.queue.length < 3) game.queue.push(next);
    }

    function togglePause() {
      if (game.mode === "playing") {
        game.mode = "paused";
        status.textContent = "PAUSED · P TO RESUME";
      } else if (game.mode === "paused") {
        game.mode = "playing";
        status.textContent = "";
      }
    }

    function gameOver() {
      game.mode = "over";
      sfx("gameover");
      if (game.score > game.best) {
        game.best = game.score;
        game.newBest = true;
        writeStore("jb-snake-best", String(game.best));
      }
      status.textContent = "GAME OVER · SCORE " + game.score + (game.newBest ? " · NEW BEST!" : "") +
        " · ENTER TO PLAY AGAIN · Q TO QUIT (OR JUST TYPE A COMMAND)";
      updateHud();
    }

    function step() {
      if (game.queue.length) game.dir = game.queue.shift();
      const head = game.snake[0];
      const next = { x: head.x + game.dir.x, y: head.y + game.dir.y };
      const eating = game.food && next.x === game.food.x && next.y === game.food.y;
      const solid = eating ? game.snake : game.snake.slice(0, -1);
      if (next.x < 0 || next.y < 0 || next.x >= COLS || next.y >= ROWS ||
        solid.some(function (part) { return part.x === next.x && part.y === next.y; })) {
        gameOver();
        return;
      }
      game.snake.unshift(next);
      if (eating) {
        game.score += 1;
        game.eaten += 1;
        game.interval = Math.max(0.065, game.interval - 0.0045);
        sfx("coin");
        game.food = freeCell();
        if (game.eaten % 5 === 0 && !game.bonus) {
          const spot = freeCell();
          if (spot) game.bonus = { x: spot.x, y: spot.y, life: 6 };
        }
      } else {
        game.snake.pop();
      }
      if (game.bonus && next.x === game.bonus.x && next.y === game.bonus.y) {
        game.score += 5;
        game.bonus = null;
        sfx("success");
        status.textContent = "+5 BONUS!";
      }
      if (!game.food) gameOver();
      updateHud();
    }

    function draw() {
      const c = cell;
      const width = COLS * c;
      const height = ROWS * c;
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = colors.grid;
      for (let x = 0; x < COLS; x += 1) {
        for (let y = 0; y < ROWS; y += 1) ctx.fillRect(x * c + c / 2 - 0.75, y * c + c / 2 - 0.75, 1.5, 1.5);
      }
      if (game.food) {
        const size = c * (0.7 + Math.sin(game.time * 7) * 0.1);
        ctx.fillStyle = colors.food;
        ctx.fillRect(game.food.x * c + (c - size) / 2, game.food.y * c + (c - size) / 2, size, size);
      }
      if (game.bonus && (game.bonus.life > 1.5 || Math.floor(game.time * 8) % 2)) {
        const cx = game.bonus.x * c + c / 2;
        const cy = game.bonus.y * c + c / 2;
        const r = c * 0.46;
        ctx.fillStyle = colors.bonus;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        ctx.fill();
      }
      game.snake.forEach(function (part, index) {
        const inset = index === 0 ? 1 : 2;
        ctx.globalAlpha = index === 0 ? 1 : Math.max(0.45, 1 - index / (game.snake.length + 8));
        ctx.fillStyle = colors.snake;
        ctx.fillRect(part.x * c + inset, part.y * c + inset, c - inset * 2, c - inset * 2);
      });
      ctx.globalAlpha = 1;
      const head = game.snake[0];
      if (head) {
        const eye = Math.max(2, Math.round(c * 0.16));
        const cx = head.x * c + c / 2;
        const cy = head.y * c + c / 2;
        const forward = c * 0.18;
        const side = c * 0.2;
        ctx.fillStyle = colors.bg;
        [1, -1].forEach(function (sign) {
          const ex = cx + game.dir.x * forward - game.dir.y * side * sign;
          const ey = cy + game.dir.y * forward + game.dir.x * side * sign;
          ctx.fillRect(ex - eye / 2, ey - eye / 2, eye, eye);
        });
      }
      if (game.mode !== "playing") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = colors.text;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "800 " + Math.max(12, Math.round(c * 0.95)) + "px " + mono;
        const label = game.mode === "ready" ? "PRESS ← ↑ → ↓" : (game.mode === "paused" ? "PAUSED" : "GAME OVER");
        ctx.fillText(label, width / 2, height / 2 - (game.mode === "over" ? c * 0.7 : 0));
        if (game.mode === "over") {
          ctx.font = "600 " + Math.max(10, Math.round(c * 0.62)) + "px " + mono;
          ctx.fillText("SCORE " + game.score + (game.newBest ? " · NEW BEST" : "") + " · ENTER = RETRY", width / 2, height / 2 + c * 0.6);
        }
      }
    }

    function frame(time) {
      if (snakeGame !== game) return;
      if (!wrap.isConnected || !terminalOpen()) {
        stopSnake(true);
        return;
      }
      const dt = game.last ? Math.min((time - game.last) / 1000, 0.1) : 0;
      game.last = time;
      game.time += dt;
      if (game.mode === "playing") {
        game.acc += dt;
        while (game.acc >= game.interval && game.mode === "playing") {
          game.acc -= game.interval;
          step();
        }
        if (game.bonus) {
          game.bonus.life -= dt;
          if (game.bonus.life <= 0) game.bonus = null;
        }
      }
      draw();
      game.raf = window.requestAnimationFrame(frame);
    }

    function swallow(event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const KEYMAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
    game.onKey = function (event) {
      if (snakeGame !== game || !terminalOpen()) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const key = event.key || "";
      const lower = key.length === 1 ? key.toLowerCase() : key;
      const dir = KEYMAP[lower];
      if (game.mode === "over") {
        if (key === "Enter" || lower === "r" || key === " ") { swallow(event); reset(); return; }
        if (key === "Escape" || lower === "q") { swallow(event); stopSnake(); return; }
        if (dir && key.indexOf("Arrow") === 0) { swallow(event); return; }
        if (key.length === 1 || key === "Backspace") {
          // Hand the keyboard straight back to the prompt so this key lands there.
          stopSnake(true, true);
        }
        return;
      }
      if (dir) { swallow(event); turn(dir); return; }
      if (key === "Escape" || lower === "q") { swallow(event); stopSnake(); return; }
      if (lower === "p" || key === " ") { swallow(event); togglePause(); return; }
      if (key === "Enter" || key.length === 1 || key === "Backspace") swallow(event);
    };
    window.addEventListener("keydown", game.onKey, true);

    function handlePad(button) {
      if (button.dataset.dir) {
        if (game.mode === "over") reset();
        turn(button.dataset.dir);
      } else if (button.dataset.action === "pause") {
        togglePause();
      } else if (button.dataset.action === "quit") {
        stopSnake();
      }
    }
    function onPadPointer(event) {
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      handlePad(button);
    }
    function onPadClick(event) {
      if (event.detail !== 0) return;
      const button = event.target.closest("button");
      if (button) handlePad(button);
    }
    let swipe = null;
    function onBoardDown(event) { swipe = { x: event.clientX, y: event.clientY }; }
    function onBoardUp(event) {
      if (!swipe) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      swipe = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) {
        if (game.mode === "over") reset();
        return;
      }
      if (game.mode === "over") reset();
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    }
    pad.addEventListener("pointerdown", onPadPointer);
    pad.addEventListener("click", onPadClick);
    canvas.addEventListener("pointerdown", onBoardDown);
    canvas.addEventListener("pointerup", onBoardUp);
    game.detach = function () {
      pad.removeEventListener("pointerdown", onPadPointer);
      pad.removeEventListener("click", onPadClick);
      canvas.removeEventListener("pointerdown", onBoardDown);
      canvas.removeEventListener("pointerup", onBoardUp);
      pad.remove();
    };

    reset();
    draw();
    wrap.focus({ preventScroll: true });
    scrollTerminal();
    game.raf = window.requestAnimationFrame(frame);
    return finished;
  }

  /* ---------------------------------------------------------------------------------------------
   * 404: path readout, did-you-mean, a retry button that never works, and a runaway page to catch
   * ------------------------------------------------------------------------------------------- */

  function init404() {
    const page = doc.querySelector("[data-egg-404]");
    if (!page) return;

    let path = window.location.pathname;
    try { path = decodeURIComponent(path); } catch (error) { /* keep the raw path */ }
    if (path.length > 64) path = path.slice(0, 61) + "…";
    page.querySelectorAll("[data-egg-404-path]").forEach(function (node) { node.textContent = path; });

    const suggestion = page.querySelector("[data-egg-404-suggest]");
    if (suggestion) {
      const pages = [
        ["/", ["home", "index"]], ["/code/", ["code", "projects", "coding"]], ["/creative/", ["creative", "music", "novel", "book"]],
        ["/business/", ["business", "startup", "throttle"]], ["/portfolio/", ["portfolio", "photo", "photos", "lens"]],
        ["/the-move/", ["the-move", "themove", "move"]]
      ];
      const slug = path.toLowerCase().replace(/\.html?$/, "").split("/").filter(Boolean)[0] || "";
      const clean = slug.replace(/[^a-z-]/g, "");
      let best = null;
      let bestScore = Infinity;
      pages.forEach(function (candidate) {
        candidate[1].forEach(function (name) {
          const score = editDistance(clean, name);
          if (score < bestScore) { bestScore = score; best = candidate[0]; }
        });
      });
      const link = suggestion.querySelector("a");
      if (clean && link && best && bestScore <= Math.max(2, Math.floor(clean.length / 2))) {
        link.href = best;
        link.textContent = best;
        suggestion.hidden = false;
      }
    }

    const crash = page.querySelector("[data-egg-404-window]");
    const retry = page.querySelector("[data-egg-404-retry]");
    const retryStatus = page.querySelector("[data-egg-404-retry-status]");
    if (retry) {
      const lines = [
        "Retrying… still 404.",
        "Retrying harder… still 404.",
        "Have you tried turning it off and on again?",
        "Retry failed successfully.",
        "Still missing. Consistency is a feature."
      ];
      let retries = 0;
      retry.addEventListener("click", function () {
        if (retryStatus) retryStatus.textContent = lines[retries % lines.length];
        retries += 1;
        sfx("error");
        if (!reduceMotion && crash) {
          crash.classList.remove("is-shaking");
          void crash.offsetWidth;
          crash.classList.add("is-shaking");
        }
      });
    }

    const arena = page.querySelector("[data-egg-404-arena]");
    const file = page.querySelector("[data-egg-404-file]");
    if (!arena || !file) return;
    const label = file.querySelector("[data-egg-404-file-label]");
    const score = page.querySelector("[data-egg-404-score]");
    const toyStatus = page.querySelector("[data-egg-404-status]");
    const win = page.querySelector("[data-egg-404-win]");
    const names = ["page.html", "still-not-it.html", "almost.html", "found.html"];
    const GOAL = 3;
    let caught = 0;
    let dodges = 0;
    let lastDodge = 0;
    let tiredUntil = 0;
    let won = false;
    const pos = { x: 0, y: 0 };

    function bounds() {
      return { w: Math.max(arena.clientWidth - file.offsetWidth, 0), h: Math.max(arena.clientHeight - file.offsetHeight, 0) };
    }
    function place(x, y) {
      const b = bounds();
      pos.x = clamp(x, 0, b.w);
      pos.y = clamp(y, 0, b.h);
      file.style.translate = pos.x.toFixed(1) + "px " + pos.y.toFixed(1) + "px";
    }
    function placeRandom() {
      const b = bounds();
      place(rand(0, b.w), rand(0, b.h));
    }
    function center() {
      const b = bounds();
      place(b.w / 2, b.h / 2);
    }
    center();
    arena.classList.add("is-ready");
    window.addEventListener("resize", function () { place(pos.x, pos.y); }, { passive: true });

    arena.addEventListener("pointermove", function (event) {
      if (won || (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
      const now = clock();
      if (now < tiredUntil || now - lastDodge < 230) return;
      const rect = arena.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const cx = pos.x + file.offsetWidth / 2;
      const cy = pos.y + file.offsetHeight / 2;
      if (Math.hypot(px - cx, py - cy) > 88) return;
      const angle = Math.atan2(cy - py, cx - px) + rand(-0.7, 0.7);
      const jump = rand(110, 180);
      const before = { x: pos.x, y: pos.y };
      place(pos.x + Math.cos(angle) * jump, pos.y + Math.sin(angle) * jump);
      if (Math.hypot(pos.x - before.x, pos.y - before.y) < 50) {
        // Cornered: teleport to the far side of the arena.
        const b = bounds();
        place(px < rect.width / 2 ? rand(b.w * 0.6, b.w) : rand(0, b.w * 0.4), rand(0, b.h));
      }
      dodges += 1;
      lastDodge = now;
      sfx("tick");
      if (dodges % 6 === 0) {
        tiredUntil = now + 1500;
        file.classList.add("is-tired");
        if (toyStatus) toyStatus.textContent = "It's tired. Now's your chance!";
        window.setTimeout(function () { file.classList.remove("is-tired"); }, 1500);
      }
    });

    // Touch has no hover to dodge, so the page hops around on its own instead.
    if (!finePointer) {
      window.setInterval(function () {
        if (!won && !doc.hidden) placeRandom();
      }, reduceMotion ? 2400 : 1300);
    }

    file.addEventListener("click", function (event) {
      if (won) return;
      caught += 1;
      const rect = file.getBoundingClientRect();
      sfx("coin");
      if (event.detail !== 0) sparkle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, { count: 30, power: 520 });
      if (score) score.textContent = caught + " / " + GOAL;
      if (label) label.textContent = names[Math.min(caught, names.length - 1)];
      if (caught >= GOAL) {
        won = true;
        arena.classList.add("is-won");
        if (toyStatus) toyStatus.textContent = "Caught it! It was a 404 all along. Here's the homepage instead.";
        if (win) win.hidden = false;
        sfx("fanfare");
        confettiEffect("found", [{ delay: 0, count: 120 }]);
        const winLink = win ? win.querySelector("a") : null;
        if (winLink && event.detail === 0) winLink.focus();
        return;
      }
      if (toyStatus) toyStatus.textContent = "Caught " + caught + " of " + GOAL + ". It slipped away again…";
      placeRandom();
      tiredUntil = 0;
    });
  }

  init404();
})();
