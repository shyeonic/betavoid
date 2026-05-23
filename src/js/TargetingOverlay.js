const LOCK_INTRO_DURATION = 820;
const TARGET_ICON_SCALE = 0.5;
const TARGET_ICON_TRANSITION_DURATION = 520;
const TARGET_ICON_INTRO_DURATION = 520;
const TARGET_ICON_INTRO_RISE_UNIT = 1.5;
const TARGET_ICON_EDGE_PADDING = 8;

export class TargetingOverlay {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.iconImages = new Map();
    this.frameState = {
      key: null,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      side: 0
    };
    this.iconTransition = {
      key: null,
      fromMode: "center",
      toMode: "center",
      startedAt: 0
    };
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.floor(window.innerWidth);
    this.height = Math.floor(window.innerHeight);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  render(target, now = performance.now()) {
    this.clear();
    if (!target) {
      this.frameState.key = null;
      this.iconTransition.key = null;
      return null;
    }

    const baseFrame = this.calculateSquareFrame(target);
    if (!baseFrame || baseFrame.side < 10) return null;
    if (target.iconOnly) {
      this.drawTypeIcon(target, baseFrame, now);
      return baseFrame;
    }

    const frame = this.resolveDisplayFrame(target, baseFrame);
    this.drawLockFrame(target, frame, now);
    return frame;
  }

  calculateSquareFrame(target) {
    const center = target.screenCenter;
    if (!center) return null;

    const metrics = this.getSelectionFrameMetrics();
    const radius = target.forceMinimumSide ? 0 : Math.max(0, Number(target.radius) || 0);
    const depth = Number(target.depth);
    const focal = Number(target.focal);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(depth) || !Number.isFinite(focal)) return null;

    const nearestDepth = Math.max(depth - radius, 0.18);
    const projectedRadius = radius > 0
      ? (radius / nearestDepth) * focal
      : 0;
    const margin = clamp(projectedRadius * 0.18, 16, 34);
    const rawSide = projectedRadius * 2 + margin * 2;
    const maxSelectionSide = Math.min(this.width, this.height) * 0.92;
    const minSelectionSide = Math.min(metrics.minSelectionSide, maxSelectionSide);
    const side = clamp(rawSide, minSelectionSide, maxSelectionSide);
    const half = side / 2;

