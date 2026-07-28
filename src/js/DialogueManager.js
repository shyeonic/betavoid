// Generic in-game dialogue overlay. Renders a sequence of speaker lines into the
// SVG dialogue box defined in index.html (.dialog-ui), with automatic two-line
// pagination ported from non-product-test-and-sample/hud-textbox.html.
//
// Text and speaker names are resolved through i18n (string ids), so dialogue data
// (gamedata/dialogue_defs.json) only references string ids and never stores text.
// Consuming systems (tutorial, quests, ...) drive it via play(dialogueId) or
// playLines(lines); this manager carries no context flags of its own.

const XLINK_NS = "http://www.w3.org/1999/xlink";

// RGB-split scanline slices for the glitch open animation (ported from
// non-product-test-and-sample/hud-textbox2.html). Each entry is positioned/jittered
// via inline CSS custom properties.
const GLITCH_SLICES = [
  { top: 0, height: 7, shift: 3.4 },
  { top: 8, height: 6, shift: -5.2 },
  { top: 15, height: 9, shift: 4.7 },
  { top: 25, height: 6, shift: -3.1 },
  { top: 33, height: 8, shift: 6.3 },
  { top: 44, height: 7, shift: -4.4 },
  { top: 55, height: 10, shift: 3.6 },
  { top: 68, height: 7, shift: -6.1 },
  { top: 79, height: 9, shift: 5.1 },
  { top: 90, height: 6, shift: -3.8 }
];
const GLITCH_DURATION_MS = 900;

export class DialogueManager {
  constructor({
    i18n,
    dialogueDefinitions = { speakers: {}, dialogues: {} },
    assetBaseUrl = "",
    root = null,
    onComplete = null
  } = {}) {
    this.i18n = i18n || { t: (key, params, fallback = key) => fallback };
    this.speakers = dialogueDefinitions.speakers || {};
    this.dialogues = dialogueDefinitions.dialogues || {};
    this.assetBaseUrl = assetBaseUrl;
    this.onComplete = onComplete;

    this.root = root || document.querySelector(".dialog-ui");
    if (!this.root) throw new Error("DialogueManager requires the .dialog-ui element.");

    // Full-viewport dimmer that blocks clicks from passing through to the game/UI
    // beneath an open dialogue; clicking it dismisses the dialogue.
    this.dimmer = document.querySelector(".dialog-ui-dimmer");

    this.nameEl = this.root.querySelector(".character-name__text");
    this.profileImageEl = this.root.querySelector("[data-profile-image]");
    this.bodyEl = this.root.querySelector(".dialogue-text__body");
    this.prevBtn = this.root.querySelector(".dialogue-prev");
    this.nextBtn = this.root.querySelector(".dialogue-next");
    this.dialogueBox = this.root.querySelector(".dialogue-text");

    this.lines = [];
    this.dialogueIndex = 0;
    this.pageIndex = 0;
    this.currentPages = [];
    this.activeDialogueId = null;
    this.isOpen = false;
    this.resizeTimer = 0;
    this.glitchTimer = 0;

    this.boundPrev = () => this.prev();
    this.boundNext = () => this.next();
    this.boundResize = () => this.onResize();
    this.boundDimmerPointerDown = (event) => this.handleDimmerPointerDown(event);

    this.prevBtn.addEventListener("click", this.boundPrev);
    this.nextBtn.addEventListener("click", this.boundNext);
    window.addEventListener("resize", this.boundResize);
    // The dimmer captures the click (blocking pass-through to the game/UI below)
    // and dismisses the dialogue.
    this.dimmer?.addEventListener("pointerdown", this.boundDimmerPointerDown);
  }

  // Play a predefined dialogue sequence by id (from dialogue_defs.json).
  play(dialogueId) {
    const dialogue = this.dialogues[dialogueId];
    if (!dialogue) {
      console.warn(`[dialogue] unknown dialogue id: ${dialogueId}`);
      return false;
    }
    this.activeDialogueId = dialogueId;
    return this.playLines(dialogue.lines);
  }

  // Play an arbitrary list of lines. Each line:
  //   { speaker: speakerId | { name?, name_id?, portrait? }, text_id? , text? }
  playLines(lines) {
    const resolved = (Array.isArray(lines) ? lines : [])
      .map((line) => this.resolveLine(line))
      .filter(Boolean);

    if (resolved.length === 0) {
      console.warn("[dialogue] no renderable lines.");
      return false;
    }

    this.lines = resolved;
    this.isOpen = true;
    // Render content first so the glitch slices clone the correct text/portrait.
    this.renderLine(0, "first");
    this.setVisible(true);
    return true;
  }

  resolveLine(line) {
    if (!line) return null;
    const speaker = this.resolveSpeaker(line.speaker);
    const text = line.text_id ? this.i18n.t(line.text_id) : (line.text ?? "");
    return { name: speaker.name, image: speaker.image, text };
  }

