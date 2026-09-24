(function () {
  "use strict";

  // JB//OS display modes. The inline script in _includes/head.html applies the saved
  // theme before first paint; this module owns everything after that: the header
  // switcher, the `theme` terminal command, the reveal transition and the flourishes.

  const doc = document;
  const root = doc.documentElement;
  const JBOS = window.JBOS = window.JBOS || {};
  const STORAGE_KEY = "jb-theme";
  const LEGACY_KEY = "jb-crt";
  const REVEAL_MS = 860;
  const motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  const THEMES = [
    {
      id: "default",
      name: "Default",
      blurb: "Paper, ink & acid",
      color: "#e9e8e1",
      scheme: "light",
      hold: 1000,
      toast: "THEME // JB//OS DEFAULT · PAPER RELOADED",
      log: [
        "RESTORING FACTORY PALETTE… OK",
        "PAPER #F7F5EE · INK #11110F · ACID #D9FF43",
        "WELCOME BACK TO DAYLIGHT."
      ]
    },
    {
      id: "crt",
      name: "Retro CRT",
      blurb: "Amber phosphor tube",
      color: "#0d0904",
      scheme: "dark",
      hold: 1450,
      toast: "THEME // RETRO CRT · WARMING UP THE PHOSPHOR",
      log: [
        "DEGAUSSING TUBE… *THOONK* OK",
        "PHOSPHOR P3 AMBER · REFRESH 60HZ",
        "SCANLINES: SOFT · GREEN TINT: DENIED"
      ]
    },
    {
      id: "synthwave",
      name: "Synthwave",
      blurb: "Neon grid at midnight",
      color: "#0d0524",
      scheme: "dark",
      hold: 1800,
      toast: "THEME // SYNTHWAVE · CHROME POLISHED, SUN SETTING",
      log: [
        "LOADING OUTRUN.DRV… OK",
        "SUN: SETTING · GRID: ∞ · NEON: 110%",
        "ENJOY THE MIDNIGHT DRIVE."
      ]
    }
  ];

  const ALIASES = {
    "default": "default",
    "light": "default",
    "paper": "default",
    "normal": "default",
    "reset": "default",
    "off": "default",
    "day": "default",
    "crt": "crt",
    "retro": "crt",
    "amber": "crt",
    "phosphor": "crt",
    "tube": "crt",
    "synthwave": "synthwave",
    "synth": "synthwave",
    "outrun": "synthwave",
    "retrowave": "synthwave",
    "vaporwave": "synthwave",
    "neon": "synthwave",
    "night": "synthwave"
  };

  // Menu typeahead: first letters of each option (plus "c" for CRT).
  const TYPEAHEAD = { d: "default", r: "crt", c: "crt", s: "synthwave" };

  /* ---------- Small helpers ---------- */
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* storage blocked */ }
  }

  function dropStore(key) {
    try { window.localStorage.removeItem(key); } catch (error) { /* storage blocked */ }
  }

  function byId(id) {
    for (let index = 0; index < THEMES.length; index += 1) {
      if (THEMES[index].id === id) return THEMES[index];
    }
    return null;
  }

  function resolve(name) {
    const key = String(name == null ? "" : name).trim().toLowerCase();
    return byId(ALIASES[key] || key);
  }

  function current() {
    const attribute = root.getAttribute("data-theme");
    return attribute && byId(attribute) ? attribute : "default";
  }

  function indexOfTheme(id) {
    for (let index = 0; index < THEMES.length; index += 1) {
      if (THEMES[index].id === id) return index;
    }
    return 0;
  }

  function neighbour(step, from) {
    const index = indexOfTheme(from || current());
    return THEMES[(index + step + THEMES.length) % THEMES.length].id;
  }

  function randomOther(from) {
    const active = from || current();
    const pool = THEMES.filter(function (theme) { return theme.id !== active; });
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  function reducedMotion() {
    return motionQuery ? motionQuery.matches : Boolean(JBOS.reduceMotion);
  }

  function play(name) {
    if (JBOS.sound && typeof JBOS.sound.play === "function") {
      try { JBOS.sound.play(name); } catch (error) { /* sound is optional */ }
    }
  }

  function emit(type, detail) {
    if (typeof JBOS.emit === "function") JBOS.emit(type, detail);
  }

  // "jb-crt" was the old on/off CRT flag; carry it over once, then drop it.
  function migrateLegacy() {
    const legacy = readStore(LEGACY_KEY);
    if (legacy === null) return;
    if (legacy === "on" && !readStore(STORAGE_KEY)) writeStore(STORAGE_KEY, "crt");
    dropStore(LEGACY_KEY);
  }

  function ensureMeta(name) {
    let meta = doc.querySelector('meta[name="' + name + '"]');
    if (!meta) {
      meta = doc.createElement("meta");
      meta.setAttribute("name", name);
      doc.head.appendChild(meta);
    }
    return meta;
  }

  function syncMeta(theme) {
    ensureMeta("theme-color").setAttribute("content", theme.color);
    ensureMeta("color-scheme").setAttribute("content", theme.scheme);
  }

  /* ---------- Synthwave scene: a fixed layer behind all content ---------- */
  let scene = null;
  function ensureScene(id) {
    if (id !== "synthwave" || scene || !doc.body) return;
    scene = doc.createElement("div");
    scene.className = "theme-scene";
    scene.setAttribute("aria-hidden", "true");
    scene.innerHTML =
      '<div class="theme-scene__stars"></div>' +
      '<div class="theme-scene__sun"></div>' +
      '<div class="theme-scene__ridge"></div>' +
      '<div class="theme-scene__horizon"></div>' +
      '<div class="theme-scene__floor"><div class="theme-scene__grid"></div></div>';
    doc.body.insertBefore(scene, doc.body.firstChild);
  }

  /* ---------- Header switcher ---------- */
  const switcher = doc.querySelector("[data-theme-switcher]");
  const menuButton = switcher ? switcher.querySelector("[data-theme-button]") : null;
  const popover = switcher ? switcher.querySelector("[data-theme-popover]") : null;
  const menu = popover ? popover.querySelector('[role="menu"]') : null;
  const options = switcher ? Array.prototype.slice.call(switcher.querySelectorAll("[data-theme-option]")) : [];
  const currentLabel = switcher ? switcher.querySelector("[data-theme-current]") : null;
  const hasMenu = Boolean(switcher && menuButton && popover && menu && options.length);

  function syncUI(id) {
    const theme = byId(id) || THEMES[0];
    if (currentLabel) currentLabel.textContent = theme.name;
    if (switcher) switcher.setAttribute("data-active-theme", theme.id);
    options.forEach(function (option) {
      option.setAttribute("aria-checked", String(option.getAttribute("data-theme-option") === theme.id));
    });
  }

  let swatchTimer = 0;
  function spinSwatch() {
    if (!switcher || reducedMotion()) return;
    switcher.classList.remove("is-switching");
    void switcher.offsetWidth;
    switcher.classList.add("is-switching");
    window.clearTimeout(swatchTimer);
    swatchTimer = window.setTimeout(function () { switcher.classList.remove("is-switching"); }, 950);
  }

  /* ---------- Flourishes ---------- */
  let enterTimer = 0;
  let powerTimer = 0;

  // The tube is a manual popover where the Popover API exists, so it renders in the top
  // layer, above any open modal (terminal, lightbox, reader): switching on a CRT blanks
  // the whole screen, not just the page behind the dialog. Otherwise it is a fixed layer.
  function powerOn() {
    const stale = doc.querySelector(".theme-power");
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    const tube = doc.createElement("div");
    tube.className = "theme-power";
    tube.setAttribute("aria-hidden", "true");
    tube.appendChild(doc.createElement("i"));
    const topLayer = typeof tube.showPopover === "function";
    if (topLayer) tube.setAttribute("popover", "manual");
    doc.body.appendChild(tube);
    if (topLayer) {
      try { tube.showPopover(); } catch (error) { tube.removeAttribute("popover"); }
    }
    window.clearTimeout(powerTimer);
    powerTimer = window.setTimeout(function () {
      if (tube.parentNode) tube.parentNode.removeChild(tube);
    }, 1400);
  }

  function playFlourish(id) {
    root.classList.remove("theme-enter");
    void root.offsetWidth;
    root.classList.add("theme-enter");
    window.clearTimeout(enterTimer);
    enterTimer = window.setTimeout(function () { root.classList.remove("theme-enter"); }, 1950);
    if (id === "crt") powerOn();
  }

  /* ---------- Transition: circular reveal, crossfade fallback ---------- */
  let activeTransition = null;
  let crossfadeTimer = 0;

  function originPoint(origin) {
    if (origin && typeof origin.getBoundingClientRect === "function") {
      const rect = origin.getBoundingClientRect();
      if (rect.width || rect.height) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    if (origin && isFinite(origin.x) && isFinite(origin.y)) return { x: Number(origin.x), y: Number(origin.y) };
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  function crossfade(commit) {
    root.classList.add("theme-crossfade");
    // Flush styles so the transition rules are live before the palette changes.
    void window.getComputedStyle(root).color;
    commit();
    window.clearTimeout(crossfadeTimer);
    crossfadeTimer = window.setTimeout(function () { root.classList.remove("theme-crossfade"); }, 640);
  }

  function reveal(commit, origin) {
    if (activeTransition && typeof activeTransition.skipTransition === "function") {
      try { activeTransition.skipTransition(); } catch (error) { /* already finished */ }
    }

    if (typeof doc.startViewTransition !== "function" || doc.visibilityState === "hidden") {
      crossfade(commit);
      return;
    }

    const point = originPoint(origin);
    let transition;
    root.classList.add("theme-vt");
    try {
      transition = doc.startViewTransition(commit);
    } catch (error) {
      root.classList.remove("theme-vt");
      crossfade(commit);
      return;
    }
    activeTransition = transition;

    transition.ready.then(function () {
      const radius = Math.hypot(
        Math.max(point.x, window.innerWidth - point.x),
        Math.max(point.y, window.innerHeight - point.y)
      ) + 24;
      const at = " at " + point.x + "px " + point.y + "px)";
      root.animate(
        { clipPath: ["circle(0px" + at, "circle(" + radius + "px" + at] },
        { duration: REVEAL_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "both", pseudoElement: "::view-transition-new(root)" }
      );
      root.animate(
        { filter: ["brightness(1) saturate(1)", "brightness(0.45) saturate(0.8)"] },
        { duration: REVEAL_MS, easing: "ease-in", fill: "both", pseudoElement: "::view-transition-old(root)" }
      );
    }).catch(function () { /* skipped or unsupported: the DOM update still ran */ });

    transition.finished.catch(function () {}).then(function () {
      if (activeTransition !== transition) return;
      activeTransition = null;
      root.classList.remove("theme-vt");
    });
  }

  /* ---------- Apply ---------- */
  // options: { origin: Element | {x, y}, source: string, quiet: bool, persist: bool, toast: bool }
  function setTheme(name, options) {
    const settings = options || {};
    const theme = resolve(name);
    if (!theme) return false;
    const previous = current();

    if (settings.persist !== false) writeStore(STORAGE_KEY, theme.id);
    if (theme.id === previous) {
      syncUI(previous);
      return false;
    }

    const quiet = Boolean(settings.quiet);
    const animate = !quiet && !reducedMotion();

    function commit() {
      if (theme.id === "default") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", theme.id);
      ensureScene(theme.id);
      syncMeta(theme);
      syncUI(theme.id);
      if (animate) playFlourish(theme.id);
      emit("theme-change", { theme: theme.id, previous: previous, source: settings.source || "api" });
    }

    if (!quiet) {
      play("powerup");
      spinSwatch();
    }

    if (animate) reveal(commit, settings.origin);
    else commit();

    if (!quiet && settings.toast !== false && typeof JBOS.toast === "function") JBOS.toast(theme.toast);
    return true;
  }

  /* ---------- Menu button (WAI-ARIA menu pattern) ---------- */
  let menuOpen = false;
  let hideTimer = 0;

  function checkedIndex() {
    for (let index = 0; index < options.length; index += 1) {
      if (options[index].getAttribute("aria-checked") === "true") return index;
    }
    return 0;
  }

  function focusOption(index) {
    const target = (index + options.length) % options.length;
    options.forEach(function (option, position) {
      option.setAttribute("tabindex", position === target ? "0" : "-1");
    });
    options[target].focus({ preventScroll: true });
  }

  function onOutsidePointer(event) {
    if (!switcher.contains(event.target)) closeMenu(false);
  }

  function openMenu(focusIndex) {
    if (menuOpen) {
      focusOption(typeof focusIndex === "number" ? focusIndex : checkedIndex());
      return;
    }
    menuOpen = true;
    window.clearTimeout(hideTimer);
    popover.hidden = false;
    void popover.offsetHeight;
    popover.classList.add("is-open");
    switcher.classList.add("is-open");
    menuButton.setAttribute("aria-expanded", "true");
    focusOption(typeof focusIndex === "number" ? focusIndex : checkedIndex());
    doc.addEventListener("pointerdown", onOutsidePointer, true);
    play("open");
  }

  function closeMenu(restoreFocus) {
    if (!menuOpen) return;
    menuOpen = false;
    popover.classList.remove("is-open");
    switcher.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    doc.removeEventListener("pointerdown", onOutsidePointer, true);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () {
      if (!menuOpen) popover.hidden = true;
    }, reducedMotion() ? 0 : 220);
    if (restoreFocus) menuButton.focus({ preventScroll: true });
    play("close");
  }

  function chooseOption(option) {
    const id = option.getAttribute("data-theme-option");
    closeMenu(true);
    if (!setTheme(id, { origin: menuButton, source: "menu" })) play("click");
  }

  if (hasMenu) {
    menuButton.addEventListener("click", function () {
      if (menuOpen) closeMenu(false);
      else openMenu();
    });

    menuButton.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openMenu(checkedIndex());
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        openMenu(options.length - 1);
      } else if (event.key === "Escape" && menuOpen) {
        event.preventDefault();
        closeMenu(true);
      }
    });

    menu.addEventListener("keydown", function (event) {
      const index = options.indexOf(doc.activeElement);
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault();
          focusOption(index + 1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          focusOption(index - 1);
          break;
        case "Home":
        case "PageUp":
          event.preventDefault();
          focusOption(0);
          break;
        case "End":
        case "PageDown":
          event.preventDefault();
          focusOption(options.length - 1);
          break;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          closeMenu(true);
          break;
        case "Tab":
          closeMenu(false);
          break;
        default: {
          const target = TYPEAHEAD[event.key.length === 1 ? event.key.toLowerCase() : ""];
          if (!target) return;
          event.preventDefault();
          for (let position = 0; position < options.length; position += 1) {
            if (options[position].getAttribute("data-theme-option") === target) focusOption(position);
          }
        }
      }
    });

    options.forEach(function (option) {
      option.addEventListener("click", function () { chooseOption(option); });
    });

    switcher.addEventListener("focusout", function (event) {
      if (menuOpen && event.relatedTarget && !switcher.contains(event.relatedTarget)) closeMenu(false);
    });
  }

  /* ---------- Terminal: `theme` ---------- */
  function print(text, accent) {
    return JBOS.terminal && typeof JBOS.terminal.print === "function" ? JBOS.terminal.print(text, accent) : null;
  }

  function pad(text, width) {
    let output = text;
    while (output.length < width) output += " ";
    return output;
  }

  function settle(done) {
    if (typeof done === "function") done();
  }

  // The mode's boot log, left in the terminal's history.
  function printLog(theme) {
    theme.log.forEach(function (text) { print("  " + text, "theme-term-item"); });
  }

  /* ---------- Terminal: a switch exits the terminal ---------- */
  // The terminal is a modal <dialog> over a dimmed, blurred ::backdrop, and the reveal, the
  // synthwave scene and the page flourishes all render underneath it. So a switch picked or
  // typed there closes the terminal and then plays in plain view: the reveal radiates from
  // where the terminal sat, and the usual toast follows. The boot log stays in the terminal's
  // history for the next time it opens.
  function openTerminalDialog() {
    const dialog = JBOS.terminal && JBOS.terminal.element;
    return dialog && dialog.open ? dialog : null;
  }

  function exitTerminal() {
    const dialog = openTerminalDialog();
    if (!dialog) return;
    if (JBOS.terminal && typeof JBOS.terminal.close === "function") JBOS.terminal.close();
    else dialog.close();
  }

  function switchAndExit(theme) {
    printLog(theme);
    const dialog = openTerminalDialog();
    if (!dialog) {
      setTheme(theme.id, { source: "terminal" });
      return;
    }
    const rect = dialog.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    let started = false;
    // Start once the dialog's close handlers have run (backdrop gone, page unlocked).
    function go() {
      if (started) return;
      started = true;
      window.requestAnimationFrame(function () {
        setTheme(theme.id, { source: "terminal", origin: origin });
      });
    }
    dialog.addEventListener("close", go, { once: true });
    exitTerminal();
    window.setTimeout(go, 120);
  }

  // Typed switches (`theme crt`, `theme next`, …): nothing to wait for, the terminal closes.
  function switchFromTerminal(id, preface) {
    const theme = byId(id);
    if (!theme) return null;
    if (theme.id === current()) {
      print("Already running " + theme.name.toUpperCase() + ". Try: theme next");
      return null;
    }
    if (preface) print(preface);
    print("> SWITCHING DISPLAY MODE → " + theme.name.toUpperCase(), true);
    switchAndExit(theme);
    return null;
  }

  /* ---------- Terminal: interactive picker ---------- */
  // `theme` on its own prints the DISPLAY MODES list and makes it live, like a TUI menu:
  // ↑/↓ (or j/k, Home/End) move the ▸ cursor, Enter switches, Esc cancels, and a click
  // (or tap) on a line picks it. Keys are caught in the capture phase on the document, so they
  // never reach the prompt's history recall and Enter never submits the form. Typing, another
  // command or closing the terminal ends it quietly. Only one picker is live at a time; a
  // closed one stays in the log as plain text.
  let picker = null;
  let pickerCount = 0;

  function pickerInput() {
    return JBOS.terminal ? JBOS.terminal.input : null;
  }

  function renderPickItem(theme, index, listId, isActive) {
    const item = doc.createElement("p");
    item.className = "theme-term-item theme-pick__item" + (isActive ? " is-current" : "");
    item.id = listId + "-" + theme.id;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.setAttribute("data-theme-pick", String(index));

    const swatch = doc.createElement("i");
    swatch.className = "theme-term-swatch theme-term-swatch--" + theme.id;
    swatch.setAttribute("aria-hidden", "true");
    item.appendChild(swatch);

    const parts = [
      ["theme-pick__caret", "▸"],
      ["theme-pick__gap", " "],
      ["theme-pick__id", pad(theme.id, 11)],
      ["theme-pick__name", theme.name.toUpperCase()],
      ["theme-pick__blurb", " — " + theme.blurb]
    ];
    if (isActive) parts.push(["theme-pick__tag", "  [ACTIVE]"]);
    parts.forEach(function (part) {
      const span = doc.createElement("span");
      span.className = part[0];
      span.textContent = part[1];
      if (part[0] === "theme-pick__caret" || part[0] === "theme-pick__gap") span.setAttribute("aria-hidden", "true");
      item.appendChild(span);
    });
    return item;
  }

  function highlight(index) {
    if (!picker) return;
    const count = picker.items.length;
    picker.index = ((index % count) + count) % count;
    picker.items.forEach(function (item, position) {
      const selected = position === picker.index;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-selected", String(selected));
    });
    const item = picker.items[picker.index];
    const input = pickerInput();
    if (input) input.setAttribute("aria-activedescendant", item.id);

    // Keep the highlighted line in view if the log has been scrolled.
    const output = JBOS.terminal && JBOS.terminal.output;
    if (output) {
      const box = output.getBoundingClientRect();
      const line = item.getBoundingClientRect();
      if (line.top < box.top) output.scrollTop -= box.top - line.top + 8;
      else if (line.bottom > box.bottom) output.scrollTop += line.bottom - box.bottom + 8;
    }
  }

  function movePicker(step) {
    if (!picker) return;
    highlight(picker.index + step);
    play("tick");
  }

  // Ends the live picker: its lines become plain log text, the key hint goes, the ▸ stays on
  // the chosen line (or on the active one when nothing was chosen). Returns its resolver.
  function closePicker(chosen) {
    const live = picker;
    if (!live) return null;
    picker = null;
    const mark = typeof chosen === "number" ? chosen : live.activeIndex;
    live.list.classList.remove("is-live");
    live.list.removeAttribute("role");
    live.list.removeAttribute("aria-label");
    live.items.forEach(function (item, position) {
      item.classList.remove("is-selected");
      item.classList.toggle("is-chosen", position === mark);
      item.removeAttribute("role");
      item.removeAttribute("aria-selected");
    });
    if (live.hint && live.hint.parentNode) live.hint.parentNode.removeChild(live.hint);
    const input = pickerInput();
    if (input) {
      input.removeAttribute("aria-activedescendant");
      input.removeAttribute("aria-controls");
    }
    return live.resolve;
  }

  // After a pick by keyboard, typing should land in the prompt even if a click on the log
  // had moved focus to the dialog. Touch screens skip this so no keyboard pops up.
  function refocusPrompt() {
    const input = pickerInput();
    if (!input || JBOS.finePointer === false || !openTerminalDialog() || doc.activeElement === input) return;
    input.focus({ preventScroll: true });
  }

  // Quietly ends the picker (another command, typing, the terminal closing).
  function abandonPicker() {
    settle(closePicker());
  }

  function cancelPicker() {
    if (!picker) return;
    const theme = byId(current());
    const done = closePicker();
    print("Cancelled. Still running " + theme.name.toUpperCase() + ".", "theme-term-dim");
    play("close");
    refocusPrompt();
    settle(done);
  }

  // Picking a mode ends the command and exits the terminal, even when it is the one already on.
  function choosePick(index) {
    if (!picker) return;
    const theme = THEMES[index];
    const done = closePicker(index);
    if (!theme || theme.id === current()) {
      print("Already running " + (theme || byId(current())).name.toUpperCase() + ".", "theme-term-dim");
      play("click");
      settle(done);
      exitTerminal();
      return;
    }
    print("> SWITCHING DISPLAY MODE → " + theme.name.toUpperCase(), true);
    settle(done);
    switchAndExit(theme);
  }

  function openPicker() {
    const output = JBOS.terminal && JBOS.terminal.output;
    if (!output) return null;
    abandonPicker();

    const active = current();
    const activeIndex = indexOfTheme(active);
    pickerCount += 1;
    const listId = "theme-pick-" + pickerCount;

    print("DISPLAY MODES", true);
    const list = doc.createElement("div");
    list.className = "theme-pick is-live";
    list.id = listId;
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Display modes");
    const items = THEMES.map(function (theme, index) {
      const item = renderPickItem(theme, index, listId, theme.id === active);
      list.appendChild(item);
      return item;
    });
    output.appendChild(list);
    const hint = print(
      JBOS.finePointer === false
        ? "Tap a mode to switch · or type: theme crt"
        : "↑/↓ move · Enter select · Esc cancel · or click one",
      "theme-term-dim theme-pick__hint"
    );

    return new Promise(function (resolve) {
      picker = { list: list, items: items, hint: hint, index: activeIndex, activeIndex: activeIndex, resolve: resolve };
      const input = pickerInput();
      if (input) input.setAttribute("aria-controls", listId);
      highlight(activeIndex);
      output.scrollTop = output.scrollHeight;
      // Run with the terminal shut (from code, not the prompt): leave a plain list behind.
      if (!openTerminalDialog()) {
        abandonPicker();
        return;
      }

      // Clicking a line keeps focus on the prompt (no blur to <body> inside the modal).
      list.addEventListener("mousedown", function (event) {
        if (picker && picker.list === list && event.target.closest("[data-theme-pick]")) event.preventDefault();
      });
      list.addEventListener("click", function (event) {
        const item = event.target.closest("[data-theme-pick]");
        if (!item || !picker || picker.list !== list) return;
        choosePick(Number(item.getAttribute("data-theme-pick")));
      });
      // The mouse drives the highlight too, like any TUI menu.
      list.addEventListener("pointermove", function (event) {
        if (event.pointerType !== "mouse" || !picker || picker.list !== list) return;
        const item = event.target.closest("[data-theme-pick]");
        if (!item) return;
        const index = Number(item.getAttribute("data-theme-pick"));
        if (index !== picker.index) highlight(index);
      });
    });
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onPickerKey(event) {
    if (!picker || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const dialog = openTerminalDialog();
    const target = event.target;
    // Keys aimed at the terminal: from inside it, or from <body> after a click on plain log text.
    if (!dialog || !(dialog.contains(target) || target === doc.body || target === root)) return;
    const key = event.key;
    const input = pickerInput();
    const empty = !input || !input.value;
    // Escape always backs out of the picker and never reaches the <dialog> (no cancel/close).
    if (key === "Escape") {
      consume(event);
      cancelPicker();
      return;
    }
    // Leave other controls (the close button, a game) alone.
    if (target !== input && target && target.closest && target.closest("button, a, input, textarea, select, canvas, [tabindex]")) return;

    switch (key) {
      case "ArrowDown":
        consume(event);
        movePicker(1);
        return;
      case "ArrowUp":
        consume(event);
        movePicker(-1);
        return;
      case "Home":
      case "PageUp":
        if (!empty) return;
        consume(event);
        highlight(0);
        return;
      case "End":
      case "PageDown":
        if (!empty) return;
        consume(event);
        highlight(picker.items.length - 1);
        return;
      case "Enter":
        // A typed line wins: the picker steps aside and the form submits as usual.
        if (!empty) {
          abandonPicker();
          return;
        }
        consume(event);
        choosePick(picker.index);
        return;
      case "j":
      case "k":
        if (empty) {
          consume(event);
          movePicker(key === "j" ? 1 : -1);
          return;
        }
        abandonPicker();
        return;
      default:
        // Any other character means the visitor is typing a command.
        if (key && key.length === 1) abandonPicker();
    }
  }

  (function wirePicker() {
    const dialog = JBOS.terminal && JBOS.terminal.element;
    const input = pickerInput();
    // Capture on the document runs before the prompt's own listeners (history recall) and
    // before the <dialog> turns Escape into a cancel.
    doc.addEventListener("keydown", onPickerKey, true);
    if (dialog) dialog.addEventListener("close", abandonPicker);
    if (input) {
      input.addEventListener("input", function () {
        if (picker && input.value) abandonPicker();
      });
    }
    if (typeof JBOS.on === "function") JBOS.on("terminal-command", abandonPicker);
  })();

  if (typeof JBOS.registerCommand === "function") {
    JBOS.registerCommand("theme", {
      help: "theme: pick a display mode (or theme crt · synthwave · default · next · random)",
      aliases: ["themes"],
      run: function (args) {
        const raw = String(args && args[0] ? args[0] : "");
        // Flags work too: `theme -crt`, `theme --synthwave`, `theme -next`.
        const arg = raw.toLowerCase().replace(/^-{1,2}(?=[a-z])/, "");

        if (!arg || arg === "list" || arg === "ls" || arg === "status" || arg === "pick" || arg === "menu") {
          return openPicker();
        }
        if (arg === "help" || arg === "-h" || arg === "--help" || arg === "?") {
          print("theme                 pick a mode: ↑/↓ then Enter (or click)", "theme-term-item");
          print("theme <name>          default · crt · synthwave (or -crt, -synthwave)", "theme-term-item");
          print("theme next | prev     cycle through modes", "theme-term-item");
          print("theme random          let fate pick", "theme-term-item");
          return null;
        }

        let target = null;
        let preface = "";
        if (arg === "next" || arg === "cycle" || arg === "toggle") {
          target = neighbour(1, current());
        } else if (arg === "prev" || arg === "previous" || arg === "back") {
          target = neighbour(-1, current());
        } else if (arg === "random" || arg === "shuffle" || arg === "surprise" || arg === "roll") {
          target = randomOther(current());
          preface = "ROLLING THE DICE… ⚄";
        } else {
          const theme = resolve(arg);
          target = theme ? theme.id : null;
        }

        if (!target) {
          print("theme: unknown mode '" + raw + "'. Try: " + THEMES.map(function (theme) { return theme.id; }).join(" · "));
          play("error");
          return null;
        }
        return switchFromTerminal(target, preface);
      }
    });
  }

  /* ---------- Public API for other modules ---------- */
  JBOS.theme = {
    list: THEMES.map(function (theme) {
      return { id: theme.id, name: theme.name, blurb: theme.blurb };
    }),
    current: current,
    set: function (name, options) { return setTheme(name, options); },
    next: function (options) { return setTheme(neighbour(1), options); },
    random: function (options) { return setTheme(randomOther(), options); }
  };

  /* ---------- Boot ---------- */
  migrateLegacy();
  (function init() {
    const stored = readStore(STORAGE_KEY);
    // Clean up an unrecognised stored value so the pre-paint script and this module agree.
    if (stored !== null && !resolve(stored)) writeStore(STORAGE_KEY, "default");
    const active = current();
    ensureScene(active);
    syncMeta(byId(active));
    syncUI(active);
  })();

  // Another tab changed the theme: follow it quietly.
  window.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY) return;
    const theme = resolve(event.newValue) || THEMES[0];
    setTheme(theme.id, { quiet: true, persist: false, source: "storage" });
  });

  // Restored from the back/forward cache after the theme changed elsewhere.
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    const theme = resolve(readStore(STORAGE_KEY)) || THEMES[0];
    if (theme.id !== current()) setTheme(theme.id, { quiet: true, persist: false, source: "restore" });
    if (menuOpen) closeMenu(false);
  });
})();
