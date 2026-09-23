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

  function listThemes() {
    const active = current();
    print("DISPLAY MODES", true);
    THEMES.forEach(function (theme) {
      const isActive = theme.id === active;
      const line = print(
        (isActive ? "▸ " : "  ") + pad(theme.id, 11) + theme.name.toUpperCase() + " — " + theme.blurb + (isActive ? "  [ACTIVE]" : ""),
        "theme-term-item" + (isActive ? " is-current" : "")
      );
      if (line) {
        const swatch = doc.createElement("i");
        swatch.className = "theme-term-swatch theme-term-swatch--" + theme.id;
        swatch.setAttribute("aria-hidden", "true");
        line.insertBefore(swatch, line.firstChild);
      }
    });
    print("usage: theme <default|crt|synthwave> · theme next · theme random", "theme-term-dim");
  }

  function printLog(theme, step) {
    theme.log.forEach(function (text, index) {
      if (!step) {
        print("  " + text, "theme-term-item");
        return;
      }
      window.setTimeout(function () { print("  " + text, "theme-term-item"); }, step * (index + 1));
    });
  }

  /* ---------- Terminal stage ---------- */
  // The terminal is a modal <dialog>: it sits in the top layer over a dimmed, blurred
  // ::backdrop, and the reveal, the synthwave scene and the page flourishes all render
  // underneath it. So a switch typed there is staged: the terminal docks to the bottom
  // edge (title bar still showing, input still focused), the backdrop clears, the switch
  // plays in plain view with the reveal radiating from the docked bar, and the terminal
  // springs back up to print the boot log. Closing it mid-show finishes the switch at once.
  const DOCK_MS = 420; // .terminal.is-theme-docked transition in themes.scss
  const DOCK_GAP = 12;
  const stage = { dialog: null, target: null, pending: null, commitTimer: 0, returnTimer: 0 };

  function openTerminalDialog() {
    const dialog = JBOS.terminal && JBOS.terminal.element;
    return dialog && dialog.open ? dialog : null;
  }

  // Current value of the individual `translate` property (the dock), mid-transition too.
  function dockTranslate(element) {
    const value = window.getComputedStyle(element).translate;
    if (!value || value === "none") return 0;
    const parts = value.split(/\s+/);
    return parts.length > 1 ? parseFloat(parts[1]) || 0 : 0;
  }

  function barHeight(dialog) {
    const bar = dialog.querySelector(".window-bar");
    return bar ? bar.offsetHeight : 40;
  }

  // Distance that puts the title bar just above the bottom of the visible viewport
  // (visualViewport keeps it above an on-screen keyboard). Includes any drag offset.
  function dockOffset(dialog) {
    const top = dialog.getBoundingClientRect().top - dockTranslate(dialog);
    const viewport = window.visualViewport;
    const floor = viewport ? Math.min(window.innerHeight, viewport.offsetTop + viewport.height) : window.innerHeight;
    return Math.max(0, Math.round(floor - DOCK_GAP - barHeight(dialog) - top));
  }

  function positionDock() {
    if (stage.dialog) stage.dialog.style.setProperty("--theme-dock-y", dockOffset(stage.dialog) + "px");
  }

  function dockPoint(dialog) {
    const rect = dialog.getBoundingClientRect();
    const offset = parseFloat(dialog.style.getPropertyValue("--theme-dock-y")) || 0;
    const top = rect.top - dockTranslate(dialog) + offset;
    return {
      x: rect.left + rect.width / 2,
      y: Math.min(window.innerHeight - 1, top + barHeight(dialog) / 2)
    };
  }

  function releaseStage() {
    const dialog = stage.dialog;
    window.clearTimeout(stage.commitTimer);
    window.clearTimeout(stage.returnTimer);
    stage.commitTimer = 0;
    stage.returnTimer = 0;
    stage.dialog = null;
    stage.target = null;
    window.removeEventListener("resize", positionDock);
    if (window.visualViewport) window.visualViewport.removeEventListener("resize", positionDock);
    if (!dialog) return;
    dialog.removeEventListener("close", onStageClose);
    dialog.classList.remove("is-theme-docked", "is-theme-docking");
    dialog.removeAttribute("data-theme-dock-label");
  }

  function returnFromDock() {
    const theme = stage.target;
    const dialog = stage.dialog;
    releaseStage();
    if (dialog && dialog.open) play("pop");
    if (theme) printLog(theme, 170);
  }

  function commitStaged() {
    const theme = stage.pending;
    stage.commitTimer = 0;
    stage.pending = null;
    if (!theme || !stage.dialog) return;
    // A re-staged switch can land back on the mode already showing: nothing to watch.
    const changed = setTheme(theme.id, { source: "terminal", toast: false, origin: dockPoint(stage.dialog) });
    stage.returnTimer = window.setTimeout(returnFromDock, changed ? theme.hold : 160);
  }

  function onStageClose() {
    const theme = stage.target;
    const pending = stage.pending;
    stage.pending = null;
    releaseStage();
    // The terminal is gone, so the switch (and its toast) now plays in plain view.
    if (pending && pending.id !== current()) setTheme(pending.id, { source: "terminal" });
    if (theme) printLog(theme, 0);
  }

  function stageSwitch(theme) {
    const dialog = openTerminalDialog();
    if (!dialog || reducedMotion()) {
      if (stage.dialog) releaseStage();
      stage.pending = null;
      setTheme(theme.id, { source: "terminal", toast: false });
      printLog(theme, reducedMotion() ? 0 : 170);
      return;
    }

    const docked = stage.dialog === dialog;
    window.clearTimeout(stage.commitTimer);
    window.clearTimeout(stage.returnTimer);
    stage.target = theme;
    stage.pending = theme;
    dialog.setAttribute("data-theme-dock-label", "\u2192 " + theme.name.toUpperCase());
    dialog.style.setProperty("--theme-dock-hold", (theme.hold + (docked ? 0 : DOCK_MS)) + "ms");
    // Restart the dock chip's progress bar for every staged switch.
    dialog.classList.remove("is-theme-docking");
    void dialog.offsetWidth;
    dialog.classList.add("is-theme-docking");

    if (!docked) {
      stage.dialog = dialog;
      positionDock();
      dialog.classList.add("is-theme-docked");
      dialog.addEventListener("close", onStageClose);
      window.addEventListener("resize", positionDock, { passive: true });
      if (window.visualViewport) window.visualViewport.addEventListener("resize", positionDock, { passive: true });
      play("whoosh");
    }
    stage.commitTimer = window.setTimeout(commitStaged, docked ? 60 : DOCK_MS);
  }

  // The mode the terminal is heading to: a staged switch counts before it commits.
  function terminalTheme() {
    return stage.pending ? stage.pending.id : current();
  }

  function switchFromTerminal(id, preface) {
    const theme = byId(id);
    if (!theme) return;
    if (theme.id === terminalTheme()) {
      print("Already running " + theme.name.toUpperCase() + ". Try: theme next");
      return;
    }
    if (preface) print(preface);
    print("> SWITCHING DISPLAY MODE \u2192 " + theme.name.toUpperCase(), true);
    stageSwitch(theme);
  }

  if (typeof JBOS.registerCommand === "function") {
    JBOS.registerCommand("theme", {
      help: "theme -crt | -synthwave | -default | -next | -random",
      aliases: ["themes"],
      run: function (args) {
        const raw = String(args && args[0] ? args[0] : "");
        // Flags work too: `theme -crt`, `theme --synthwave`, `theme -next`.
        const arg = raw.toLowerCase().replace(/^-{1,2}(?=[a-z])/, "");

        if (!arg || arg === "list" || arg === "ls" || arg === "status") {
          listThemes();
          return;
        }
        if (arg === "help" || arg === "-h" || arg === "--help" || arg === "?") {
          print("theme                 list display modes", "theme-term-item");
          print("theme <name>          default · crt · synthwave (or -crt, -synthwave)", "theme-term-item");
          print("theme next | prev     cycle through modes", "theme-term-item");
          print("theme random          let fate pick", "theme-term-item");
          return;
        }

        let target = null;
        let preface = "";
        if (arg === "next" || arg === "cycle" || arg === "toggle") {
          target = neighbour(1, terminalTheme());
        } else if (arg === "prev" || arg === "previous" || arg === "back") {
          target = neighbour(-1, terminalTheme());
        } else if (arg === "random" || arg === "shuffle" || arg === "surprise" || arg === "roll") {
          target = randomOther(terminalTheme());
          preface = "ROLLING THE DICE… ⚄";
        } else {
          const theme = resolve(arg);
          target = theme ? theme.id : null;
        }

        if (!target) {
          print("theme: unknown mode '" + raw + "'. Try: " + THEMES.map(function (theme) { return theme.id; }).join(" · "));
          play("error");
          return;
        }
        switchFromTerminal(target, preface);
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