  resolveSpeaker(speaker) {
    if (!speaker) return { name: "", image: "" };
    const definition = typeof speaker === "string" ? this.speakers[speaker] : speaker;
    if (!definition) return { name: "", image: "" };
    const name = definition.name_id ? this.i18n.t(definition.name_id) : (definition.name ?? "");
    return { name, image: this.resolvePortrait(definition.portrait) };
  }

  resolvePortrait(portrait) {
    if (!portrait) return "";
    try {
      return new URL(portrait, this.assetBaseUrl || undefined).href;
    } catch {
      return portrait;
    }
  }

  setVisible(visible) {
    if (visible) {
      if (this.root.classList.contains("dialog-ui--active")) return;
      this.root.classList.add("dialog-ui--active");
      this.root.setAttribute("aria-hidden", "false");
      this.dimmer?.classList.add("dialog-ui-dimmer--active");
      this.dimmer?.setAttribute("aria-hidden", "false");
      this.playGlitch();
    } else {
      this.resetGlitch();
      this.root.classList.remove("dialog-ui--active");
      this.root.setAttribute("aria-hidden", "true");
      this.dimmer?.classList.remove("dialog-ui-dimmer--active");
      this.dimmer?.setAttribute("aria-hidden", "true");
    }
  }

  close() {
    this.isOpen = false;
    this.activeDialogueId = null;
    this.setVisible(false);
  }

  // --- glitch open animation (ported from hud-textbox2.html) ---

  getGlitchLayer() {
    let layer = this.root.querySelector(".dialog-ui__glitch-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "dialog-ui__glitch-layer";
      layer.setAttribute("aria-hidden", "true");
      this.root.appendChild(layer);
    }
    return layer;
  }

  buildGlitchSlices() {
    const layer = this.getGlitchLayer();
    const sourceNodes = Array.from(this.root.children)
      .filter((node) => !node.classList.contains("dialog-ui__glitch-layer"));

    layer.textContent = "";

    GLITCH_SLICES.forEach((sliceData, index) => {
      const slice = document.createElement("div");
      const inner = document.createElement("div");

      const direction = index % 2 === 0 ? 1 : -1;
      const channelColor = direction > 0 ? "rgba(0, 246, 255, .95)" : "rgba(255, 47, 146, .88)";
      const shift = (value) => `calc(${value} * var(--u))`;

      slice.className = "dialog-ui__glitch-slice";
      inner.className = "dialog-ui__glitch-slice-inner";

      slice.style.setProperty("--slice-top", `${sliceData.top}%`);
      slice.style.setProperty("--slice-height", `${sliceData.height}%`);
      slice.style.setProperty("--slice-delay", `${index * 9}ms`);
      slice.style.setProperty("--channel-color", channelColor);
      slice.style.setProperty("--channel-shift", shift(direction * 0.85));
      slice.style.setProperty("--x1", shift(sliceData.shift));
      slice.style.setProperty("--x2", shift(sliceData.shift * -0.75));
      slice.style.setProperty("--x3", shift(sliceData.shift * 1.2));
      slice.style.setProperty("--x4", shift(sliceData.shift * -1.05));
      slice.style.setProperty("--x5", shift(sliceData.shift * 0.62));
      slice.style.setProperty("--x6", shift(sliceData.shift * -0.28));

      sourceNodes.forEach((node) => inner.appendChild(node.cloneNode(true)));
      slice.appendChild(inner);
      layer.appendChild(slice);
    });

    return layer;
  }

  resetGlitch() {
    clearTimeout(this.glitchTimer);
    this.root.classList.remove("dialog-ui--glitch");
    const layer = this.root.querySelector(".dialog-ui__glitch-layer");
    if (layer) layer.textContent = "";
  }

  playGlitch() {
    this.resetGlitch();
    const layer = this.buildGlitchSlices();
    void this.root.getBoundingClientRect().width; // force reflow so the animation restarts
    this.root.classList.add("dialog-ui--glitch");
    this.glitchTimer = setTimeout(() => {
      this.root.classList.remove("dialog-ui--glitch");
      layer.textContent = "";
    }, GLITCH_DURATION_MS);
  }

  handleDimmerPointerDown(event) {
    if (!this.isOpen) return;
    // The nav buttons sit above the dimmer (inside .dialog-ui) and handle their own
    // clicks, so anything reaching the dimmer is an outside click. Still guard the
    // box's own footprint so a click landing on the dialogue art (which doesn't
    // capture pointer events) is absorbed rather than dismissing the dialogue.
    const rect = this.root.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (inside) return;
    this.close();
  }

  // --- pagination (ported from hud-textbox.html) ---

  // Collapse incidental whitespace but keep explicit newlines so authors can force a
  // line break inside a page with "\n" in the source/locale strings. Other runs of
  // whitespace become a single space; spaces hugging a newline are dropped. Consecutive
  // newlines are preserved (e.g. "\n\n" yields a blank line).
  normalizeText(text) {
    return String(text)
      .replace(/\r\n?/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n ?/g, "\n")
      .trim();
  }

