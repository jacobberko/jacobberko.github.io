/*
 * JB//OS desktop (home concept #1, lab/os).
 * Enhances the server-rendered profile windows into a small window manager:
 * boot sequence, draggable/resizable windows, taskbar + start menu, a desktop
 * context menu, an assistant, and a phone home screen with full-screen sheets.
 * Everything stays readable without this file (see _sass/home-os.scss).
 */
(function () {
  "use strict";

  const doc = document;
  const band = doc.querySelector("[data-os]");
  if (!band) return;
  const desktop = band.querySelector("[data-os-desktop]");
  const workspace = band.querySelector("[data-os-workspace]");
  if (!desktop || !workspace) return;

  const JBOS = window.JBOS || {};
  const reduceMotion = typeof JBOS.reduceMotion === "boolean"
    ? JBOS.reduceMotion
    : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phoneQuery = window.matchMedia("(max-width: 759px)");
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const BOOT_KEY = "jb-os-booted";
  const TIPS_KEY = "jb-os-tips";
  const WALL_KEY = "jb-os-wallpaper";
  const WALLPAPERS = [
    { id: "grid", label: "ACID_GRID.BMP" },
    { id: "sunset", label: "SUNSET_1986.BMP" },
    { id: "blueprint", label: "BLUEPRINT.DWG" },
    { id: "checker", label: "CHECKER.GIF" }
  ];
  const MIN_W = 250;
  const MIN_H = 150;
  const GAP = 16;
  const bootedAt = Date.now();

  const iconGrid = band.querySelector("[data-os-icons]");
  const freeLayer = band.querySelector("[data-os-free]");
  const wallpaperEl = band.querySelector("[data-os-wallpaper]");
  const tasksList = band.querySelector("[data-os-tasks]");
  const startButton = band.querySelector("[data-os-start]");
  const startMenu = band.querySelector("[data-os-start-menu]");
  const contextMenu = band.querySelector("[data-os-context]");
  const bootEl = band.querySelector("[data-os-boot]");
  const biosEl = band.querySelector("[data-os-bios]");
  const powerMsg = band.querySelector("[data-os-power-msg]");
  const statusEl = band.querySelector("[data-os-status]");
  const tipsEl = band.querySelector("[data-os-tips]");

  /* ---------------------------------------------------------------- helpers */
  function sfx(name) {
    try {
      const sound = window.JBOS && window.JBOS.sound;
      if (sound && typeof sound.play === "function") sound.play(name);
    } catch (error) { /* sound is optional */ }
  }

  function toast(message) {
    if (window.JBOS && typeof window.JBOS.toast === "function") window.JBOS.toast(message);
  }

  function storage(kind) {
    try { return kind === "local" ? window.localStorage : window.sessionStorage; } catch (error) { return null; }
  }

  function readStore(kind, key) {
    try { const s = storage(kind); return s ? s.getItem(key) : null; } catch (error) { return null; }
  }

  function writeStore(kind, key, value) {
    try { const s = storage(kind); if (s) s.setItem(key, value); } catch (error) { /* private mode */ }
  }

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function isTyping(target) {
    const el = target && target.nodeType === 1 ? target : doc.activeElement;
    if (!el) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
  }

  function foreignDialogOpen() {
    return Boolean(doc.querySelector("dialog[open]"));
  }

  let announceTimer = 0;
  function announce(message) {
    if (!statusEl) return;
    statusEl.textContent = "";
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(function () { statusEl.textContent = message; }, 40);
  }

  function animate(el, frames, options) {
    if (reduceMotion || !el || typeof el.animate !== "function") return null;
    try { return el.animate(frames, options); } catch (error) { return null; }
  }

  function finished(animation) {
    if (!animation || !animation.finished) return Promise.resolve();
    return animation.finished.then(function () {}, function () {});
  }

  function cancelAnimations(el) {
    if (el && typeof el.getAnimations === "function") {
      el.getAnimations().forEach(function (animation) { animation.cancel(); });
    }
  }

  function tf(x, y, sx, sy) {
    return "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0) scale(" + sx + "," + sy + ")";
  }

  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function relRect(el) {
    const r = el.getBoundingClientRect();
    const w = workspace.getBoundingClientRect();
    return { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height };
  }

  function focusNoScroll(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (error) { el.focus(); }
  }

  /* ---------------------------------------------------------- window model */
  const wins = new Map();
  let zTop = 10;
  let activeWin = null;
  let mode = phoneQuery.matches ? "phone" : "desktop";
  let userArranged = false;
  let cascade = 0;

  // A layout the visitor touched survives viewport resizes; the default one is re-tiled.
  // The window-state functions below call this themselves, so every way in (icons, Start
  // menu, taskbar, assistant, `os open`, keyboard) counts. Only arrange() passes auto: true.
  function markArranged(opts) {
    if (!opts || !opts.auto) userArranged = true;
  }

  function buildControls(win) {
    const holder = win.el.querySelector("[data-os-controls]");
    if (!holder) return;
    const group = doc.createElement("div");
    group.className = "os-controls";
    [["close", "Close"], ["minimize", "Minimise"], ["maximize", "Maximise"]].forEach(function (pair) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "os-ctl os-ctl--" + pair[0];
      button.setAttribute("data-os-action", pair[0]);
      button.setAttribute("aria-label", pair[1] + " " + win.title);
      if (pair[0] === "close") {
        const label = doc.createElement("span");
        label.className = "os-ctl__label";
        label.textContent = "Close";
        button.appendChild(label);
      }
      group.appendChild(button);
    });
    holder.parentNode.replaceChild(group, holder);
    win.maxButton = group.querySelector(".os-ctl--maximize");
  }

  band.querySelectorAll("[data-os-window]").forEach(function (el) {
    const id = el.getAttribute("data-os-window");
    const titleEl = el.querySelector(".os-window__title");
    const win = {
      id: id,
      el: el,
      body: el.querySelector("[data-os-scroll]"),
      title: titleEl ? titleEl.textContent.trim() : id,
      state: "closed",
      maximized: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      restore: null,
      task: null,
      opener: null,
      maxButton: null
    };
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "false");
    el.tabIndex = -1;
    if (win.body) win.body.tabIndex = 0;
    buildControls(win);
    wins.set(id, win);
  });

  function winFrom(node) {
    const el = node && node.closest ? node.closest("[data-os-window]") : null;
    return el ? wins.get(el.getAttribute("data-os-window")) : null;
  }

  function iconFor(id) {
    const button = band.querySelector('[data-os-open="' + id + '"]');
    return button && visible(button) ? button : null;
  }

  function bounds() {
    return { W: workspace.clientWidth, H: workspace.clientHeight };
  }

  function apply(win) {
    const s = win.el.style;
    s.transform = "translate3d(" + Math.round(win.x) + "px," + Math.round(win.y) + "px,0)";
    s.width = Math.round(win.w) + "px";
    s.height = Math.round(win.h) + "px";
  }

  function fit(win) {
    const b = bounds();
    win.w = clamp(win.w, Math.min(MIN_W, b.W), b.W);
    win.h = clamp(win.h, Math.min(MIN_H, b.H), b.H);
    win.x = clamp(win.x, 0, b.W - win.w);
    win.y = clamp(win.y, 0, b.H - win.h);
  }

  function naturalHeight(win, width) {
    const s = win.el.style;
    const previous = { w: s.width, h: s.height };
    win.el.classList.add("is-measuring");
    s.width = Math.round(width) + "px";
    s.height = "auto";
    const height = win.el.offsetHeight;
    win.el.classList.remove("is-measuring");
    s.width = previous.w;
    s.height = previous.h;
    return height;
  }

  function rectOf(win) {
    return { x: win.x, y: win.y, w: win.w, h: win.h };
  }

  function setMaxLabel(win) {
    win.el.classList.toggle("is-maximized", win.maximized);
    if (win.maxButton) win.maxButton.setAttribute("aria-label", (win.maximized ? "Restore " : "Maximise ") + win.title);
  }

  // Default arrangement: about, experience, languages and coursework all open and tiled at
  // every desktop width, so nothing a recruiter needs sits behind a click (or out of reach
  // of a screen reader). Wide workspaces get a 45/55 split with a cascaded lower row; from
  // about 760 to 1180px the columns split evenly, the lower row keeps more of the height,
  // and each window tightens its own gutters through a container query (home-os.scss).
  function layoutPlan() {
    const b = bounds();
    const W = b.W;
    const H = b.H;
    const get = function (id) { return wins.get(id); };
    const plan = { rects: {}, order: ["about", "experience", "skills", "coursework"] };

    if (W < MIN_W * 2 + GAP) {
      // Safety net for a workspace too narrow for two columns (the icon rail keeps this
      // from happening at 760px+): one full-width column, every window still open.
      const gap = 8;
      const h = Math.max(Math.floor((H - gap * 3) / 4), Math.min(MIN_H, H));
      plan.order.forEach(function (id, index) {
        plan.rects[id] = { x: 0, y: index * (h + gap), w: W, h: h };
      });
      return plan;
    }

    const wide = W >= 940;
    const leftW = Math.round((W - GAP) * (wide ? 0.45 : 0.5));
    const rightX = leftW + GAP;
    const rightW = W - rightX;
    const nudge = wide ? 18 : clamp(Math.min(leftW, rightW) - MIN_W, 0, 10);
    // The lower row always keeps enough height to show real content, not just a title bar.
    const lowRoom = Math.max(MIN_H, Math.round(H * (wide ? 0.3 : 0.36)));
    const topCap = function (ratio) {
      return Math.max(Math.min(MIN_H, H), Math.min(Math.round(H * ratio), H - GAP - lowRoom));
    };
    const aboutH = Math.min(naturalHeight(get("about"), leftW), topCap(wide ? 0.62 : 0.56));
    const expH = Math.min(naturalHeight(get("experience"), rightW), topCap(wide ? 0.64 : 0.58));
    const skillsY = aboutH + GAP;
    const courseY = expH + GAP;
    plan.rects.about = { x: 0, y: 0, w: leftW, h: aboutH };
    plan.rects.experience = { x: rightX, y: 0, w: rightW, h: expH };
    plan.rects.skills = { x: nudge, y: skillsY, w: leftW - nudge, h: Math.min(naturalHeight(get("skills"), leftW - nudge), H - skillsY) };
    plan.rects.coursework = { x: rightX + nudge, y: courseY, w: rightW - nudge, h: Math.min(naturalHeight(get("coursework"), rightW - nudge), H - courseY) };
    return plan;
  }

  function defaultRect(win) {
    const b = bounds();
    const w = Math.min(b.W, win.id === "trash" ? 440 : 520);
    const h = Math.min(naturalHeight(win, w), b.H * 0.8);
    cascade = (cascade + 1) % 5;
    const offset = cascade * 22;
    return { x: Math.round((b.W - w) * 0.42) + offset, y: Math.round((b.H - h) * 0.3) + offset, w: w, h: h };
  }

  /* ------------------------------------------------------ z-order + focus */
  function front(win) {
    if (!win) return;
    if (zTop > 900) {
      // Renumber so z-index never grows without bound.
      Array.from(wins.values())
        .sort(function (a, b) { return (Number(a.el.style.zIndex) || 0) - (Number(b.el.style.zIndex) || 0); })
        .forEach(function (item, index) { item.el.style.zIndex = String(10 + index); });
      zTop = 10 + wins.size;
    }
    zTop += 1;
    win.el.style.zIndex = String(zTop);
    setActive(win);
  }

  function setActive(win) {
    activeWin = win;
    wins.forEach(function (item) { item.el.classList.toggle("is-active", item === win); });
    updateTasks();
  }

  function activateTop() {
    let top = null;
    wins.forEach(function (item) {
      if (item.state !== "open") return;
      if (!top || (Number(item.el.style.zIndex) || 0) > (Number(top.el.style.zIndex) || 0)) top = item;
    });
    setActive(top);
  }

  function focusWin(win) {
    focusNoScroll(win.el);
  }

  function fresh(win) {
    if (reduceMotion) return;
    win.el.classList.remove("is-fresh");
    void win.el.offsetWidth;
    win.el.classList.add("is-fresh");
    window.clearTimeout(win.freshTimer);
    win.freshTimer = window.setTimeout(function () { win.el.classList.remove("is-fresh"); }, 2200);
  }

  function ping(win) {
    if (reduceMotion) return;
    win.el.classList.remove("is-pinged");
    void win.el.offsetWidth;
    win.el.classList.add("is-pinged");
  }

  /* ------------------------------------------------------------- taskbar */
  function ensureTask(win) {
    if (win.task || !tasksList) return;
    const item = doc.createElement("li");
    const button = doc.createElement("button");
    const dot = doc.createElement("span");
    const label = doc.createElement("span");
    button.type = "button";
    button.className = "os-task";
    button.setAttribute("data-os-task", win.id);
    button.setAttribute("aria-controls", win.el.id);
    dot.className = "os-task__dot";
    dot.setAttribute("aria-hidden", "true");
    label.className = "os-task__label";
    label.textContent = win.title;
    button.appendChild(dot);
    button.appendChild(label);
    item.appendChild(button);
    tasksList.appendChild(item);
    win.task = button;
    button.addEventListener("click", function () { taskClick(win); });
    animate(item, [
      { transform: "translateY(130%)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 }
    ], { duration: 280, easing: EASE_OUT });
  }

  function removeTask(win, instant) {
    if (!win.task) return;
    const item = win.task.parentNode;
    win.task = null;
    const anim = instant ? null : animate(item, [
      { transform: "translateY(0)", opacity: 1 },
      { transform: "translateY(130%)", opacity: 0 }
    ], { duration: 180, easing: "ease-in" });
    finished(anim).then(function () { if (item.parentNode) item.parentNode.removeChild(item); });
  }

  function updateTasks() {
    wins.forEach(function (win) {
      if (!win.task) return;
      const open = win.state === "open";
      win.task.classList.toggle("is-active", open && win === activeWin);
      win.task.classList.toggle("is-minimized", win.state === "minimized");
      win.task.setAttribute("aria-pressed", String(open));
      win.task.setAttribute("aria-label", win.title + (win.state === "minimized" ? " (minimised)" : ""));
    });
  }

  function taskClick(win) {
    sfx("click");
    if (win.state === "minimized") restoreWindow(win, { focus: true });
    else if (win === activeWin) minimizeWindow(win);
    else { front(win); focusWin(win); ping(win); }
  }

  /* ------------------------------------------------------ desktop windows */
  function zoomFrom(win, source, delay) {
    const from = source && visible(source)
      ? relRect(source.querySelector(".os-glyph") || source)
      : { x: win.x + win.w / 2 - 24, y: win.y + win.h / 2 - 24, w: 48, h: 48 };
    return animate(win.el, [
      { transform: tf(from.x, from.y, from.w / win.w, from.h / win.h), opacity: 0 },
      { transform: tf(win.x, win.y, 1, 1), opacity: 1 }
    ], { duration: 480, delay: delay || 0, easing: EASE_OUT, fill: "backwards" });
  }

  function flip(win, from) {
    if (!from || !win.w || !win.h) return null;
    return animate(win.el, [
      { transform: tf(from.x, from.y, from.w / win.w, from.h / win.h) },
      { transform: tf(win.x, win.y, 1, 1) }
    ], { duration: 340, easing: EASE_OUT });
  }

  // A curved "genie" path into (or out of) the taskbar button, with a dashed ghost trail.
  function genie(win, target, reverse) {
    if (reduceMotion || !target) return null;
    const midX = win.x + (target.x - win.x) * 0.22;
    const midY = win.y + (target.y - win.y) * 0.58;
    const frames = [
      { transform: tf(win.x, win.y, 1, 1), opacity: 1, offset: 0, easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
      { transform: tf(midX, midY, 0.52, 0.3), opacity: 0.9, offset: 0.45, easing: "cubic-bezier(0.6, 0, 0.9, 0.5)" },
      { transform: tf(target.x, target.y, target.w / win.w, target.h / win.h), opacity: 0.05, offset: 1 }
    ];
    const options = { duration: 540, easing: "linear", direction: reverse ? "reverse" : "normal" };
    for (let i = 1; i <= 3; i += 1) {
      const ghost = doc.createElement("span");
      ghost.className = "os-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.width = Math.round(win.w) + "px";
      ghost.style.height = Math.round(win.h) + "px";
      ghost.style.transform = tf(win.x, win.y, 1, 1);
      workspace.appendChild(ghost);
      const trail = animate(ghost, frames.map(function (frame) {
        return { transform: frame.transform, opacity: frame.opacity * (0.55 - i * 0.12), offset: frame.offset, easing: frame.easing };
      }), { duration: options.duration, easing: "linear", direction: options.direction, delay: i * 45, fill: "both" });
      finished(trail).then(function () { ghost.remove(); });
    }
    return animate(win.el, frames, options);
  }

  function openWindow(win, opts) {
    opts = opts || {};
    if (mode === "phone") { openSheet(win, opts); return; }
    if (win.state === "open") {
      front(win);
      if (opts.focus) focusWin(win);
      ping(win);
      return;
    }
    if (win.state === "minimized") { restoreWindow(win, opts); return; }
    markArranged(opts);
    cancelAnimations(win.el);
    if (!win.w) Object.assign(win, defaultRect(win));
    fit(win);
    ensureTask(win);
    win.state = "open";
    win.el.classList.add("is-open");
    apply(win);
    front(win);
    fresh(win);
    if (opts.animate !== false) zoomFrom(win, opts.source || iconFor(win.id), opts.delay);
    if (!opts.quiet) { sfx("open"); announce(win.title + " opened"); }
    if (opts.focus) focusWin(win);
  }

  function closeWindow(win, opts) {
    opts = opts || {};
    if (win.state === "closed") return;
    if (mode === "phone") { closeSheet(win); return; }
    markArranged(opts);
    const hadFocus = win.el.contains(doc.activeElement);
    const wasMinimized = win.state === "minimized";
    cancelAnimations(win.el);
    win.state = "closed";
    if (win.maximized && win.restore) Object.assign(win, win.restore);
    win.maximized = false;
    removeTask(win, opts.instant);
    const anim = wasMinimized || opts.instant ? null : animate(win.el, [
      { transform: tf(win.x, win.y, 1, 1), opacity: 1 },
      { transform: tf(win.x + win.w * 0.04, win.y + win.h * 0.04, 0.92, 0.92), opacity: 0 }
    ], { duration: 190, easing: "ease-in" });
    finished(anim).then(function () {
      if (win.state !== "closed") return;
      win.el.classList.remove("is-open", "is-active", "is-fresh");
      setMaxLabel(win);
    });
    if (!opts.quiet) { sfx("close"); announce(win.title + " closed"); }
    if (activeWin === win) activateTop();
    if (hadFocus) focusNoScroll(win.opener && visible(win.opener) ? win.opener : (iconFor(win.id) || startButton));
  }

  function minimizeWindow(win, opts) {
    opts = opts || {};
    if (win.state !== "open") return;
    markArranged(opts);
    const hadFocus = win.el.contains(doc.activeElement);
    cancelAnimations(win.el);
    ensureTask(win);
    win.state = "minimized";
    const anim = opts.instant ? null : genie(win, win.task ? relRect(win.task) : null, false);
    finished(anim).then(function () {
      if (win.state === "minimized") win.el.classList.remove("is-open", "is-fresh");
    });
    if (!opts.quiet) { sfx("whoosh"); announce(win.title + " minimised to the taskbar"); }
    if (activeWin === win) activateTop();
    updateTasks();
    if (hadFocus && win.task) focusNoScroll(win.task);
  }

  function restoreWindow(win, opts) {
    opts = opts || {};
    if (win.state !== "minimized") return;
    markArranged(opts);
    cancelAnimations(win.el);
    win.state = "open";
    fit(win);
    win.el.classList.add("is-open");
    apply(win);
    front(win);
    if (win.task && opts.animate !== false) genie(win, relRect(win.task), true);
    if (!opts.quiet) { sfx("open"); announce(win.title + " restored"); }
    if (opts.focus !== false) focusWin(win);
  }

  function toggleMaximize(win) {
    if (win.state !== "open") return;
    const before = rectOf(win);
    if (win.maximized) {
      Object.assign(win, win.restore || before);
      win.maximized = false;
    } else {
      const b = bounds();
      win.restore = before;
      win.x = 0;
      win.y = 0;
      win.w = b.W;
      win.h = b.H;
      win.maximized = true;
    }
    markArranged();
    fit(win);
    apply(win);
    setMaxLabel(win);
    front(win);
    flip(win, before);
    sfx("click");
    announce(win.title + (win.maximized ? " maximised" : " restored"));
  }

  /* ----------------------------------------------------- phone sheets */
  let sheetWin = null;

  function syncDialogState() {
    doc.body.classList.toggle("dialog-open", Boolean(sheetWin) || foreignDialogOpen());
  }

  function openSheet(win, opts) {
    if (sheetWin === win) return;
    if (sheetWin) closeSheet(sheetWin, { instant: true, keepLock: true });
    cancelAnimations(win.el);
    sheetWin = win;
    win.state = "open";
    win.opener = opts.source || iconFor(win.id) || win.opener;
    win.el.setAttribute("aria-modal", "true");
    win.el.classList.add("is-open");
    band.classList.add("has-sheet");
    syncDialogState();
    const source = win.opener && visible(win.opener) ? win.opener.getBoundingClientRect() : null;
    if (source) {
      win.el.style.transformOrigin = (source.left + source.width / 2) + "px " + (source.top + source.height / 2) + "px";
      animate(win.el, [
        { transform: "scale(0.14)", opacity: 0, borderRadius: "3rem" },
        { transform: "scale(1)", opacity: 1, borderRadius: "0" }
      ], { duration: 420, easing: EASE_OUT });
    }
    if (win.body) win.body.scrollTop = 0;
    fresh(win);
    sfx("open");
    focusWin(win);
  }

  function closeSheet(win, opts) {
    opts = opts || {};
    if (sheetWin !== win) return;
    sheetWin = null;
    win.state = "closed";
    win.el.setAttribute("aria-modal", "false");
    const anim = opts.instant ? null : animate(win.el, [
      { transform: "scale(1)", opacity: 1 },
      { transform: "scale(0.14)", opacity: 0 }
    ], { duration: 260, easing: "cubic-bezier(0.5, 0, 0.75, 0)" });
    finished(anim).then(function () {
      if (win.state !== "closed") return;
      win.el.classList.remove("is-open", "is-fresh");
      win.el.style.transformOrigin = "";
    });
    if (!opts.keepLock) {
      band.classList.remove("has-sheet");
      syncDialogState();
      sfx("close");
      focusNoScroll(win.opener && visible(win.opener) ? win.opener : iconFor(win.id));
    }
  }

  // Other modules' dialogs (terminal, lightbox) clear body.dialog-open when they close;
  // restore the lock if one of our phone sheets is still open underneath.
  doc.addEventListener("close", function () {
    if (sheetWin) window.setTimeout(syncDialogState, 0);
  }, true);

  function trapSheetFocus(event) {
    if (!sheetWin || event.key !== "Tab") return;
    const focusables = Array.from(sheetWin.el.querySelectorAll("button, a[href], input, summary, [tabindex]:not([tabindex='-1'])"))
      .filter(function (el) { return !el.disabled && visible(el); });
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === sheetWin.el)) {
      event.preventDefault();
      focusNoScroll(last);
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      focusNoScroll(first);
    }
  }

  /* -------------------------------------------------------- arrangement */
  // Lays out the default windows. Every call it makes passes auto: true, so none of them
  // counts as the visitor arranging things (see markArranged).
  function arrange(animated) {
    if (mode !== "desktop") return;
    const plan = layoutPlan();
    let delay = 0;
    wins.forEach(function (win) {
      if (!plan.rects[win.id] && win.state !== "closed") closeWindow(win, { quiet: true, auto: true, instant: !animated });
    });
    plan.order.forEach(function (id) {
      const win = wins.get(id);
      if (!win) return;
      const before = win.state === "open" ? rectOf(win) : null;
      Object.assign(win, plan.rects[id]);
      win.maximized = false;
      win.restore = null;
      setMaxLabel(win);
      fit(win);
      if (win.state === "open") {
        apply(win);
        if (animated) flip(win, before);
      } else if (win.state === "minimized") {
        restoreWindow(win, { focus: false, quiet: true, auto: true, animate: animated });
      } else {
        openWindow(win, { animate: animated, delay: delay, quiet: true, auto: true });
        delay += 120;
      }
    });
    const lead = wins.get(plan.order[0]);
    if (lead && lead.state === "open") front(lead);
    updateTasks();
    userArranged = false;
  }

  // Replays the "windows fly out of their icons" entrance for already-arranged windows.
  function replayEntrance() {
    if (mode !== "desktop" || reduceMotion) return;
    let delay = 0;
    ["about", "experience", "skills", "coursework"].forEach(function (id) {
      const win = wins.get(id);
      if (!win || win.state !== "open") return;
      fresh(win);
      zoomFrom(win, iconFor(id), delay);
      delay += 120;
    });
    window.setTimeout(function () { sfx("pop"); }, 160);
  }

  /* ------------------------------------------------------ drag + resize */
  function trackPointer(handle, event, onMove, onEnd) {
    const pointerId = event.pointerId;
    let ended = false;
    try { handle.setPointerCapture(pointerId); } catch (error) { /* synthetic event */ }
    function move(e) { if (e.pointerId === pointerId) onMove(e); }
    function end(e) {
      if (ended || (e.pointerId !== undefined && e.pointerId !== pointerId)) return;
      ended = true;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      try { if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId); } catch (error) { /* already released */ }
      onEnd(e);
    }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
  }

  function startDrag(win, event, handle) {
    event.preventDefault();
    if (!win.el.contains(doc.activeElement)) focusWin(win);
    const startX = event.clientX;
    const startY = event.clientY;
    let originX = win.x;
    let originY = win.y;
    let moved = false;
    let frame = 0;
    trackPointer(handle, event, function (e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true;
        markArranged();
        win.el.classList.add("is-dragging");
        if (win.maximized && win.restore) {
          // Pull a maximised window back to its old size, keeping it under the pointer.
          const ws = workspace.getBoundingClientRect();
          const ratio = clamp((startX - ws.left - win.x) / win.w, 0, 1);
          win.w = win.restore.w;
          win.h = win.restore.h;
          win.maximized = false;
          setMaxLabel(win);
          originX = startX - ws.left - ratio * win.w;
          originY = 0;
        }
      }
      win.x = originX + dx;
      win.y = originY + dy;
      fit(win);
      if (!frame) frame = window.requestAnimationFrame(function () { frame = 0; apply(win); });
    }, function () {
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      apply(win);
      win.el.classList.remove("is-dragging");
    });
  }

  function startResize(win, event, handle) {
    event.preventDefault();
    if (!win.el.contains(doc.activeElement)) focusWin(win);
    const startX = event.clientX;
    const startY = event.clientY;
    if (win.maximized) { win.maximized = false; setMaxLabel(win); }
    const origin = rectOf(win);
    let frame = 0;
    markArranged();
    win.el.classList.add("is-dragging");
    trackPointer(handle, event, function (e) {
      const b = bounds();
      win.w = clamp(origin.w + e.clientX - startX, Math.min(MIN_W, b.W), b.W - win.x);
      win.h = clamp(origin.h + e.clientY - startY, Math.min(MIN_H, b.H), b.H - win.y);
      if (!frame) frame = window.requestAnimationFrame(function () { frame = 0; apply(win); });
    }, function () {
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      apply(win);
      win.el.classList.remove("is-dragging");
    });
  }

  workspace.addEventListener("pointerdown", function (event) {
    if (mode !== "desktop") return;
    const win = winFrom(event.target);
    if (!win || win.state !== "open") return;
    if (win !== activeWin || Number(win.el.style.zIndex) !== zTop) front(win);
    if (event.button !== 0) return;
    const resizer = event.target.closest("[data-os-resize]");
    if (resizer) { startResize(win, event, resizer); return; }
    const handle = event.target.closest("[data-os-drag]");
    if (!handle || event.target.closest("button, a, input, textarea, select, summary, label")) return;
    startDrag(win, event, handle);
  });

  workspace.addEventListener("dblclick", function (event) {
    if (mode !== "desktop") return;
    const handle = event.target.closest("[data-os-drag]");
    if (!handle || event.target.closest("button")) return;
    const win = winFrom(handle);
    if (win) toggleMaximize(win);
  });

  workspace.addEventListener("click", function (event) {
    const button = event.target.closest("[data-os-action]");
    if (!button) return;
    const win = winFrom(button);
    if (!win) return;
    const action = button.getAttribute("data-os-action");
    if (action === "close") closeWindow(win);
    else if (action === "minimize") minimizeWindow(win);
    else if (action === "maximize") toggleMaximize(win);
  });

  workspace.addEventListener("focusin", function (event) {
    if (mode !== "desktop") return;
    const win = winFrom(event.target);
    if (win && win.state === "open" && win !== activeWin) front(win);
  });

  /* -------------------------------------------------------------- icons */
  function openById(id, opts) {
    opts = opts || {};
    if (id === "terminal") { openTerminal(); return true; }
    const win = wins.get(id);
    if (!win) return false;
    if (opts.source) win.opener = opts.source;
    openWindow(win, { animate: true, focus: opts.focus !== false, source: opts.source });
    return true;
  }

  let terminalGreeted = false;
  function openTerminal() {
    const terminal = window.JBOS && window.JBOS.terminal;
    if (!terminal || typeof terminal.open !== "function") { toast("Terminal driver missing. Press ` instead."); return; }
    closeMenus(false);
    sfx("click");
    terminal.open();
    if (!terminalGreeted && typeof terminal.print === "function") {
      terminalGreeted = true;
      terminal.print("JB//OS desktop session attached. Try: os help", true);
    }
  }

  band.querySelectorAll("[data-os-open]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (bootBlocking()) return;
      button.classList.remove("is-pressed");
      void button.offsetWidth;
      button.classList.add("is-pressed");
      window.setTimeout(function () { button.classList.remove("is-pressed"); }, 220);
      openById(button.getAttribute("data-os-open"), { source: button });
    });
  });

  /* -------------------------------------------------------------- menus */
  let contextPoint = null;

  function menuItems(menu) {
    return Array.from(menu.querySelectorAll("[role='menuitem']")).filter(function (el) { return visible(el); });
  }

  function openStart() {
    if (!startMenu || !startButton) return;
    closeContext(false);
    startMenu.hidden = false;
    startButton.setAttribute("aria-expanded", "true");
    sfx("click");
    const items = menuItems(startMenu);
    if (items[0]) focusNoScroll(items[0]);
  }

  function closeStart(returnFocus) {
    if (!startMenu || startMenu.hidden) return;
    startMenu.hidden = true;
    startButton.setAttribute("aria-expanded", "false");
    if (returnFocus) focusNoScroll(startButton);
  }

  function openContext(clientX, clientY) {
    if (!contextMenu) return;
    closeStart(false);
    const box = desktop.getBoundingClientRect();
    contextMenu.hidden = false;
    contextMenu.classList.remove("is-open");
    const menuW = contextMenu.offsetWidth;
    const menuH = contextMenu.offsetHeight;
    const x = clamp(clientX - box.left, 8, box.width - menuW - 8);
    const y = clamp(clientY - box.top, 8, box.height - menuH - 8);
    contextPoint = { x: clientX - box.left, y: clientY - box.top };
    contextMenu.style.left = Math.round(x) + "px";
    contextMenu.style.top = Math.round(y) + "px";
    void contextMenu.offsetWidth;
    contextMenu.classList.add("is-open");
    sfx("pop");
    const items = menuItems(contextMenu);
    if (items[0]) focusNoScroll(items[0]);
  }

  function closeContext(returnFocus) {
    if (!contextMenu || contextMenu.hidden) return;
    contextMenu.hidden = true;
    contextMenu.classList.remove("is-open");
    if (returnFocus) focusNoScroll(startButton);
  }

  function closeMenus(returnFocus) {
    closeStart(returnFocus);
    closeContext(false);
  }

  function menuKeys(menu, closeFn) {
    menu.addEventListener("keydown", function (event) {
      const items = menuItems(menu);
      const index = items.indexOf(doc.activeElement);
      let next = -1;
      if (event.key === "ArrowDown") next = (index + 1) % items.length;
      else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFn(true); return; }
      else if (event.key === "Tab") { closeFn(false); return; }
      if (next < 0 || !items.length) return;
      event.preventDefault();
      focusNoScroll(items[next]);
    });
    menu.addEventListener("click", function (event) {
      const item = event.target.closest("[data-os-cmd]");
      if (item) {
        closeFn(false);
        runCommand(item.getAttribute("data-os-cmd"));
      } else if (event.target.closest("a[role='menuitem']")) {
        closeFn(false);
      }
    });
  }

  if (startButton && startMenu) {
    startButton.addEventListener("click", function () {
      if (startMenu.hidden) openStart(); else closeStart(false);
    });
    startButton.addEventListener("keydown", function (event) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); openStart(); }
    });
    menuKeys(startMenu, closeStart);
  }
  if (contextMenu) menuKeys(contextMenu, closeContext);

  if (wallpaperEl) {
    wallpaperEl.addEventListener("contextmenu", function (event) {
      if (mode !== "desktop" || bootBlocking()) return;
      event.preventDefault();
      openContext(event.clientX, event.clientY);
    });
    wallpaperEl.addEventListener("pointerdown", function (event) {
      if (event.button === 0) band.querySelectorAll(".os-icon.is-selected").forEach(function (icon) { icon.classList.remove("is-selected"); });
    });
  }

  doc.addEventListener("pointerdown", function (event) {
    if (startMenu && !startMenu.hidden && !startMenu.contains(event.target) && !startButton.contains(event.target)) closeStart(false);
    if (contextMenu && !contextMenu.hidden && !contextMenu.contains(event.target)) closeContext(false);
  });

  /* ------------------------------------------------------------ commands */
  function runCommand(command) {
    const parts = String(command || "").split(":");
    switch (parts[0]) {
      case "open": openById(parts[1], { focus: true }); break;
      case "terminal": openTerminal(); break;
      case "tile": tidyUp(); break;
      case "wallpaper": cycleWallpaper(); break;
      case "folder": newFolder(contextPoint); break;
      case "refresh": refreshDesktop(); break;
      case "assistant": summonAssistant(); break;
      case "shutdown": shutDown(); break;
      case "about-os": aboutOS(); break;
      default: break;
    }
  }

  function tidyUp() {
    if (mode !== "desktop") return;
    arrange(true);
    sfx("whoosh");
    announce("Windows tidied up");
  }

  function aboutOS() {
    const up = Math.round((Date.now() - bootedAt) / 1000);
    const minutes = Math.floor(up / 60);
    toast("JB//OS 26.09 · kernel: vanilla JS · uptime " + (minutes ? minutes + "m " : "") + (up % 60) + "s · 0 dependencies");
    sfx("pop");
  }

  /* ------------------------------------------------------------ wallpaper */
  let wallpaperIndex = 0;

  function setWallpaper(index, animated) {
    if (!wallpaperEl) return;
    const next = WALLPAPERS[(index + WALLPAPERS.length) % WALLPAPERS.length];
    wallpaperIndex = WALLPAPERS.indexOf(next);
    if (animated && !reduceMotion) {
      const old = wallpaperEl.cloneNode(true);
      old.classList.add("is-leaving");
      old.removeAttribute("data-os-wallpaper");
      wallpaperEl.parentNode.insertBefore(old, wallpaperEl.nextSibling);
      const wipe = animate(old, [
        { clipPath: "inset(0 0 0 0)" },
        { clipPath: "inset(100% 0 0 0)" }
      ], { duration: 560, easing: "steps(10, end)", fill: "forwards" });
      finished(wipe).then(function () { old.remove(); });
    }
    wallpaperEl.setAttribute("data-paper", next.id);
    writeStore("local", WALL_KEY, next.id);
    return next;
  }

  function cycleWallpaper() {
    const next = setWallpaper(wallpaperIndex + 1, true);
    if (!next) return;
    sfx("click");
    toast("Wallpaper: " + next.label);
    announce("Wallpaper changed to " + next.label);
  }

  /* ------------------------------------------------------- new folder joke */
  const FOLDERS = [
    { name: "definitely_not_homework", joke: "0 items. The homework was submitted on time. Probably." },
    { name: "final_FINAL_v7", joke: "Contains final_FINAL_v8. It's folders all the way down." },
    { name: "startup_idea_#48", joke: "Uber, but for folders. Currently raising a pre-seed." },
    { name: "node_modules", joke: "4.2 GB. Opening will take 3–5 business days." },
    { name: "memes_for_standup", joke: "Access denied: classified as mission-critical." }
  ];
  let folderCount = 0;

  function typeLabel(el, text, done) {
    if (reduceMotion) { el.textContent = text; if (done) done(); return; }
    let i = 0;
    el.textContent = "";
    const timer = window.setInterval(function () {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) { window.clearInterval(timer); if (done) done(); }
    }, 38);
  }

  function newFolder(point) {
    if (!freeLayer || mode !== "desktop") return;
    if (folderCount >= FOLDERS.length) {
      toast("Disk full. Please delete a startup idea to continue.");
      sfx("error");
      return;
    }
    const spec = FOLDERS[folderCount];
    folderCount += 1;
    const box = desktop.getBoundingClientRect();
    const px = point ? point.x : box.width * 0.5;
    const py = point ? point.y : box.height * 0.45;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "os-icon";
    button.innerHTML = '<span class="os-glyph os-glyph--folder os-glyph--new" aria-hidden="true"><b>+</b></span><span class="os-icon__label"></span>';
    const label = button.querySelector(".os-icon__label");
    freeLayer.appendChild(button);
    const pos = {
      x: clamp(px - button.offsetWidth / 2, 8, box.width - button.offsetWidth - 8),
      y: clamp(py - 24, 8, box.height - button.offsetHeight - 60)
    };
    button.style.transform = "translate3d(" + pos.x + "px," + pos.y + "px,0)";
    animate(button, [
      { transform: "translate3d(" + pos.x + "px," + pos.y + "px,0) scale(0.2)", opacity: 0 },
      { transform: "translate3d(" + pos.x + "px," + pos.y + "px,0) scale(1.12)", opacity: 1, offset: 0.7 },
      { transform: "translate3d(" + pos.x + "px," + pos.y + "px,0) scale(1)", opacity: 1 }
    ], { duration: 360, easing: EASE_OUT });
    sfx("pop");
    label.textContent = "untitled folder";
    window.setTimeout(function () {
      typeLabel(label, spec.name, function () { announce("New folder created: " + spec.name); });
    }, reduceMotion ? 0 : 650);

    let dragged = false;
    button.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { x: pos.x, y: pos.y };
      dragged = false;
      trackPointer(button, event, function (e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
        dragged = true;
        button.classList.add("is-dragging");
        const b = desktop.getBoundingClientRect();
        pos.x = clamp(origin.x + dx, 0, b.width - button.offsetWidth);
        pos.y = clamp(origin.y + dy, 0, b.height - button.offsetHeight - 56);
        button.style.transform = "translate3d(" + pos.x + "px," + pos.y + "px,0)";
      }, function () { button.classList.remove("is-dragging"); });
    });
    button.addEventListener("click", function () {
      if (dragged) { dragged = false; return; }
      toast(spec.name + "/ · " + spec.joke);
      sfx("pop");
      animate(button.querySelector(".os-glyph"), [
        { transform: "rotate(0)" }, { transform: "rotate(-8deg)" }, { transform: "rotate(8deg)" }, { transform: "rotate(0)" }
      ], { duration: 320, easing: "steps(4, end)" });
    });
  }

  function refreshDesktop() {
    desktop.classList.remove("is-refreshing");
    void desktop.offsetWidth;
    desktop.classList.add("is-refreshing");
    window.setTimeout(function () { desktop.classList.remove("is-refreshing"); }, 700);
    sfx("click");
    toast("Desktop refreshed. Nothing changed. Very on brand.");
  }

  /* ---------------------------------------------------------------- boot */
  const BIOS = [
    ["JB-BIOS v26.09  (C) 2026 Berko Megatrends, Inc.", "dim"],
    ["CPU: Cornell CS + Business @ 4.00 GHz (caffeinated)"],
    ["Memory test: ", "", "OK", 16384],
    ["Detecting drives ... about.txt  experience.log  skills.exe  coursework.db"],
    ["Loading kernel: vanilla-js, 0 dependencies ", "", "OK"],
    ["Mounting /code /business /creative ", "", "OK"],
    ["Checking for bugs ... 0 found (3 promoted to features)"],
    ["Starting window manager ", "", "OK"]
  ];
  let bootState = "idle";
  let bootTimers = [];
  let poweringDown = false;
  let pendingRearrange = false;
  let viewObserver = null;

  function later(fn, ms) {
    bootTimers.push(window.setTimeout(fn, ms));
  }

  function bootBlocking() {
    return bootState === "booting" || poweringDown;
  }

  function appendBios(line) {
    if (!biosEl) return;
    const row = doc.createElement("span");
    row.textContent = line[0];
    if (line[1]) row.className = "is-" + line[1];
    biosEl.appendChild(row);
    if (line[3]) {
      // Count the memory test up like the real thing.
      const total = line[3];
      const counter = doc.createElement("span");
      row.appendChild(counter);
      [0.08, 0.2, 0.45, 0.7, 1].forEach(function (step, index) {
        later(function () { counter.textContent = Math.round(total * step) + "M"; }, index * 45);
      });
    }
    if (line[2]) {
      const ok = doc.createElement("span");
      ok.className = "is-ok";
      ok.textContent = " [ " + line[2] + " ]";
      if (line[3]) later(function () { biosEl.insertBefore(ok, row.nextSibling); }, 240);
      else biosEl.appendChild(ok);
    }
    biosEl.appendChild(doc.createTextNode("\n"));
    sfx("type");
  }

  function popIcons() {
    if (reduceMotion || !iconGrid) return;
    Array.from(iconGrid.querySelectorAll(".os-icon")).forEach(function (icon, index) {
      if (!visible(icon)) return;
      animate(icon, [
        { transform: "scale(0.4)", opacity: 0 },
        { transform: "scale(1.08)", opacity: 1, offset: 0.7 },
        { transform: "scale(1)", opacity: 1 }
      ], { duration: 420, delay: index * 45, easing: EASE_OUT, fill: "backwards" });
    });
  }

  function runBoot(opts) {
    opts = opts || {};
    if (bootState === "booting" || !bootEl) return;
    writeStore("session", BOOT_KEY, "1");
    closeMenus(false);
    if (reduceMotion) {
      bootState = "booting";
      finishBoot();
      return;
    }
    bootState = "booting";
    hideTips(false);
    desktop.classList.remove("is-preboot");
    desktop.classList.add("is-booting");
    bootEl.classList.remove("is-logo", "is-exiting");
    bootEl.classList.add("is-bios");
    if (biosEl) biosEl.textContent = "";
    sfx("boot");
    const lines = opts.short ? [BIOS[0], BIOS[4], BIOS[7]] : BIOS;
    let t = 160;
    lines.forEach(function (line) {
      later(function () { appendBios(line); }, t);
      t += opts.short ? 130 : 160;
    });
    later(function () {
      bootEl.classList.remove("is-bios");
      bootEl.classList.add("is-logo");
    }, t + 220);
    later(finishBoot, t + 220 + 1150);
  }

  function finishBoot() {
    if (bootState === "idle") return;
    const skippedFromStandby = bootState === "preboot";
    bootTimers.forEach(function (timer) { window.clearTimeout(timer); });
    bootTimers = [];
    bootState = "idle";
    if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
    writeStore("session", BOOT_KEY, "1");
    desktop.classList.remove("is-preboot");
    if (reduceMotion || skippedFromStandby || !bootEl) {
      desktop.classList.remove("is-booting");
      if (bootEl) bootEl.classList.remove("is-bios", "is-logo", "is-exiting");
    } else {
      bootEl.classList.add("is-exiting");
      window.setTimeout(function () {
        if (bootState !== "idle") return;
        desktop.classList.remove("is-booting");
        bootEl.classList.remove("is-bios", "is-logo", "is-exiting");
      }, 380);
    }
    if (mode === "desktop" && pendingRearrange) {
      pendingRearrange = false;
      arrange(false);
    }
    if (!skippedFromStandby) {
      sfx("powerup");
      popIcons();
      replayEntrance();
      announce("JB//OS is ready");
    }
    scheduleTips(skippedFromStandby ? 900 : 1900);
  }

  function watchDesktop() {
    if (!("IntersectionObserver" in window)) {
      if (bootState === "preboot") runBoot(); else scheduleTips(1200);
      return;
    }
    viewObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        const needed = Math.min(entry.boundingClientRect.height, window.innerHeight) * 0.4;
        if (entry.intersectionRect.height < needed) return;
        if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
        if (bootState === "preboot") runBoot(); else scheduleTips(1200);
      });
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8] });
    viewObserver.observe(desktop);
  }

  if (bootEl) {
    bootEl.addEventListener("pointerdown", function () {
      if (bootState === "preboot") runBoot();
      else if (bootState === "booting") finishBoot();
    });
  }

  desktop.addEventListener("focusin", function () {
    if (bootState !== "idle") finishBoot();
  });

  /* ------------------------------------------------------------ shut down */
  function setPowerMessage(main, sub) {
    if (!powerMsg) return;
    powerMsg.textContent = main;
    if (sub) {
      const small = doc.createElement("b");
      small.textContent = sub;
      powerMsg.appendChild(small);
    }
    powerMsg.style.animation = "none";
    void powerMsg.offsetWidth;
    powerMsg.style.animation = "";
  }

  function shutDown() {
    if (mode !== "desktop" || bootState !== "idle" || poweringDown) return;
    poweringDown = true;
    const focusInMenu = startMenu && startMenu.contains(doc.activeElement);
    closeMenus(false);
    if (focusInMenu) focusNoScroll(startButton);
    hideTips(false);
    sfx("close");
    announce("JB//OS is shutting down. It will reboot in a moment.");
    setPowerMessage("Shutting down JB//OS…", "Saving 0 unsaved files");
    desktop.classList.add("is-shutdown");
    window.setTimeout(function () {
      setPowerMessage("It’s now safe to turn off your computer.", "(Please don’t. Rebooting…)");
    }, reduceMotion ? 600 : 1500);
    window.setTimeout(function () {
      desktop.classList.remove("is-shutdown");
      poweringDown = false;
      pendingRearrange = true;
      if (reduceMotion) {
        bootState = "booting";
        finishBoot();
      } else {
        runBoot({ short: true });
      }
    }, reduceMotion ? 1800 : 3400);
  }

  /* ------------------------------------------------------------ assistant */
  const TIPS = [
    { text: "It looks like you’re evaluating a candidate. Want the highlights?", label: "Show experience", cmd: "open:experience" },
    { text: "Drag windows by the title bar. Double-click it to maximise, or click a taskbar button to minimise." },
    { text: "Right-click the wallpaper for new wallpapers and a very professional “New folder” button." },
    { text: "Press ` (backtick) anywhere for the real terminal, then try “os help”." },
    { text: "The trash is full. Don’t look. (Look.)", label: "Open trash", cmd: "open:trash" },
    { text: "Start → Shut down… is perfectly safe. Probably." }
  ];
  const tipText = tipsEl ? tipsEl.querySelector("[data-os-tip-text]") : null;
  const tipAction = tipsEl ? tipsEl.querySelector("[data-os-tip-action]") : null;
  const buddy = band.querySelector("[data-os-buddy]");
  let tipIndex = 0;
  let tipsTimer = 0;
  let collapseTimer = 0;

  function tipsAllowed() {
    return Boolean(tipsEl) && mode === "desktop" && readStore("session", TIPS_KEY) !== "off";
  }

  function tipsOpen() {
    return Boolean(tipsEl) && !tipsEl.hidden && !tipsEl.classList.contains("is-out");
  }

  // Balloon tips fold back into the tray after a while, unless someone is reading them.
  function scheduleCollapse(ms) {
    window.clearTimeout(collapseTimer);
    collapseTimer = window.setTimeout(function () {
      if (!tipsOpen()) return;
      if (tipsEl.matches(":hover") || tipsEl.contains(doc.activeElement)) { scheduleCollapse(3000); return; }
      hideTips(false);
    }, ms);
  }

  function showTip(tip, toastIfHidden) {
    if (!tipsEl || !tipText || mode !== "desktop") return;
    tipText.textContent = tip.text;
    if (tipAction) {
      tipAction.hidden = !tip.cmd;
      tipAction.textContent = tip.label || "";
      tipAction.setAttribute("data-cmd", tip.cmd || "");
    }
    if (!tipsOpen()) {
      tipsEl.hidden = false;
      tipsEl.classList.remove("is-out");
      tipsEl.classList.add("is-in");
      sfx("pop");
    } else {
      animate(tipText, [
        { clipPath: "inset(0 100% 0 0)", opacity: 0.4 },
        { clipPath: "inset(0 0 0 0)", opacity: 1 }
      ], { duration: 360, easing: "steps(8, end)" });
    }
    if (buddy) buddy.setAttribute("aria-expanded", "true");
    if (visible(tipsEl)) announce("Assistant: " + tip.text);
    else if (toastIfHidden) toast(tip.text);
    scheduleCollapse(12000);
  }

  function hideTips(remember) {
    window.clearTimeout(tipsTimer);
    window.clearTimeout(collapseTimer);
    if (remember) writeStore("session", TIPS_KEY, "off");
    if (buddy) buddy.setAttribute("aria-expanded", "false");
    if (!tipsEl || tipsEl.hidden) return;
    const hadFocus = tipsEl.contains(doc.activeElement);
    if (reduceMotion) {
      tipsEl.hidden = true;
    } else {
      tipsEl.classList.remove("is-in");
      tipsEl.classList.add("is-out");
      window.setTimeout(function () {
        if (tipsEl.classList.contains("is-out")) {
          tipsEl.hidden = true;
          tipsEl.classList.remove("is-out");
        }
      }, 260);
    }
    if (hadFocus) focusNoScroll(buddy && visible(buddy) ? buddy : startButton);
  }

  function scheduleTips(delay) {
    if (!tipsAllowed()) return;
    window.clearTimeout(tipsTimer);
    tipsTimer = window.setTimeout(function () {
      if (!tipsAllowed() || bootState !== "idle" || poweringDown) return;
      tipIndex = 0;
      showTip(TIPS[0]);
    }, delay);
  }

  function summonAssistant() {
    if (mode !== "desktop") return;
    writeStore("session", TIPS_KEY, "on");
    const seenOne = tipsOpen() || Boolean(tipText && tipText.textContent);
    tipIndex = seenOne ? (tipIndex + 1) % TIPS.length : 0;
    showTip(TIPS[tipIndex], true);
  }

  if (tipsEl) {
    tipsEl.addEventListener("click", function (event) {
      if (event.target.closest("[data-os-tip-close]")) { sfx("close"); hideTips(true); return; }
      if (event.target.closest("[data-os-tip-next]")) {
        sfx("click");
        tipIndex = (tipIndex + 1) % TIPS.length;
        showTip(TIPS[tipIndex]);
        return;
      }
      const action = event.target.closest("[data-os-tip-action]");
      if (action) {
        runCommand(action.getAttribute("data-cmd"));
        hideTips(false);
      }
    });
  }

  if (buddy) {
    buddy.addEventListener("click", function () {
      if (tipsOpen()) { sfx("close"); hideTips(false); }
      else summonAssistant();
    });
  }

  // The tray buddy's eyes follow the pointer around the desktop (fine pointers only).
  const eyes = band.querySelector("[data-os-eyes]");
  if (eyes && !reduceMotion && JBOS.finePointer) {
    let eyeFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    band.addEventListener("pointermove", function (event) {
      if (mode !== "desktop") return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (eyeFrame) return;
      eyeFrame = window.requestAnimationFrame(function () {
        eyeFrame = 0;
        const r = eyes.getBoundingClientRect();
        if (!r.width) return;
        const dx = pointerX - (r.left + r.width / 2);
        const dy = pointerY - (r.top + r.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1.8, distance / 50);
        eyes.style.transform = "translate(calc(-50% + " + (dx / distance * reach).toFixed(2) + "px), " + (dy / distance * reach).toFixed(2) + "px)";
      });
    }, { passive: true });
  }

  /* ------------------------------------------------------- window extras */
  const diagButton = band.querySelector("[data-os-diagnostic]");
  const diagOut = band.querySelector("[data-os-diagnostic-out]");
  if (diagButton && diagOut) {
    diagButton.addEventListener("click", function () {
      const names = Array.from(band.querySelectorAll(".os-meter__name")).map(function (el) { return el.textContent.trim(); });
      const final = names.length + " processes · 0 errors · 1 warning:\nHTML is not a programming language (counted it anyway).";
      const skills = wins.get("skills");
      if (skills) fresh(skills);
      sfx("click");
      if (reduceMotion) { diagOut.textContent = final; return; }
      diagButton.disabled = true;
      diagOut.textContent = "Scanning " + names.length + " processes…";
      window.setTimeout(function () { diagOut.textContent = names.map(function (name) { return name + " ✓"; }).join("  "); }, 800);
      window.setTimeout(function () {
        diagOut.textContent = final;
        diagButton.disabled = false;
        sfx("success");
      }, 1700);
    });
  }

  const dbInput = band.querySelector("[data-os-db-filter]");
  const dbRows = Array.from(band.querySelectorAll("[data-os-db-rows] tr"));
  const dbCount = band.querySelector("[data-os-db-count]");
  if (dbInput) {
    dbInput.addEventListener("input", function () {
      const query = dbInput.value.trim().toLowerCase();
      let shown = 0;
      dbRows.forEach(function (row) {
        const match = !query || row.textContent.toLowerCase().indexOf(query) !== -1;
        row.hidden = !match;
        if (match) shown += 1;
      });
      dbInput.style.width = Math.max(4, dbInput.value.length + 1) + "ch";
      if (dbCount) dbCount.textContent = "(" + shown + (shown === 1 ? " row)" : " rows)") + (shown ? "" : " · try “learning”");
    });
  }

  const trashButton = band.querySelector("[data-os-trash-action]");
  const trashOut = band.querySelector("[data-os-trash-out]");
  const trashFiles = band.querySelector("[data-os-trash-files]");
  const trashEmpty = band.querySelector("[data-os-trash-empty]");
  const trashMeta = band.querySelector("[data-os-trash-meta]");
  const trashGlyph = band.querySelector(".os-glyph--trash");
  let trashTries = 0;

  function shake(el) {
    if (reduceMotion) return;
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
    window.setTimeout(function () { el.classList.remove("is-shaking"); }, 450);
  }

  if (trashButton && trashFiles) {
    const itemCount = trashFiles.children.length;
    trashButton.addEventListener("click", function () {
      const trash = wins.get("trash");
      if (trashButton.getAttribute("data-state") === "empty") {
        trashButton.removeAttribute("data-state");
        trashButton.textContent = "Empty trash";
        trashFiles.hidden = false;
        if (trashEmpty) trashEmpty.hidden = true;
        if (trashMeta) trashMeta.textContent = itemCount + " items";
        if (trashGlyph) trashGlyph.classList.remove("is-empty");
        if (trashOut) trashOut.textContent = "Restored " + itemCount + " items. They missed you.";
        trashTries = 0;
        sfx("success");
        return;
      }
      trashTries += 1;
      if (trashTries < 3) {
        if (trashOut) {
          trashOut.textContent = trashTries === 1
            ? "Error 0x7E45H: these files are load-bearing. Trash not emptied."
            : "Error 0x7E45H again. Have you tried asking nicely?";
        }
        sfx("error");
        if (trash) shake(trash.el);
        return;
      }
      trashFiles.hidden = true;
      if (trashEmpty) trashEmpty.hidden = false;
      trashButton.setAttribute("data-state", "empty");
      trashButton.textContent = "Restore everything";
      if (trashMeta) trashMeta.textContent = "0 items";
      if (trashGlyph) trashGlyph.classList.add("is-empty");
      if (trashOut) trashOut.textContent = "Fine. " + itemCount + " items deleted forever. (They live on in git history.)";
      sfx("whoosh");
    });
    trashFiles.addEventListener("click", function (event) {
      if (event.target.closest("summary")) sfx("click");
    });
  }

  /* --------------------------------------------------------- clock + tray */
  const clockEls = Array.from(band.querySelectorAll("[data-os-clock]"));
  const clockButton = band.querySelector("[data-os-clock-button]");
  const coffeeEls = Array.from(band.querySelectorAll("[data-os-coffee]"));
  let clockFormat = null;
  try { clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }); } catch (error) { clockFormat = null; }

  function tick() {
    const now = new Date();
    const text = clockFormat ? clockFormat.format(now) : now.getHours() + ":" + String(now.getMinutes()).padStart(2, "0");
    clockEls.forEach(function (el) {
      if (el.textContent === text) return;
      el.textContent = text;
      el.setAttribute("datetime", now.toISOString());
    });
    if (clockButton) clockButton.setAttribute("aria-label", "Clock: " + text + ". Show date and uptime");
  }
  tick();
  window.setInterval(tick, 5000);

  if (clockButton) {
    clockButton.addEventListener("click", function () {
      const now = new Date();
      let date = now.toDateString();
      let ithaca = "";
      try {
        date = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now);
        ithaca = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(now);
      } catch (error) { /* older engines */ }
      const up = Math.round((Date.now() - bootedAt) / 60000);
      toast(date + (ithaca ? " · Ithaca " + ithaca + " ET" : "") + " · uptime " + up + " min");
      sfx("click");
    });
  }

  let coffee = 87;
  window.setInterval(function () {
    if (coffee <= 0) return;
    coffee -= 1;
    coffeeEls.forEach(function (el) { el.textContent = coffee ? coffee + "%" : "refill"; });
    if (!coffee) toast("Caffeine critically low. JB//OS is running on vibes.");
  }, 45000);

  /* ------------------------------------------------------------- keyboard */
  doc.addEventListener("keydown", function (event) {
    if (bootState === "booting" && !isTyping(event.target) && !foreignDialogOpen() && !event.metaKey && !event.ctrlKey && !event.altKey) {
      finishBoot();
      return;
    }
    if (event.key === "Tab") {
      if (!foreignDialogOpen()) trapSheetFocus(event);
      return;
    }
    if (event.key !== "Escape" || foreignDialogOpen()) return;
    if (contextMenu && !contextMenu.hidden) { event.preventDefault(); closeContext(false); return; }
    if (startMenu && !startMenu.hidden) { event.preventDefault(); closeStart(true); return; }
    if (isTyping(event.target)) return;
    if (sheetWin) { event.preventDefault(); closeSheet(sheetWin); return; }
    const win = band.contains(event.target) ? winFrom(event.target) : null;
    if (win && win.state === "open") {
      event.preventDefault();
      closeWindow(win);
    }
  });

  /* ------------------------------------------------ layout + mode changes */
  function measureIcons() {
    if (mode !== "desktop" || !iconGrid) return;
    const box = desktop.getBoundingClientRect();
    let right = 0;
    Array.from(iconGrid.children).forEach(function (item) {
      if (item.hidden) return;
      const rect = item.getBoundingClientRect();
      if (rect.width) right = Math.max(right, rect.right - box.left);
    });
    if (right) desktop.style.setProperty("--os-ws-left", Math.round(right + 18) + "px");
  }

  function resetWindows() {
    closeMenus(false);
    if (sheetWin) {
      sheetWin = null;
      band.classList.remove("has-sheet");
      syncDialogState();
    }
    wins.forEach(function (win) {
      cancelAnimations(win.el);
      win.el.classList.remove("is-open", "is-active", "is-maximized", "is-dragging", "is-fresh", "is-pinged");
      win.el.removeAttribute("style");
      win.el.setAttribute("aria-modal", "false");
      win.state = "closed";
      win.maximized = false;
      win.restore = null;
      win.w = 0;
      removeTask(win, true);
      setMaxLabel(win);
    });
    activeWin = null;
  }

  function onModeChange() {
    const next = phoneQuery.matches ? "phone" : "desktop";
    if (next === mode) return;
    resetWindows();
    hideTips(false);
    mode = next;
    desktop.setAttribute("data-os-mode", mode);
    if (mode === "desktop") {
      measureIcons();
      arrange(false);
    }
  }

  if (phoneQuery.addEventListener) phoneQuery.addEventListener("change", onModeChange);
  else if (phoneQuery.addListener) phoneQuery.addListener(onModeChange);

  let resizeFrame = 0;
  let lastBounds = { W: 0, H: 0 };
  window.addEventListener("resize", function () {
    if (resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(function () {
      resizeFrame = 0;
      if (mode !== "desktop") return;
      measureIcons();
      const b = bounds();
      if (b.W === lastBounds.W && b.H === lastBounds.H) return;
      lastBounds = b;
      if (!userArranged) { arrange(false); return; }
      wins.forEach(function (win) {
        if (win.state === "closed") return;
        if (win.maximized) { win.x = 0; win.y = 0; win.w = b.W; win.h = b.H; }
        fit(win);
        if (win.state === "open") apply(win);
      });
    });
  }, { passive: true });

  /* ---------------------------------------------- terminal + theme hooks */
  function goToDesktop(then) {
    window.setTimeout(function () {
      const terminal = window.JBOS && window.JBOS.terminal;
      if (terminal && typeof terminal.close === "function") terminal.close();
      desktop.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: mode === "desktop" ? "end" : "start" });
      if (bootState !== "idle") finishBoot();
      window.setTimeout(then, reduceMotion ? 0 : 560);
    }, 380);
  }

  if (typeof JBOS.registerCommand === "function") {
    JBOS.registerCommand("os", {
      help: "drive the JB//OS desktop below the hero (os help)",
      run: function (args) {
        const terminal = window.JBOS && window.JBOS.terminal;
        const print = function (text, accent) { if (terminal && terminal.print) terminal.print(text, accent); };
        const sub = String(args[0] || "help").toLowerCase();
        const target = String(args[1] || "").toLowerCase().replace(/\.(txt|log|exe|db)$/, "");
        if (sub === "help") {
          print("os open <about|experience|skills|coursework|trash> · os ps · os tile · os wallpaper · os reboot", true);
        } else if (sub === "ps") {
          wins.forEach(function (win) { print((win.title + "                ").slice(0, 16) + win.state.toUpperCase()); });
        } else if (sub === "open") {
          if (!wins.has(target)) { print("os: no such app '" + (args[1] || "") + "'. Try: os open about"); return; }
          print("Launching " + wins.get(target).title + "…", true);
          goToDesktop(function () { openById(target, { focus: true }); });
        } else if (sub === "tile") {
          if (mode !== "desktop") { print("os: tile needs a bigger screen. Your phone is already very tidy."); return; }
          print("Tidying windows…", true);
          goToDesktop(tidyUp);
        } else if (sub === "wallpaper") {
          const next = setWallpaper(wallpaperIndex + 1, true);
          if (next) print("Wallpaper → " + next.label, true);
        } else if (sub === "reboot" || sub === "shutdown") {
          print("Rebooting JB//OS…", true);
          goToDesktop(function () {
            if (mode === "desktop") shutDown(); else runBoot({ short: true });
          });
        } else {
          print("os: unknown command '" + sub + "'. Try: os help");
        }
      }
    });
  }

  if (typeof JBOS.on === "function") {
    JBOS.on("theme-change", function (detail) {
      const theme = detail && detail.theme ? String(detail.theme) : "default";
      const quips = {
        default: "Back to paper, ink and acid. A classic.",
        crt: "CRT mode. Please sit at least two feet from the internet.",
        synthwave: "Synthwave detected. Desktop now 40% more 1986."
      };
      if (tipsOpen()) showTip({ text: "Theme → " + theme.toUpperCase() + ". " + (quips[theme] || "Repainting every pixel by hand…") });
    });
  }

  /* ----------------------------------------------------------------- init */
  band.querySelectorAll("[data-os-js]").forEach(function (el) { el.hidden = false; });
  const savedWallpaper = readStore("local", WALL_KEY);
  const savedIndex = WALLPAPERS.map(function (paper) { return paper.id; }).indexOf(savedWallpaper);
  setWallpaper(savedIndex >= 0 ? savedIndex : 0, false);
  desktop.classList.add("os-on");
  desktop.setAttribute("data-os-mode", mode);
  if (mode === "desktop") {
    measureIcons();
    arrange(false);
    lastBounds = bounds();
  }
  if (!reduceMotion && !readStore("session", BOOT_KEY)) {
    bootState = "preboot";
    desktop.classList.add("is-preboot");
  } else {
    writeStore("session", BOOT_KEY, "1");
  }
  watchDesktop();
})();
