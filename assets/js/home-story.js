/* Home page · Scroll Story (index.html, styles in _sass/home-story.scss).
   One requestAnimationFrame loop turns the scroll position into unitless CSS custom
   properties on each chapter (--in, --p, --out, --vel, --speed); the motion itself lives
   in CSS. Scrolling is never hijacked: stages are position: sticky and move at native speed.
   Without this script, with prefers-reduced-motion, or on very short screens the page keeps
   its static layout with every word visible. */
(function () {
  "use strict";

  const doc = document;
  const story = doc.querySelector("[data-story]");
  if (!story) return;

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const verticalQuery = window.matchMedia("(max-width: 760px)");
  const fineQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
  const MIN_VIEW_HEIGHT = 460;
  const ZIGZAG_MIN_HEIGHT = 700;
  const supportsStory = Boolean(
    window.requestAnimationFrame &&
    window.CSS && typeof window.CSS.supports === "function" &&
    window.CSS.supports("position", "sticky") &&
    window.CSS.supports("opacity", "clamp(0, calc(0.5 * 2), 1)")
  );

  // JBOS (site.js) and its sound engine can be replaced after load, so always look them up.
  function jbos() {
    return window.JBOS || {};
  }

  function play(name) {
    const sound = jbos().sound;
    if (!sound || typeof sound.play !== "function") return;
    try { sound.play(name); } catch (error) { /* sound is optional */ }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function pad(value, size) {
    return String(value).padStart(size, "0");
  }

  function currentScroll() {
    return window.scrollY || window.pageYOffset || 0;
  }

  // Only touch the style attribute when the rounded value actually changes.
  function setVar(element, cache, name, value, digits) {
    const text = value.toFixed(digits === undefined ? 4 : digits);
    if (cache[name] === text) return;
    cache[name] = text;
    element.style.setProperty(name, text);
  }

  // A unitless custom property from an element's inline style (set in the markup).
  function readNumber(element, name, fallback) {
    const value = parseFloat(element.style.getPropertyValue(name));
    return isNaN(value) ? fallback : value;
  }

  function clearVars(element, cache, names) {
    names.forEach(function (name) { element.style.removeProperty(name); });
    Object.keys(cache).forEach(function (key) { delete cache[key]; });
  }

  function onMediaChange(query, handler) {
    if (query.addEventListener) query.addEventListener("change", handler);
    else if (query.addListener) query.addListener(handler);
  }

  // Layout offset of an element inside a positioned ancestor (transforms are ignored).
  function offsetWithin(element, ancestor, vertical) {
    let total = 0;
    let node = element;
    while (node && node !== ancestor) {
      total += vertical ? node.offsetTop : node.offsetLeft;
      node = node.offsetParent;
    }
    return total;
  }

  const chapters = Array.from(story.querySelectorAll("[data-story-chapter]")).map(function (element, index) {
    return {
      element: element,
      index: index,
      name: element.getAttribute("data-story-chapter"),
      stage: element.querySelector(".story-stage"),
      inner: element.querySelector(".story-stage__inner"),
      head: element.querySelector(".story-head"),
      title: element.querySelector(".story-title"),
      tab: element.querySelector(".story-tab"),
      tracksVelocity: element.hasAttribute("data-story-velocity"),
      top: 0,
      height: 1,
      stageHeight: 1,
      cover: 0,
      pinLength: 1,
      dockDistance: 1,
      pinned: false,
      active: false,
      covered: false,
      cache: {},
      module: null
    };
  }).filter(function (chapter) {
    return chapter.stage && chapter.inner;
  });
  if (!chapters.length) return;

  const CHAPTER_VARS = ["--in", "--p", "--out", "--vel", "--speed"];
  const LANE_VARS = ["--head-end", "--foot-top", "--title-end", "--col-end"];

  function chapterNamed(name) {
    return chapters.find(function (chapter) { return chapter.name === name; }) || null;
  }

  let live = false;
  let viewHeight = window.innerHeight;
  let viewWidth = window.innerWidth;
  let storyTop = 0;
  let storyHeight = 1;
  let lastY = currentScroll();
  let lastTime = 0;
  let velocity = 0;
  let scrollDirection = 1;
  let idleFrames = 0;
  let frameId = 0;
  let measureId = 0;

  /* ---------- 01 · Bio: word counter + keyword tags ---------- */

  function createBio(chapter) {
    const element = chapter.element;
    const frames = Array.from(element.querySelectorAll(".story-bio__frame"));
    const frameCount = Math.max(frames.length, 1);
    const thresholds = [];
    const keyStarts = {};

    frames.forEach(function (frame, frameIndex) {
      // Each frame's slice of --p (set in the markup, sized by word count).
      const sliceStart = readNumber(frame, "--f0", frameIndex / frameCount);
      const sliceLength = readNumber(frame, "--fl", 1 / frameCount) || 1 / frameCount;
      frame.querySelectorAll(".story-word").forEach(function (word) {
        const start = readNumber(word, "--s", 0);
        // Mirrors --t in home-story.scss: a word reads as landed halfway through its 1/12 window.
        const at = sliceStart + (start + 0.5 / 12) * sliceLength;
        thresholds.push(at);
        const key = word.getAttribute("data-key");
        if (key && (keyStarts[key] === undefined || at < keyStarts[key])) keyStarts[key] = at;
      });
    });
    thresholds.sort(function (a, b) { return a - b; });

    const countEl = element.querySelector("[data-story-words]");
    const totalEl = element.querySelector("[data-story-words-total]");
    if (totalEl) totalEl.textContent = pad(thresholds.length, 3);

    const tags = Array.from(element.querySelectorAll("[data-story-key]")).map(function (tag) {
      const at = keyStarts[tag.getAttribute("data-story-key")];
      return { element: tag, at: at === undefined ? 0.98 : at, found: false };
    });

    let shown = -1;
    let complete = false;

    return {
      update: function (p, quiet) {
        let count = 0;
        while (count < thresholds.length && thresholds[count] <= p) count += 1;
        if (count !== shown) {
          shown = count;
          if (countEl) countEl.textContent = pad(count, 3);
        }

        let newlyFound = false;
        let all = tags.length > 0;
        tags.forEach(function (tag) {
          const found = p >= tag.at;
          if (found !== tag.found) {
            tag.found = found;
            tag.element.classList.toggle("is-found", found);
            if (found) newlyFound = true;
          }
          if (!found) all = false;
        });

        const audible = !quiet && scrollDirection > 0;
        if (all !== complete) {
          complete = all;
          element.classList.toggle("has-all-keys", all);
          if (all && audible) play("success");
        } else if (newlyFound && audible) {
          play("pop");
        }
      },
      reset: function () {
        shown = -1;
        complete = false;
        element.classList.remove("has-all-keys");
        tags.forEach(function (tag) {
          tag.found = false;
          tag.element.classList.remove("is-found");
        });
      }
    };
  }

  /* ---------- 02 · Experience: track geometry, odometer, finale ---------- */

  function createTimeline(chapter) {
    const element = chapter.element;
    const viewport = element.querySelector("[data-story-viewport]");
    const track = element.querySelector("[data-story-track]");
    const line = element.querySelector("[data-story-line]");
    const cards = Array.from(element.querySelectorAll("[data-story-card]")).map(function (card) {
      return {
        element: card,
        body: card.querySelector(".story-card__body"),
        position: 0,
        year: card.getAttribute("data-year") || "",
        org: card.getAttribute("data-org") || ""
      };
    });
    if (!viewport || !track || !cards.length) return null;

    const digits = Array.from(element.querySelectorAll(".story-odo__digit"));
    const countEl = element.querySelector("[data-story-count]");
    const statusEl = element.querySelector("[data-story-status]");
    const total = pad(cards.length, 2);
    const geometry = { viewport: 1, shift: 0 };
    let current = -1;
    let finale = false;
    let celebrated = false;

    function setYear(year) {
      if (!digits.length) return;
      const text = String(year).replace(/\D/g, "").slice(-digits.length).padStart(digits.length, "0");
      digits.forEach(function (digit, index) {
        digit.style.setProperty("--digit", text.charAt(index));
      });
    }

    // Mirrors --t on .story-card in home-story.scss.
    function cardProgress(card, p) {
      return clamp((p * geometry.shift + geometry.viewport * 0.85 - card.position) / (geometry.viewport * 0.3), 0, 1);
    }

    // Every card body must sit inside its lane (above/below the line) or the layout is too cramped.
    function bodiesFit() {
      return cards.every(function (card) {
        if (!card.body) return true;
        const top = card.body.offsetTop;
        return top >= -1 && top + card.body.offsetHeight <= card.element.offsetHeight + 1;
      });
    }

    // "ACHIEVEMENT · FULL CIRCLE: GOOGLE 2022 → GOOGLE 2026": everything after the colon is
    // joined with no-break spaces, so the toast breaks after the colon (or not at all) and
    // never leaves the last year on a line of its own.
    const fullCircle = (function () {
      const raw = story.getAttribute("data-full-circle") || "";
      const split = raw.indexOf(": ");
      if (split < 0) return raw;
      return raw.slice(0, split + 2) + raw.slice(split + 2).replace(/ /g, "\u00A0");
    })();
    let toastShown = false;

    function celebrate() {
      const toast = jbos().toast;
      if (!fullCircle || typeof toast !== "function") return;
      try {
        if (window.sessionStorage.getItem("jb-story-full-circle")) return;
        window.sessionStorage.setItem("jb-story-full-circle", "1");
      } catch (error) { /* storage is optional; toast anyway */ }
      toast(fullCircle);
      toastShown = true;
    }

    // The toast belongs to the end of the timeline: once the next chapter starts to slide
    // over it, clear it (only if it is still ours) so it never sits on the next window.
    function dismissToast() {
      toastShown = false;
      const element = doc.querySelector(".system-toast");
      if (element && element.textContent === fullCircle) element.classList.remove("is-visible");
    }

    return {
      // Runs while every chapter is laid out as pinned: pick the richest layout that fits.
      fits: function () {
        if (verticalQuery.matches) {
          element.classList.remove("is-zigzag");
          // The vertical track needs a usable window below the heading.
          return viewport.clientHeight >= 170;
        }
        if (window.innerHeight >= ZIGZAG_MIN_HEIGHT) {
          element.classList.add("is-zigzag");
          if (bodiesFit()) return true;
        }
        element.classList.remove("is-zigzag");
        return bodiesFit();
      },
      measure: function () {
        const vertical = verticalQuery.matches;
        const view = Math.max(vertical ? viewport.clientHeight : viewport.clientWidth, 1);
        const size = vertical ? track.offsetHeight : track.offsetWidth;
        const lineLength = line ? Math.max(vertical ? line.offsetHeight : line.offsetWidth, 1) : Math.max(size, 1);
        geometry.viewport = view;
        geometry.shift = Math.max(size - view, 0);
        element.style.setProperty("--shift", geometry.shift.toFixed(1));
        element.style.setProperty("--vp", view.toFixed(1));
        element.style.setProperty("--line", lineLength.toFixed(1));
        cards.forEach(function (card) {
          card.position = offsetWithin(card.element, track, vertical);
          card.element.style.setProperty("--x", card.position.toFixed(1));
        });
      },
      update: function (p, quiet, out) {
        if (toastShown && out > 0.04) dismissToast();

        let next = 0;
        cards.forEach(function (card, index) {
          if (cardProgress(card, p) >= 0.75) next = index;
        });

        if (next !== current) {
          if (cards[current]) cards[current].element.classList.remove("is-current");
          current = next;
          const card = cards[current];
          card.element.classList.add("is-current");
          setYear(card.year);
          if (countEl) countEl.textContent = pad(current + 1, 2) + " / " + total;
          if (statusEl) statusEl.textContent = card.org;
          if (!quiet) play("click");
        }

        const atEnd = current === cards.length - 1 && p >= 0.8;
        if (atEnd !== finale) {
          finale = atEnd;
          element.classList.toggle("is-finale", finale);
          if (finale && !quiet) {
            play("powerup");
            if (!celebrated) {
              celebrated = true;
              celebrate();
            }
          }
        }
      },
      reset: function () {
        if (cards[current]) cards[current].element.classList.remove("is-current");
        current = -1;
        finale = false;
        element.classList.remove("is-finale", "is-zigzag");
        ["--shift", "--vp", "--line"].forEach(function (name) { element.style.removeProperty(name); });
        cards.forEach(function (card) { card.element.style.removeProperty("--x"); });
        if (cards[0]) setYear(cards[0].year);
      }
    };
  }

  /* ---------- 03 · Stack: deck position + record counter ---------- */

  // Share of each card's slice spent flicking it away; the rest of the slice the next
  // card rests at the front of the pile, so it can be read.
  const DECK_FLICK = 0.5;

  function createStack(chapter) {
    const element = chapter.element;
    const deck = element.querySelector(".story-deck");
    const recordEl = element.querySelector("[data-story-rec]");
    const count = deck ? deck.children.length : 0;
    if (!deck || !count) return null;

    const cache = {};
    let start = 0.54;
    let span = 0.42;
    let shown = -1;

    return {
      measure: function () {
        const styles = window.getComputedStyle(element);
        start = parseFloat(styles.getPropertyValue("--deck-start")) || start;
        span = parseFloat(styles.getPropertyValue("--deck-span")) || span;
      },
      update: function (p) {
        // Linear position through the deck, then eased card by card (flick, hold, flick…).
        const linear = clamp((p - start) / span, 0, 1) * (count - 1);
        const base = Math.min(Math.floor(linear), count - 1);
        const step = clamp((linear - base) / DECK_FLICK, 0, 1);
        const position = Math.min(base + step * step * (3 - 2 * step), count - 1);
        setVar(deck, cache, "--c", position, 3);

        // The counter flips once the outgoing card has slid clear of the pile (--gone ~0.6 in
        // CSS); on wide screens that card is covering the counter at that moment.
        const index = Math.min(Math.floor(position + 0.4), count - 1);
        if (index === shown) return;
        shown = index;
        if (recordEl) recordEl.textContent = pad(index + 1, 2);
      },
      reset: function () {
        shown = -1;
        clearVars(deck, cache, ["--c"]);
        if (recordEl) recordEl.textContent = recordEl.getAttribute("data-static") || String(count);
      }
    };
  }

  const bioChapter = chapterNamed("bio");
  const workChapter = chapterNamed("work");
  const stackChapter = chapterNamed("stack");
  if (bioChapter) bioChapter.module = createBio(bioChapter);
  if (workChapter) workChapter.module = createTimeline(workChapter);
  if (stackChapter) stackChapter.module = createStack(stackChapter);

  /* ---------- Marquees: speed (and direction) follow the scroll ---------- */

  const marquees = Array.from(story.querySelectorAll("[data-story-marquee]")).map(function (element) {
    const hostElement = element.closest("[data-story-chapter]");
    return {
      element: element,
      track: element.querySelector(".story-marquee__track"),
      group: element.querySelector(".story-marquee__group"),
      speed: parseFloat(element.getAttribute("data-speed")) || 40,
      direction: parseFloat(element.getAttribute("data-dir")) || 1,
      host: chapters.find(function (chapter) { return chapter.element === hostElement; }) || null,
      offset: 0,
      width: 1,
      visible: false
    };
  }).filter(function (marquee) {
    return marquee.track && marquee.group;
  });

  if ("IntersectionObserver" in window) {
    const marqueeObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const marquee = marquees.find(function (item) { return item.element === entry.target; });
        if (marquee) marquee.visible = entry.isIntersecting;
      });
      schedule();
    });
    marquees.forEach(function (marquee) { marqueeObserver.observe(marquee.element); });
  } else {
    marquees.forEach(function (marquee) { marquee.visible = true; });
  }

  function driveMarquees(dt, speed) {
    let running = false;
    marquees.forEach(function (marquee) {
      // Hidden (display: none) marquees never intersect, so `visible` covers them too.
      if (!marquee.visible || (marquee.host && marquee.host.covered)) return;
      running = true;
      const pixelsPerSecond = (marquee.speed + speed * 1100) * marquee.direction * scrollDirection;
      const width = marquee.width;
      marquee.offset = (((marquee.offset + pixelsPerSecond * dt / 1000) % width) + width) % width;
      marquee.track.style.transform = "translate3d(" + (-marquee.offset).toFixed(2) + "px,0,0)";
    });
    return running;
  }

  /* ---------- Chapter rail ---------- */

  const rail = story.querySelector("[data-story-rail]");
  const railLinks = Array.from(story.querySelectorAll("[data-story-jump]"));
  const railCache = {};
  let railIndex = -1;
  let railVisible = false;

  function updateRail(y) {
    if (!rail) return;
    let index = 0;
    chapters.forEach(function (chapter, i) {
      if (chapter.top - y <= viewHeight * 0.5) index = i;
    });

    if (index !== railIndex) {
      railIndex = index;
      railLinks.forEach(function (link) {
        const on = parseInt(link.getAttribute("data-story-jump"), 10) === index;
        link.classList.toggle("is-current", on);
        if (on) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
      const bus = jbos();
      if (typeof bus.emit === "function") bus.emit("story-chapter", { index: index, name: chapters[index].name });
    }

    setVar(rail, railCache, "--story-p", clamp((y - storyTop) / Math.max(storyHeight - viewHeight, 1), 0, 1), 3);
    const visible = storyTop - y < viewHeight * 0.35 && storyTop + storyHeight - y > viewHeight * 0.6;
    if (visible !== railVisible) {
      railVisible = visible;
      rail.classList.toggle("is-visible", visible);
    }
  }

  function resetRail() {
    railIndex = -1;
    railVisible = false;
    if (rail) {
      rail.classList.remove("is-visible");
      clearVars(rail, railCache, ["--story-p"]);
    }
    railLinks.forEach(function (link) {
      link.classList.remove("is-current");
      link.removeAttribute("aria-current");
    });
  }

  /* ---------- Rewind (replay link / `story replay`) ---------- */

  const vhsClock = story.querySelector("[data-story-vhs]");
  let rewinding = false;
  let rewindTarget = 0;
  let rewindTimer = 0;

  function stopRewind() {
    if (!rewinding) return;
    rewinding = false;
    window.clearTimeout(rewindTimer);
    story.classList.remove("is-rewinding");
  }

  function updateRewind(y) {
    if (vhsClock) {
      const seconds = Math.max(0, Math.round((y - rewindTarget) / 90));
      const text = "SP " + Math.floor(seconds / 3600) + ":" + pad(Math.floor(seconds / 60) % 60, 2) + ":" + pad(seconds % 60, 2);
      if (vhsClock.textContent !== text) vhsClock.textContent = text;
    }
    if (Math.abs(y - rewindTarget) < 3) stopRewind();
  }

  function focusTitle(chapter) {
    const title = chapter && chapter.title;
    if (!title) return;
    if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
    try {
      title.focus({ preventScroll: true });
    } catch (error) {
      title.focus();
    }
  }

  function startRewind() {
    const first = chapters[0];
    if (!live) {
      first.element.scrollIntoView({ block: "start" });
      focusTitle(first);
      return;
    }
    rewindTarget = Math.max(Math.round(first.top), 0);
    rewinding = true;
    story.classList.add("is-rewinding");
    play("whoosh");
    window.clearTimeout(rewindTimer);
    rewindTimer = window.setTimeout(stopRewind, 5000);
    window.scrollTo({ top: rewindTarget, behavior: "smooth" });
    focusTitle(first);
    schedule();
  }

  function jumpTo(index) {
    const chapter = chapters[index];
    if (!chapter) return;
    const behavior = motionQuery.matches ? "auto" : "smooth";
    if (live) window.scrollTo({ top: Math.ceil(chapter.top) + 2, behavior: behavior });
    else chapter.element.scrollIntoView({ block: "start", behavior: behavior });
    focusTitle(chapter);
    play("click");
  }

  /* ---------- The loop ---------- */

  function update(now, quiet) {
    const y = currentScroll();
    const dt = lastTime ? clamp(now - lastTime, 1, 64) : 16;
    const delta = y - lastY;
    lastTime = now;
    lastY = y;

    // Smoothed px/ms, normalised to -1..1 for CSS.
    velocity += (delta / dt - velocity) * 0.16;
    if (Math.abs(velocity) < 0.003) velocity = 0;
    if (delta !== 0) {
      scrollDirection = delta > 0 ? 1 : -1;
      idleFrames = 0;
    } else {
      idleFrames += 1;
    }
    const signed = clamp(velocity / 2.4, -1, 1);
    const speed = Math.abs(signed);

    chapters.forEach(function (chapter) {
      const rel = chapter.top - y;
      // Every chapter's title bar (pinned or not) docks away over the last stretch before
      // its top edge reaches the top of the screen, where the fixed site header sits, and
      // slides back out when scrolling up. So none is left behind, or peeking around, it.
      if (chapter.tab) setVar(chapter.tab, chapter.cache, "--dock", clamp(1 - rel / chapter.dockDistance, 0, 1), 3);
      if (!chapter.pinned) return;
      const onScreen = rel < viewHeight && rel + chapter.height > 0;
      if (onScreen !== chapter.active) {
        chapter.active = onScreen;
        chapter.element.classList.toggle("is-active", onScreen);
      }
      // Off-screen chapters keep their last values; their work is paused.
      if (!onScreen && !quiet) return;

      const enter = clamp(1 - rel / chapter.stageHeight, 0, 1);
      const p = clamp(-rel / chapter.pinLength, 0, 1);
      const out = clamp((-rel - chapter.pinLength) / (chapter.cover || chapter.stageHeight), 0, 1);
      chapter.covered = chapter.cover > 0 && out >= 0.999;

      setVar(chapter.element, chapter.cache, "--in", enter);
      setVar(chapter.element, chapter.cache, "--p", p);
      setVar(chapter.element, chapter.cache, "--out", out);
      if (chapter.tracksVelocity) {
        setVar(chapter.element, chapter.cache, "--vel", signed, 3);
        setVar(chapter.element, chapter.cache, "--speed", speed, 3);
      }
      if (chapter.module && chapter.module.update) chapter.module.update(p, quiet, out);
    });

    const marqueesRunning = driveMarquees(dt, speed);
    updateRail(y);
    if (rewinding) updateRewind(y);
    return marqueesRunning;
  }

  function tick(now) {
    frameId = 0;
    if (!live) return;
    const running = update(now, false);
    if (running || velocity !== 0 || idleFrames < 8 || rewinding) {
      schedule();
    } else {
      // Next scroll restarts the clock so the first frame does not read as a velocity spike.
      lastTime = 0;
    }
  }

  function schedule() {
    if (!live || frameId) return;
    frameId = window.requestAnimationFrame(tick);
  }

  /* ---------- Measuring and modes ---------- */

  function releaseChapter(chapter) {
    chapter.active = false;
    chapter.covered = false;
    chapter.element.classList.remove("is-active");
    clearVars(chapter.element, chapter.cache, CHAPTER_VARS.concat(LANE_VARS));
    if (chapter.tab) chapter.tab.style.removeProperty("--dock");
    if (chapter.module && chapter.module.reset) chapter.module.reset();
  }

  function setLive(next) {
    if (next === live) return;
    live = next;
    story.classList.toggle("is-live", live);
    if (live) return;

    if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }
    chapters.forEach(function (chapter) {
      chapter.pinned = false;
      chapter.element.classList.remove("is-pinned");
      releaseChapter(chapter);
    });
    marquees.forEach(function (marquee) {
      marquee.offset = 0;
      marquee.track.style.transform = "";
    });
    resetRail();
    stopRewind();
  }

  // Where the decorative glyphs may drift (see "Glyph lanes" in home-story.scss), in px from
  // the stage's top-left corner, measured while every moving part is parked: the foot of the
  // heading, the top of the stage's bottom row, the right end of the title text and the
  // right edge of the bio text column.
  function measureLanes(chapter) {
    const element = chapter.element;
    const origin = chapter.stage.getBoundingClientRect();
    const setPx = function (name, value) { element.style.setProperty(name, value.toFixed(1) + "px"); };
    if (chapter.head) setPx("--head-end", chapter.head.getBoundingClientRect().bottom - origin.top);
    const foot = chapter.inner.lastElementChild;
    if (foot && foot !== chapter.head) setPx("--foot-top", foot.getBoundingClientRect().top - origin.top);
    if (chapter.title && doc.createRange) {
      const range = doc.createRange();
      range.selectNodeContents(chapter.title);
      setPx("--title-end", range.getBoundingClientRect().right - origin.left);
    }
    const columns = Array.from(element.querySelectorAll(".story-words"));
    if (columns.length) {
      setPx("--col-end", Math.max.apply(null, columns.map(function (column) {
        return column.getBoundingClientRect().right;
      })) - origin.left);
    }
  }

  // Key-phrase highlights carry inline padding, which would indent the first letter of a line
  // that opens with one. Every word (or unbreakable phrase) on such a line is flagged, so CSS
  // (.is-hang) can shift the whole line left by that padding: its first letter lines up with
  // the paragraph's edge, the highlight hangs into the margin and the word spacing stays even.
  // Lines come from layout offsets, which transforms never touch, so the flying words do not
  // affect the check; every column is read before any flag is written.
  const wordColumns = Array.from(story.querySelectorAll(".story-words"));

  function hangMarks() {
    wordColumns.forEach(function (column) {
      column.querySelectorAll(".is-hang").forEach(function (element) {
        element.classList.remove("is-hang");
      });
    });
    const hung = [];
    wordColumns.forEach(function (column) {
      const step = (parseFloat(window.getComputedStyle(column).fontSize) || 16) * 0.5;
      const lines = [];
      let line = null;
      column.querySelectorAll(".story-word").forEach(function (word) {
        const top = word.offsetTop;
        if (!line || top > line.top + step) {
          line = { top: top, words: [] };
          lines.push(line);
        }
        line.words.push(word);
      });
      lines.forEach(function (row) {
        if (!row.words[0].querySelector(".story-mark")) return;
        row.words.forEach(function (word) {
          const phrase = word.parentElement;
          const unit = phrase && phrase.classList.contains("story-phrase") ? phrase : word;
          if (hung.indexOf(unit) < 0) hung.push(unit);
        });
      });
    });
    hung.forEach(function (unit) { unit.classList.add("is-hang"); });
  }

  function measure() {
    measureId = 0;
    setLive(supportsStory && !motionQuery.matches && window.innerHeight >= MIN_VIEW_HEIGHT);
    if (!live) {
      hangMarks();
      return;
    }

    viewHeight = window.innerHeight;
    viewWidth = window.innerWidth;

    // Lay every chapter out as a pinned stage with its moving parts parked, then keep
    // only the ones whose stage fits the screen; the rest fall back to their static layout.
    story.classList.add("is-measuring");
    chapters.forEach(function (chapter) { chapter.element.classList.add("is-pinned"); });
    chapters.forEach(function (chapter) {
      // A pinned stage's top padding clears the fixed header: the distance a title bar docks over.
      chapter.dockDistance = Math.max(parseFloat(window.getComputedStyle(chapter.inner).paddingTop) || 0, 1);
      const module = chapter.module;
      const moduleFits = !module || !module.fits || module.fits();
      chapter.pinned = moduleFits && chapter.inner.scrollHeight <= chapter.stage.clientHeight + 2;
    });
    chapters.forEach(function (chapter) {
      chapter.element.classList.toggle("is-pinned", chapter.pinned);
      if (!chapter.pinned) releaseChapter(chapter);
    });
    chapters.forEach(function (chapter) {
      if (!chapter.pinned) return;
      if (chapter.module && chapter.module.measure) chapter.module.measure();
      measureLanes(chapter);
    });
    story.classList.remove("is-measuring");
    hangMarks();

    const y = currentScroll();
    chapters.forEach(function (chapter) {
      const rect = chapter.element.getBoundingClientRect();
      chapter.top = rect.top + y;
      chapter.height = Math.max(rect.height, 1);
      chapter.stageHeight = Math.max(chapter.pinned ? chapter.stage.offsetHeight : rect.height, 1);
    });
    chapters.forEach(function (chapter, index) {
      const next = chapters[index + 1];
      // How much of this chapter the next one slides over (its negative margin).
      chapter.cover = chapter.pinned && next ? clamp(chapter.top + chapter.height - next.top, 0, chapter.stageHeight) : 0;
      chapter.pinLength = Math.max(chapter.height - chapter.stageHeight - chapter.cover, 1);
    });

    const last = chapters[chapters.length - 1];
    storyTop = chapters[0].top;
    storyHeight = Math.max(last.top + last.height - storyTop, 1);
    marquees.forEach(function (marquee) {
      marquee.width = Math.max(marquee.group.offsetWidth, 1);
    });

    lastY = y;
    lastTime = 0;
    update(window.performance ? window.performance.now() : Date.now(), true);
    schedule();
  }

  function queueMeasure() {
    if (!measureId) measureId = window.requestAnimationFrame(measure);
  }

  /* ---------- Wiring ---------- */

  window.addEventListener("scroll", schedule, { passive: true });

  window.addEventListener("resize", function () {
    const height = window.innerHeight;
    const widthChanged = window.innerWidth !== viewWidth;
    // Mobile browser chrome sliding in/out only nudges the height; the svh-sized stages
    // do not change, so skip the relayout (ResizeObserver catches real stage changes).
    if (live && !widthChanged && height >= MIN_VIEW_HEIGHT) {
      viewHeight = height;
      schedule();
      return;
    }
    queueMeasure();
  }, { passive: true });

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(function () { queueMeasure(); });
    resizeObserver.observe(doc.body);
    chapters.forEach(function (chapter) { resizeObserver.observe(chapter.stage); });
  }

  window.addEventListener("load", queueMeasure);
  window.addEventListener("pageshow", queueMeasure);
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(queueMeasure).catch(function () {});
  onMediaChange(motionQuery, queueMeasure);
  onMediaChange(verticalQuery, queueMeasure);
  if (typeof jbos().on === "function") jbos().on("theme-change", queueMeasure);

  doc.addEventListener("visibilitychange", function () {
    if (doc.hidden) return;
    lastTime = 0;
    schedule();
  });

  // A manual scroll (or any key) hands control back immediately during a rewind.
  ["wheel", "touchstart", "keydown"].forEach(function (type) {
    window.addEventListener(type, stopRewind, { passive: true });
  });

  railLinks.forEach(function (link) {
    link.addEventListener("click", function (event) {
      if (!live || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      jumpTo(parseInt(link.getAttribute("data-story-jump"), 10) || 0);
    });
  });

  story.querySelectorAll("[data-story-replay]").forEach(function (link) {
    link.addEventListener("click", function (event) {
      if (!live || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      startRewind();
    });
  });

  // Magnetic exits: the label and arrow lean toward the pointer (CSS eases the motion).
  if (fineQuery.matches && !motionQuery.matches) {
    story.querySelectorAll("[data-story-door]").forEach(function (door) {
      door.addEventListener("pointermove", function (event) {
        if (event.pointerType === "touch") return;
        const rect = door.getBoundingClientRect();
        const x = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
        const y = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
        door.style.setProperty("--mx", (x * 56).toFixed(1));
        door.style.setProperty("--my", (y * 22).toFixed(1));
      }, { passive: true });
      door.addEventListener("pointerleave", function () {
        door.style.setProperty("--mx", "0");
        door.style.setProperty("--my", "0");
      });
    });
  }

  measure();
})();