  createMeasurer() {
    const measurer = this.bodyEl.cloneNode(false);
    measurer.classList.add("dialogue-text__body--measure");
    const bodyRect = this.bodyEl.getBoundingClientRect();
    measurer.style.width = `${bodyRect.width}px`;
    this.dialogueBox.appendChild(measurer);
    return measurer;
  }

  getTwoLineHeight() {
    const style = getComputedStyle(this.bodyEl);
    const fontSize = parseFloat(style.fontSize);
    const lineHeight = parseFloat(style.lineHeight);
    if (Number.isFinite(lineHeight)) return lineHeight * 2 + 1;
    return fontSize * 1.35 * 2 + 1;
  }

  findNaturalBreakIndex(text) {
    const breakMarks = ["。", ".", "!", "?", "…", ",", "，", "、", " "];
    let best = -1;
    for (const mark of breakMarks) {
      const index = text.lastIndexOf(mark);
      if (index > best) best = index;
    }
    return best;
  }

  splitTextIntoPages(rawText) {
    const text = this.normalizeText(rawText);
    if (!text) return [""];

    const measurer = this.createMeasurer();
    const maxHeight = this.getTwoLineHeight();
    const pages = [];
    let remaining = text;

    while (remaining.length > 0) {
      let low = 1;
      let high = remaining.length;
      let best = 0;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        measurer.textContent = remaining.slice(0, mid);
        if (measurer.scrollHeight <= maxHeight) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (best <= 0) best = 1;

      let cutIndex = best;
      if (best < remaining.length) {
        const candidate = remaining.slice(0, best);
        const naturalBreakIndex = this.findNaturalBreakIndex(candidate);
        if (naturalBreakIndex > candidate.length * 0.55) {
          cutIndex = naturalBreakIndex + 1;
        }
      }

      let pageText = remaining.slice(0, cutIndex).trimEnd();
      if (!pageText) {
        pageText = remaining.slice(0, best);
        cutIndex = best;
      }

      pages.push(pageText);
      remaining = remaining.slice(cutIndex).trimStart();
    }

    measurer.remove();
    return pages;
  }

  setProfileImage(url) {
    this.profileImageEl.setAttribute("href", url);
    this.profileImageEl.setAttributeNS(XLINK_NS, "href", url);
  }

  renderLine(index = this.dialogueIndex, pageMode = "first") {
    this.dialogueIndex = index;
    const line = this.lines[this.dialogueIndex];
    if (!line) return;

    this.nameEl.textContent = line.name;
    this.setProfileImage(line.image);

    const previousPageIndex = this.pageIndex;
    this.currentPages = this.splitTextIntoPages(line.text);

    if (pageMode === "last") {
      this.pageIndex = this.currentPages.length - 1;
    } else if (pageMode === "preserve") {
      this.pageIndex = Math.min(previousPageIndex, this.currentPages.length - 1);
    } else {
      this.pageIndex = 0;
    }

    this.renderPage();
  }

  renderPage() {
    this.bodyEl.textContent = this.currentPages[this.pageIndex] ?? "";

    const hasPrevPage = this.pageIndex > 0;
    const hasPrevDialogue = this.dialogueIndex > 0;
    const hasNextPage = this.pageIndex < this.currentPages.length - 1;
    const hasNextDialogue = this.dialogueIndex < this.lines.length - 1;
    // The next button stays interactive at the end so the player can finish the
    // sequence (which fires onComplete and closes the overlay). On that final page it
    // swaps to the "end/confirm" icon.
    this.prevBtn.hidden = !(hasPrevPage || hasPrevDialogue);
    this.nextBtn.hidden = false;
    this.nextBtn.classList.toggle("is-final", !(hasNextPage || hasNextDialogue));
  }

  prev() {
    if (!this.isOpen) return;
    if (this.pageIndex > 0) {
      this.pageIndex -= 1;
      this.renderPage();
      return;
    }
    if (this.dialogueIndex > 0) {
      this.renderLine(this.dialogueIndex - 1, "last");
    }
  }

  next() {
    if (!this.isOpen) return;
    if (this.pageIndex < this.currentPages.length - 1) {
      this.pageIndex += 1;
      this.renderPage();
      return;
    }
    if (this.dialogueIndex < this.lines.length - 1) {
      this.renderLine(this.dialogueIndex + 1, "first");
      return;
    }
    this.complete();
  }

  complete() {
    const completedId = this.activeDialogueId;
    this.close();
    this.onComplete?.(completedId);
  }

  onResize() {
    if (!this.isOpen) return;
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.renderLine(this.dialogueIndex, "preserve");
    }, 100);
  }

  dispose() {
    clearTimeout(this.resizeTimer);
    clearTimeout(this.glitchTimer);
    this.prevBtn.removeEventListener("click", this.boundPrev);
    this.nextBtn.removeEventListener("click", this.boundNext);
    window.removeEventListener("resize", this.boundResize);
    this.dimmer?.removeEventListener("pointerdown", this.boundDimmerPointerDown);
  }
}