    return {
      minX: center.x - half,
      maxX: center.x + half,
      minY: center.y - half,
      maxY: center.y + half,
      cx: center.x,
      cy: center.y,
      side
    };
  }

  resolveDisplayFrame(target, frame) {
    if (this.frameState.key !== target.key) {
      this.frameState = { key: target.key, ...frame };
      return frame;
    }

    if (!target.smoothFrame) {
      this.frameState = { key: target.key, ...frame };
      return frame;
    }

    const amount = 0.16;
    this.frameState.minX = lerp(this.frameState.minX, frame.minX, amount);
    this.frameState.minY = lerp(this.frameState.minY, frame.minY, amount);
    this.frameState.maxX = lerp(this.frameState.maxX, frame.maxX, amount);
    this.frameState.maxY = lerp(this.frameState.maxY, frame.maxY, amount);
    this.frameState.cx = lerp(this.frameState.cx, frame.cx, amount);
    this.frameState.cy = lerp(this.frameState.cy, frame.cy, amount);
    this.frameState.side = lerp(this.frameState.side, frame.side, amount);
    return { ...this.frameState };
  }

  drawLockFrame(target, frame, now) {
    const metrics = this.getSelectionFrameMetrics();
    const elapsed = Math.max(0, now - (target.startedAt ?? now));
    const intro = this.getLockFrameIntro(elapsed, metrics);
    const frameMinX = frame.minX - intro.frameOutset;
    const frameMinY = frame.minY - intro.frameOutset;
    const frameMaxX = frame.maxX + intro.frameOutset;
    const frameMaxY = frame.maxY + intro.frameOutset;
    const ctx = this.ctx;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "square";
    ctx.lineJoin = "miter";
    ctx.lineWidth = metrics.hoverLineWidth;

    this.drawAnimatedDoubleCornerGroup(frameMinX, frameMinY, 1, 1, intro, metrics);
    this.drawAnimatedDoubleCornerGroup(frameMaxX, frameMinY, -1, 1, intro, metrics);
    this.drawAnimatedDoubleCornerGroup(frameMaxX, frameMaxY, -1, -1, intro, metrics);
    this.drawAnimatedDoubleCornerGroup(frameMinX, frameMaxY, 1, -1, intro, metrics);
    ctx.restore();

    this.drawTypeIcon(target, frame, now);
  }

  drawTypeIcon(target, frame, now) {
    const metrics = this.getSelectionFrameMetrics();
    const size = metrics.minSelectionSide * TARGET_ICON_SCALE;
    this.updateIconTransition(target, frame, metrics, now);
    const anchor = this.getIconAnchor(frame, metrics, size, now);
    const intro = this.getIconIntro(target, metrics, now);
    const x = this.clampIconX(anchor.x - size * 0.5, size);
    const y = this.clampIconY(anchor.y - size * 0.5 + intro.riseOffset, size);
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = intro.alpha;
    const image = this.getIconImage(target.iconUrl);
    if (image?.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, x, y, size, size);
    }
    ctx.restore();
  }

  clampIconX(x, size) {
    const maxX = Math.max(TARGET_ICON_EDGE_PADDING, this.width - size - TARGET_ICON_EDGE_PADDING);
    return clamp(x, TARGET_ICON_EDGE_PADDING, maxX);
  }

  clampIconY(y, size) {
    const maxY = Math.max(TARGET_ICON_EDGE_PADDING, this.height - size - TARGET_ICON_EDGE_PADDING);
    return clamp(y, TARGET_ICON_EDGE_PADDING, maxY);
  }

  updateIconTransition(target, frame, metrics, now) {
    const nextMode = this.getIconLayoutMode(frame, metrics);
    if (this.iconTransition.key !== target.key) {
      this.iconTransition = {
        key: target.key,
        fromMode: nextMode,
        toMode: nextMode,
        startedAt: now
      };
      return;
    }

    if (this.isIconTransitionActive(now)) return;
    if (nextMode === this.iconTransition.toMode) return;

    this.iconTransition.fromMode = this.iconTransition.toMode;
    this.iconTransition.toMode = nextMode;
    this.iconTransition.startedAt = now;
  }

  getIconAnchor(frame, metrics, size, now) {
    const progress = this.getIconTransitionProgress(now);
    const eased = easeInOutCubic(progress);
    const fromAnchor = this.getIconAnchorForMode(frame, size, this.iconTransition.fromMode);
    const toAnchor = this.getIconAnchorForMode(frame, size, this.iconTransition.toMode);
    return {
      x: lerp(fromAnchor.x, toAnchor.x, eased),
      y: lerp(fromAnchor.y, toAnchor.y, eased)
    };
  }

  getIconAnchorForMode(frame, size, mode) {
    if (mode === "center") {
      return {
        x: frame.minX + frame.side * 0.5,
        y: frame.minY + frame.side * 0.5
      };
    }

    return {
      x: frame.minX + size * 0.5,
      y: frame.minY + size * 0.5
    };
  }

  getIconIntro(target, metrics, now) {
    const elapsed = Math.max(0, now - (target.startedAt ?? now));
    const progress = clamp(elapsed / TARGET_ICON_INTRO_DURATION, 0, 1);
    const eased = easeOutCubic(progress);
    const rise = Math.round(metrics.unit * TARGET_ICON_INTRO_RISE_UNIT);
    return {
      alpha: eased,
      riseOffset: lerp(rise, 0, eased)
    };
  }

  getIconLayoutMode(frame, metrics) {
    return frame.side <= metrics.minSelectionSide + 0.001 ? "center" : "topLeft";
  }

  isIconTransitionActive(now) {
    return this.getIconTransitionProgress(now) < 1;
  }

  getIconTransitionProgress(now) {
    return clamp((now - this.iconTransition.startedAt) / TARGET_ICON_TRANSITION_DURATION, 0, 1);
  }

  getIconImage(url) {
    if (!url) return null;
    if (this.iconImages.has(url)) return this.iconImages.get(url);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    this.iconImages.set(url, image);
    return image;
  }

  getSelectionFrameMetrics() {
    const vh = this.height * 0.01;
    const unit = clamp(vh, 7, 11);
    const hoverCorner = unit * 2.0;
    const hoverOffset = unit * 0.72;
    const doubleGap = -4;
    const doubleOuterCorner = hoverCorner * 0.92;
    const doubleInnerCorner = hoverCorner * 0.82;
    const cornerReach = Math.max(doubleOuterCorner, 6 + doubleInnerCorner);
    const minSelectionSide = Math.ceil((hoverOffset + cornerReach) * 2 + unit * 1.35);

    return {
      hoverCorner,
      hoverOffset,
      unit,
      hoverLineWidth: clamp(unit * 0.13, 1, 1.45),
      doubleOuterCorner,
      doubleInnerCorner,
      doubleGap,
      minSelectionSide,
      introFrameOutset: unit * 3.25,
      connectorDrop: unit * 2.0,
      frameAlpha: 0.15,
      frameAlphaSoft: 0.45
    };
  }

  getLockFrameIntro(elapsed, metrics) {
    const p = saturate(elapsed / LOCK_INTRO_DURATION);
    const segment1End = 0.42;
    const settle = easeOutCubic((p - segment1End) / (1 - segment1End));
    const blinkA = smoothPulse(p, 0.04, 0.15);
    const blinkB = smoothPulse(p, 0.23, 0.34);
    const settleAlpha = smoothstep(0.39, 0.56, p);
    const alpha = Math.max(blinkA, blinkB, settleAlpha);
    const gap = lerp(10, metrics.doubleGap, settle);
    const frameOutset = lerp(metrics.introFrameOutset, 0, settle);

    return { alpha, gap, frameOutset };
  }

  drawAnimatedDoubleCornerGroup(baseX, baseY, sx, sy, intro, metrics) {
    const offset = metrics.hoverOffset;
    const x = baseX + sx * offset;
    const y = baseY + sy * offset;
    const gap = intro.gap;
    const outerLen = metrics.doubleOuterCorner;
    const innerLen = metrics.doubleInnerCorner;

    this.ctx.strokeStyle = selectionFrameStroke("#0000ff", metrics.frameAlpha * intro.alpha);
    this.drawCorner(x, y, sx * outerLen, sy * outerLen);

    this.ctx.strokeStyle = selectionFrameStroke("#0000ff", metrics.frameAlphaSoft * intro.alpha);
    this.drawCorner(x + sx * gap, y + sy * gap, sx * innerLen, sy * innerLen);
  }

  drawCorner(x, y, dx, dy) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y + dy);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx, y);
    ctx.stroke();
  }

  dispose() {
    this.clear();
    this.iconImages.clear();
  }
}

function selectionFrameStroke(hex, alpha) {
  const color = hexToRgb(hex);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function saturate(v) {
  return clamp(v, 0, 1);
}

function smoothstep(edge0, edge1, x) {
  const t = saturate((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}

function easeOutCubic(t) {
  t = saturate(t);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
  t = saturate(t);
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function smoothPulse(t, start, end) {
  const mid = (start + end) * 0.5;
  const rise = smoothstep(start, mid, t);
  const fall = 1 - smoothstep(mid, end, t);
  return rise * fall;
}
