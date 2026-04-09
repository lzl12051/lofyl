<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { DiscArtworkMode, DiscSide, TonearmState } from '../types';
  import {
    sideTimeToRadius,
    trackOffsetToRadius,
    getPlayableInnerRadius,
    GROOVE_OUTER_RADIUS,
    GROOVE_INNER_RADIUS,
    LABEL_RADIUS,
  } from './needleMapper';

  export let side: DiscSide | null = null;
  export let currentTime: number = 0;
  export let isPlaying: boolean = false;
  export let isPlatterSpinning: boolean = false;
  export let tonearmState: TonearmState = 'parked';
  export let musicMeterLevels: number[] = [];
  export let isSpectrumEnabled: boolean = true;
  export let discArtworkUrl: string | undefined = undefined;
  export let artworkMode: DiscArtworkMode = 'centered';
  export let onSeek: (timeInSide: number) => void = () => {};
  export let onTogglePlay: () => void = () => {};
  export let onToggleSpectrum: () => void = () => {};
  export let onNeedleDragStart: () => void = () => {};
  export let onNeedleDrop: (timeInSide: number | null) => void = () => {};
  export let onArtworkModeChange: (mode: DiscArtworkMode) => void = () => {};

  // ── 切换动画 ──────────────────────────────────────────────────
  // 'swap'  换碟/换专辑：封套从顶部伸入，唱片浮起插回封套
  // 'flip'  翻面（同一张碟）：唱片浮起并绕轴翻转
  export let swapAnim: 'idle' | 'swap' | 'flip' = 'idle';
  export let swapFromCoverUrl: string | undefined = undefined;
  export let swapToCoverUrl: string | undefined = undefined;
  export let swapFromDiscArtworkUrl: string | undefined = undefined;
  export let swapToDiscArtworkUrl: string | undefined = undefined;
  export let swapFromSideLabel: string | undefined = undefined;
  export let swapToSideLabel: string | undefined = undefined;

  const SPECTRUM_ROW_COUNT = 6;
  const SPECTRUM_COLUMN_COUNT = 16;
  const SPECTRUM_ROWS = Array.from({ length: SPECTRUM_ROW_COUNT }, (_, index) => index);
  const EMPTY_SPECTRUM_LEVELS = Array.from({ length: SPECTRUM_COLUMN_COUNT }, () => 0);
  let displayedSpectrumLevels: number[] = EMPTY_SPECTRUM_LEVELS;

  let wrapElement: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let animationId: number | null = null;
  let coverImage: HTMLImageElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let scheduledSyncId: number | null = null;
  let isDraggingNeedle = false;
  let isNeedleHovering = false;
  let activePointerId: number | null = null;
  let dragPreviewTime: number | null = null;
  let dragArmAngle: number | null = null;
  let isManualCarryDrag = false;
  let canvasDisplaySize = 0;
  let renderDpr = 1;
  let coverImageVersion = 0;
  let machineLayer: HTMLCanvasElement | null = null;
  let platterLayer: HTMLCanvasElement | null = null;
  let discBaseLayer: HTMLCanvasElement | null = null;
  let discLightingLayer: HTMLCanvasElement | null = null;
  let platterShadowLayer: HTMLCanvasElement | null = null;
  let platterHighlightsLayer: HTMLCanvasElement | null = null;
  let discShadowLayer: HTMLCanvasElement | null = null;
  let spindleLayer: HTMLCanvasElement | null = null;
  let machineLayerDirty = true;
  let platterLayerDirty = true;
  let discBaseLayerDirty = true;
  let discLightingLayerDirty = true;
  let staticLayersDirty = true;

  // CSS 逻辑像素尺寸（用于所有绘图计算）
  let drawW = 0;
  let drawH = 0;

  let platAngle = 0;
  let platterSpeed = 0;
  let lastTimestamp = 0;
  let platterSpeedFrom = 0;
  let platterSpeedTo = 0;
  let platterSpeedAnimStart = 0;
  let platterSpeedAnimDuration = 0;
  let cueStartAngle = 0;
  let cueTargetAngle = 0;
  let cueAnimStart = 0;
  let cueAnimDuration = 0;
  let dropAnimStart = 0;
  let dropAnimDuration = 0;
  let tonearmLiftPx = 0;
  let tonearmAngleJolt = 0;
  // 停止时抬臂归位动画
  let returnAnimStart = 0;
  let returnAnimDuration = 0;
  let returnArmFromAngle = 0;
  // cueing 入场时平滑抬臂（避免 tonearmLiftPx 瞬跳）
  let cueLiftAnimStart = 0;
  let cueLiftFrom = 0;
  const CUE_LIFT_MS = 420;
  let previousTonearmState: TonearmState = tonearmState;
  let previousPlatterSpin = isPlatterSpinning;
  const RPM = 33.333;
  const RAD_PER_SEC = (RPM / 60) * 2 * Math.PI;
  const PLATTER_SPINUP_MS = 2300;
  const PLATTER_SPINDOWN_MS = 1200;
  const TONEARM_RETURN_MS = 1200;
  const TONEARM_CUE_MS = 1500;
  const TONEARM_DROP_MS = 700;
  const CENTER_X_NORM = 0.5;
  const CENTER_Y_NORM = 0.462;
  const PLATTER_RADIUS_NORM = 0.4;
  const DISC_RADIUS_NORM = 0.382;
  const RECORD_ECCENTRICITY_NORM = 0.0022;
  const PIVOT_X_CANVAS_NORM = 0.955;
  const PIVOT_Y_CANVAS_NORM = 0.077;
  const NEEDLE_DRAG_HIT_RADIUS = 18;
  const MAX_RENDER_DPR = 1.5;
  const PLAYBACK_TARGET_FPS = 48;
  const PLAYBACK_FRAME_INTERVAL_MS = 1000 / PLAYBACK_TARGET_FPS;
  let lastPaintTimestamp = 0;

  // 唱臂枢轴（归一化，相对于碟心和碟片半径）
  // 目标造型：
  // 1. 底座位于唱机右上
  // 2. 停靠时唱臂在唱片右侧，竖直向下
  // 3. 播放时唱针从右侧外圈进入唱片，并沿刻槽向内摆动
  const ARM_LENGTH_NORM = 1.24;
  const ARM_PARKED_ANGLE = Math.PI / 2;

  let animatedArmAngle = ARM_PARKED_ANGLE;

  $: effectiveTime = dragPreviewTime ?? currentTime;
  $: needleRadius = side ? sideTimeToRadius(effectiveTime, side.totalDuration) : GROOVE_OUTER_RADIUS;
  $: transportEngaged =
    isPlaying ||
    isPlatterSpinning ||
    tonearmState === 'cueing' ||
    tonearmState === 'dropping' ||
    tonearmState === 'holding';
  let prevLitPattern: number[] = [];
  $: {
    const rawLevels =
      isSpectrumEnabled && musicMeterLevels.length > 0
        ? musicMeterLevels
        : EMPTY_SPECTRUM_LEVELS;
    const newPattern = rawLevels.map((l) => getSpectrumLitRows(l));
    if (newPattern.length !== prevLitPattern.length || newPattern.some((v, i) => v !== prevLitPattern[i])) {
      prevLitPattern = newPattern;
      displayedSpectrumLevels = rawLevels;
    }
  }

  // Trigger canvas redraw when currentTime changes during playback
  $: if (currentTime && transportEngaged) {
    requestDraw();
  }

  function getSpectrumLitRows(level: number): number {
    return Math.max(
      0,
      Math.min(SPECTRUM_ROW_COUNT, Math.floor(level * (SPECTRUM_ROW_COUNT + 0.35))),
    );
  }

  function easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  // 重力落针感：前段慢、加速明显
  function easeInQuart(t: number): number {
    return t * t * t * t;
  }

  // 转盘缓停：先快后拖尾
  function easeOutQuart(t: number): number {
    return 1 - Math.pow(1 - t, 4);
  }

  function drawSpacedText(text: string, x: number, y: number, tracking: number) {
    const chars = [...text];
    const totalWidth =
      chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) +
      tracking * Math.max(0, chars.length - 1);
    let cursor = x - totalWidth / 2;

    for (const char of chars) {
      const width = ctx.measureText(char).width;
      ctx.fillText(char, cursor + width / 2, y);
      cursor += width + tracking;
    }
  }

  function isAnimating(): boolean {
    return (
      platterSpeed > 0 ||
      platterSpeedAnimDuration > 0 ||
      cueAnimDuration > 0 ||
      dropAnimDuration > 0 ||
      returnAnimDuration > 0 ||
      isDraggingNeedle ||
      Math.abs(animatedArmAngle - resolveTargetArmAngle()) > 0.001
    );
  }

  function requestDraw() {
    if (animationId === null) {
      lastTimestamp = 0;
      lastPaintTimestamp = 0;
      animationId = requestAnimationFrame(draw);
    }
  }

  function resolveRenderDpr(width: number, height: number): number {
    const deviceDpr = window.devicePixelRatio || 1;
    const pixelArea = width * height;
    let cap = MAX_RENDER_DPR;

    if (pixelArea >= 540_000) {
      cap = 1;
    } else if (pixelArea >= 360_000) {
      cap = 1.15;
    } else if (pixelArea >= 250_000) {
      cap = 1.25;
    }

    return Math.min(deviceDpr, cap);
  }

  function startPlatterSpeedAnimation(nextSpeed: number) {
    const now = performance.now();
    platterSpeedFrom = platterSpeed;
    platterSpeedTo = nextSpeed;
    platterSpeedAnimStart = now;
    platterSpeedAnimDuration = nextSpeed > platterSpeed ? PLATTER_SPINUP_MS : PLATTER_SPINDOWN_MS;
    requestDraw();
  }

  function startCueAnimation(nextAngle: number) {
    cueStartAngle = animatedArmAngle;
    cueTargetAngle = nextAngle;
    cueAnimStart = performance.now();
    cueAnimDuration = TONEARM_CUE_MS;
    requestDraw();
  }

  function startDropAnimation() {
    dropAnimStart = performance.now();
    dropAnimDuration = TONEARM_DROP_MS;
    requestDraw();
  }

  $: if (isPlatterSpinning !== previousPlatterSpin) {
    startPlatterSpeedAnimation(isPlatterSpinning ? 1 : 0);
    previousPlatterSpin = isPlatterSpinning;
  }

  $: if (tonearmState !== previousTonearmState) {
    if (tonearmState === 'cueing') {
      startCueAnimation(computeArmAngle(needleRadius));
      // 记录当前 lift 值，在 draw 里动画过渡到 7，避免瞬跳
      cueLiftFrom = tonearmLiftPx;
      cueLiftAnimStart = performance.now();
      tonearmAngleJolt = 0;
    } else if (tonearmState === 'holding') {
      cueAnimDuration = 0;
      dropAnimDuration = 0;
      returnAnimDuration = 0;
      animatedArmAngle = resolveTargetArmAngle();
      tonearmLiftPx = 7;
      tonearmAngleJolt = 0;
      requestDraw();
    } else if (tonearmState === 'dropping') {
      startDropAnimation();
    } else if (tonearmState === 'parked') {
      dropAnimDuration = 0;
      cueAnimDuration = 0;
      tonearmAngleJolt = 0;
      if (previousTonearmState === 'playing' && dragPreviewTime === null) {
        // 播放中停止 → 先完整抬臂归位，再允许后续换面/换碟动画接管
        returnArmFromAngle = animatedArmAngle;
        returnAnimStart = performance.now();
        returnAnimDuration = TONEARM_RETURN_MS;
        requestDraw();
      } else {
        returnAnimDuration = 0;
        tonearmLiftPx = 0;
        requestDraw();
      }
    }
    previousTonearmState = tonearmState;
  }

  // swapAnim 变化时（尤其是从动画态恢复到 idle），确保 canvas 重绘碟面。
  // 当转盘静止时 rAF 循环可能已停止，需手动触发一帧。
  $: {
    swapAnim;
    requestDraw();
  }

  // 偏心孔的视觉模型：整张唱片以“一圈一次”的节奏围绕主轴轻微平移，
  // 唱臂角度也解同一个几何约束，这样两者会保持同相。
  function getRecordCenterOffsetNorm() {
    return {
      x: Math.cos(platAngle) * RECORD_ECCENTRICITY_NORM,
      y: Math.sin(platAngle) * RECORD_ECCENTRICITY_NORM,
    };
  }

  function getRecordCenterOffsetPx(discRadius: number) {
    const offset = getRecordCenterOffsetNorm();
    return {
      x: offset.x * discRadius,
      y: offset.y * discRadius,
    };
  }

  function solveStylusPosition(
    radius: number,
    pivotX: number,
    pivotY: number,
    recordCenterX: number = 0,
    recordCenterY: number = 0,
  ) {
    const clampedRadius = Math.max(GROOVE_INNER_RADIUS, Math.min(GROOVE_OUTER_RADIUS, radius));
    const centerToPivotX = pivotX - recordCenterX;
    const centerToPivotY = pivotY - recordCenterY;
    const pivotToCenter = Math.hypot(centerToPivotX, centerToPivotY);

    // 圆与圆求交：唱针既在唱片半径 clampedRadius 上，也在以枢轴为圆心、
    // 唱臂长度为半径的轨迹上。选 y 更大的交点，让唱针落在唱片右下侧。
    const a =
      (clampedRadius * clampedRadius - ARM_LENGTH_NORM * ARM_LENGTH_NORM + pivotToCenter * pivotToCenter)
      / (2 * pivotToCenter);
    const h = Math.sqrt(Math.max(0, clampedRadius * clampedRadius - a * a));
    const baseX = recordCenterX + (a * centerToPivotX) / pivotToCenter;
    const baseY = recordCenterY + (a * centerToPivotY) / pivotToCenter;
    const offsetX = (-centerToPivotY / pivotToCenter) * h;
    const offsetY = (centerToPivotX / pivotToCenter) * h;

    const candidateA = { x: baseX + offsetX, y: baseY + offsetY };
    const candidateB = { x: baseX - offsetX, y: baseY - offsetY };
    const stylus = candidateA.y > candidateB.y ? candidateA : candidateB;

    return {
      x: stylus.x,
      y: stylus.y,
      armAngle: Math.atan2(stylus.y - pivotY, stylus.x - pivotX),
      discAngle: Math.atan2(stylus.y - recordCenterY, stylus.x - recordCenterX),
    };
  }

  function getTurntableGeometry(W: number, H: number) {
    const base = Math.min(W, H);
    return {
      cx: W * CENTER_X_NORM,
      cy: H * CENTER_Y_NORM,
      platterRadius: base * PLATTER_RADIUS_NORM,
      discRadius: base * DISC_RADIUS_NORM,
    };
  }

  function getTonearmGeometry(W: number, H: number) {
    const turntable = getTurntableGeometry(W, H);
    const pivotX = W * PIVOT_X_CANVAS_NORM;
    const pivotY = H * PIVOT_Y_CANVAS_NORM;

    return {
      ...turntable,
      pivotX,
      pivotY,
      pivotNormX: (pivotX - turntable.cx) / turntable.discRadius,
      pivotNormY: (pivotY - turntable.cy) / turntable.discRadius,
      armLengthPx: turntable.discRadius * ARM_LENGTH_NORM,
    };
  }

  function computeArmAngle(radius: number): number {
    if (!drawW || !drawH) return ARM_PARKED_ANGLE;
    const { pivotNormX, pivotNormY } = getTonearmGeometry(drawW, drawH);
    const recordOffset = getRecordCenterOffsetNorm();
    return solveStylusPosition(
      radius,
      pivotNormX,
      pivotNormY,
      recordOffset.x,
      recordOffset.y,
    ).armAngle;
  }

  function resolveTargetArmAngle(radius: number = needleRadius): number {
    if (
      tonearmState === 'playing' ||
      tonearmState === 'holding' ||
      tonearmState === 'cueing' ||
      tonearmState === 'dropping' ||
      dragPreviewTime !== null ||
      dragArmAngle !== null
    ) {
      return dragArmAngle ?? computeArmAngle(radius);
    }

    return ARM_PARKED_ANGLE;
  }

  function syncLayoutBox() {
    if (!wrapElement) return;

    const availableWidth = wrapElement.clientWidth;
    const availableHeight = wrapElement.clientHeight;
    const nextSize = Math.floor(Math.max(0, Math.min(availableWidth, availableHeight)));

    if (Number.isFinite(nextSize) && nextSize > 0) {
      canvasDisplaySize = nextSize;
    }
  }

  function syncCanvasSize() {
    if (!canvas || !ctx) return;
    syncLayoutBox();

    const nextDrawW = canvasDisplaySize || canvas.clientWidth;
    const nextDrawH = canvasDisplaySize || canvas.clientHeight || nextDrawW;
    const dpr = resolveRenderDpr(nextDrawW, nextDrawH);

    if (!nextDrawW || !nextDrawH) return;
    if (drawW === nextDrawW && drawH === nextDrawH && canvas.width === nextDrawW * dpr && canvas.height === nextDrawH * dpr) {
      return;
    }

    drawW = nextDrawW;
    drawH = nextDrawH;
    renderDpr = dpr;
    canvas.width = Math.round(drawW * dpr);
    canvas.height = Math.round(drawH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    machineLayerDirty = true;
    platterLayerDirty = true;
    discBaseLayerDirty = true;
    discLightingLayerDirty = true;
    staticLayersDirty = true;

    // 调整 canvas 内部分辨率会立即清空当前画面。
    // 这里先把上一版缓存层按新尺寸回填到主画布，避免 resize 时出现整块空白。
    paintFrame({ rebuildLayers: false });
  }

  function scheduleCanvasSync() {
    if (scheduledSyncId !== null) {
      cancelAnimationFrame(scheduledSyncId);
    }

    scheduledSyncId = requestAnimationFrame(() => {
      scheduledSyncId = null;
      syncCanvasSize();
      requestDraw();
    });
  }

  function createRenderLayer(): HTMLCanvasElement | null {
    if (!drawW || !drawH) return null;
    const layer = document.createElement('canvas');
    layer.width = Math.round(drawW * renderDpr);
    layer.height = Math.round(drawH * renderDpr);
    const layerCtx = layer.getContext('2d');
    if (!layerCtx) return null;
    layerCtx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
    const previousCtx = ctx;
    ctx = layerCtx;
    ctx.clearRect(0, 0, drawW, drawH);
    return layer;
  }

  function finalizeRenderLayer(layer: HTMLCanvasElement | null, previousCtx: CanvasRenderingContext2D) {
    ctx = previousCtx;
    return layer;
  }

  function rebuildMachineLayer() {
    if (!ctx) return;
    const previousCtx = ctx;
    const layer = createRenderLayer();
    if (!layer) return;
    drawMachineSurface(drawW, drawH);
    machineLayer = finalizeRenderLayer(layer, previousCtx);
    machineLayerDirty = false;
  }

  function rebuildPlatterLayer() {
    if (!ctx) return;
    const previousCtx = ctx;
    const layer = createRenderLayer();
    if (!layer) return;
    drawPlatter(drawW, drawH, { applyTransform: false, includeShadow: false });
    platterLayer = finalizeRenderLayer(layer, previousCtx);
    platterLayerDirty = false;
  }

  function rebuildDiscLayers() {
    if (!ctx) return;

    {
      const previousCtx = ctx;
      const layer = createRenderLayer();
      if (!layer) return;
      drawDisc(drawW, drawH, {
        applyRotation: false,
        includeLighting: false,
        applyEccentricity: false,
      });
      if (side) drawTrackMarkers(drawW, drawH, false);
      discBaseLayer = finalizeRenderLayer(layer, previousCtx);
      discBaseLayerDirty = false;
    }

    {
      const previousCtx = ctx;
      const layer = createRenderLayer();
      if (!layer) return;
      drawDiscLightingLayer(drawW, drawH, false);
      discLightingLayer = finalizeRenderLayer(layer, previousCtx);
      discLightingLayerDirty = false;
    }
  }

  function rebuildStaticLayers() {
    if (!ctx) return;

    {
      const previousCtx = ctx;
      const layer = createRenderLayer();
      if (!layer) return;
      drawPlatterShadow(drawW, drawH);
      platterShadowLayer = finalizeRenderLayer(layer, previousCtx);
    }

    {
      const previousCtx = ctx;
      const layer = createRenderLayer();
      if (!layer) return;
      drawPlatterStaticHighlights(drawW, drawH);
      platterHighlightsLayer = finalizeRenderLayer(layer, previousCtx);
    }

    {
      const previousCtx = ctx;
      const layer = createRenderLayer();
      if (!layer) return;
      const { cx, cy, discRadius } = getTurntableGeometry(drawW, drawH);
      drawDiscShadow(cx, cy, discRadius);
      discShadowLayer = finalizeRenderLayer(layer, previousCtx);
    }

    {
      const previousCtx = ctx;
      const layer = createRenderLayer();
      if (!layer) return;
      drawSpindle(drawW, drawH);
      spindleLayer = finalizeRenderLayer(layer, previousCtx);
    }

    staticLayersDirty = false;
  }

  function ensureRenderLayers() {
    if (machineLayerDirty || !machineLayer) rebuildMachineLayer();
    if (platterLayerDirty || !platterLayer) rebuildPlatterLayer();
    if (discBaseLayerDirty || !discBaseLayer || discLightingLayerDirty || !discLightingLayer) {
      rebuildDiscLayers();
    }
    if (staticLayersDirty || !platterShadowLayer || !platterHighlightsLayer || !discShadowLayer || !spindleLayer) {
      rebuildStaticLayers();
    }
  }

  function shouldThrottlePlaybackFrame(): boolean {
    return (
      platterSpeed > 0 &&
      platterSpeedAnimDuration === 0 &&
      cueAnimDuration === 0 &&
      dropAnimDuration === 0 &&
      returnAnimDuration === 0 &&
      !isDraggingNeedle &&
      dragPreviewTime === null &&
      dragArmAngle === null &&
      tonearmState === 'playing'
    );
  }

  function paintFrame({ rebuildLayers = true }: { rebuildLayers?: boolean } = {}) {
    if (!ctx || drawW === 0 || drawH === 0) return;

    const W = drawW;
    const H = drawH;
    const turntable = getTurntableGeometry(W, H);
    const recordOffset = getRecordCenterOffsetPx(turntable.discRadius);

    if (rebuildLayers) {
      ensureRenderLayers();
    }

    ctx.clearRect(0, 0, W, H);
    if (machineLayer) {
      ctx.drawImage(machineLayer, 0, 0, W, H);
    } else {
      drawMachineSurface(W, H);
    }

    if (platterShadowLayer) {
      ctx.drawImage(platterShadowLayer, 0, 0, W, H);
    } else {
      drawPlatterShadow(W, H);
    }

    if (platterLayer) {
      ctx.save();
      ctx.translate(turntable.cx, turntable.cy);
      ctx.rotate(platAngle);
      ctx.drawImage(platterLayer, -turntable.cx, -turntable.cy, W, H);
      ctx.restore();
    } else {
      drawPlatter(W, H);
    }

    if (platterHighlightsLayer) {
      ctx.drawImage(platterHighlightsLayer, 0, 0, W, H);
    } else {
      drawPlatterStaticHighlights(W, H);
    }
    if (swapAnim === 'idle') {
      if (discShadowLayer) {
        ctx.save();
        ctx.translate(recordOffset.x, recordOffset.y);
        ctx.drawImage(discShadowLayer, 0, 0, W, H);
        ctx.restore();
      } else {
        drawDiscShadow(turntable.cx + recordOffset.x, turntable.cy + recordOffset.y, turntable.discRadius);
      }

      if (discBaseLayer) {
        ctx.save();
        ctx.translate(turntable.cx + recordOffset.x, turntable.cy + recordOffset.y);
        ctx.rotate(platAngle);
        ctx.drawImage(discBaseLayer, -turntable.cx, -turntable.cy, W, H);
        ctx.restore();
      } else {
        drawDisc(W, H, { includeLighting: false });
        if (side) drawTrackMarkers(W, H);
      }

      if (discLightingLayer) {
        ctx.save();
        ctx.translate(recordOffset.x, recordOffset.y);
        ctx.drawImage(discLightingLayer, 0, 0, W, H);
        ctx.restore();
      } else {
        drawDiscLightingLayer(W, H);
      }
    }

    if (spindleLayer) {
      ctx.drawImage(spindleLayer, 0, 0, W, H);
    } else {
      drawSpindle(W, H);
    }

    drawTonearm(W, H);
  }

  function draw(timestamp: number) {
    if (!ctx || drawW === 0) {
      // 布局尺寸首帧有可能还是 0；如果这里直接 return，整条 rAF 渲染循环会永久中断。
      scheduleCanvasSync();
      animationId = requestAnimationFrame(draw);
      return;
    }

    if (
      shouldThrottlePlaybackFrame() &&
      lastPaintTimestamp !== 0 &&
      timestamp - lastPaintTimestamp < PLAYBACK_FRAME_INTERVAL_MS
    ) {
      animationId = requestAnimationFrame(draw);
      return;
    }

    const dt = lastTimestamp ? (timestamp - lastTimestamp) / 1000 : 0;
    lastTimestamp = timestamp;

    // ── 转盘转速动画（spinup/spindown）──────────────────────────
    if (platterSpeedAnimDuration > 0) {
      const pp = Math.min(1, (timestamp - platterSpeedAnimStart) / platterSpeedAnimDuration);
      // 加速：easeInOut；减速：线性匀减速（物理感真实，5 秒内均匀可见）
      const isSpinup = platterSpeedTo > platterSpeedFrom;
      const eased = isSpinup ? easeInOutCubic(pp) : pp;
      platterSpeed = platterSpeedFrom + (platterSpeedTo - platterSpeedFrom) * eased;
      if (pp >= 1) {
        platterSpeed = platterSpeedTo;
        platterSpeedAnimDuration = 0;
      }
    }
    platAngle += RAD_PER_SEC * platterSpeed * dt;
    const targetArmAngle = resolveTargetArmAngle();

    // ── 唱臂动画状态机 ─────────────────────────────────────────
    if (isDraggingNeedle) {
      animatedArmAngle = targetArmAngle;
      tonearmLiftPx = tonearmState === 'holding' ? 7 : 0;
      tonearmAngleJolt = 0;

    } else if (tonearmState === 'holding') {
      animatedArmAngle += (targetArmAngle - animatedArmAngle) * Math.min(1, dt * 8);
      tonearmLiftPx = 7;
      tonearmAngleJolt = 0;

    } else if (tonearmState === 'cueing' && cueAnimDuration > 0) {
      const cp = Math.min(1, (timestamp - cueAnimStart) / cueAnimDuration);
      animatedArmAngle = cueStartAngle + (cueTargetAngle - cueStartAngle) * easeInOutCubic(cp);
      // 抬臂从记录值平滑过渡到 7，消除瞬跳
      const lp = Math.min(1, (timestamp - cueLiftAnimStart) / CUE_LIFT_MS);
      tonearmLiftPx = cueLiftFrom + (7 - cueLiftFrom) * easeOutCubic(lp);
      tonearmAngleJolt = 0;
      if (cp >= 1) { animatedArmAngle = cueTargetAngle; cueAnimDuration = 0; }

    } else if (tonearmState === 'dropping' && dropAnimDuration > 0) {
      // ── 落针：稳稳落下，easeInOutCubic 全程无弹跳 ──────────
      const dp = Math.min(1, (timestamp - dropAnimStart) / dropAnimDuration);
      tonearmLiftPx = 7 * (1 - easeInOutCubic(dp));
      tonearmAngleJolt = 0;

      if (dp >= 1) {
        tonearmLiftPx = 0;
        tonearmAngleJolt = 0;
        dropAnimDuration = 0;
      }

    } else if (tonearmState === 'playing') {
      // 播放态直接使用当前时间对应的角度，避免插值滞后把唱针视觉上锁在旧位置。
      animatedArmAngle = targetArmAngle;
      tonearmLiftPx = 0;
      tonearmAngleJolt = 0;

    } else {
      // parked / 其他状态
      if (returnAnimDuration > 0 && dragPreviewTime === null) {
        // ── 抬臂归位动画 ──────────────────────────────────────
        const rp = Math.min(1, (timestamp - returnAnimStart) / returnAnimDuration);

        // 臂角：easeInOutCubic 整段归位，前段略慢（臂还在抬起时）
        animatedArmAngle = returnArmFromAngle +
          (ARM_PARKED_ANGLE - returnArmFromAngle) * easeInOutCubic(rp);

        // 升降曲线（5 秒总长）：
        //   0→8%  (~400ms)：缓缓抬起到 7px
        //   8→86% (~3900ms)：保持悬空，臂缓慢弧形回停靠位
        //   86→100% (~700ms)：柔和落入支架
        if (rp < 0.08) {
          tonearmLiftPx = 7 * easeOutCubic(rp / 0.08);
        } else if (rp < 0.86) {
          tonearmLiftPx = 7;
        } else {
          tonearmLiftPx = 7 * (1 - easeInOutCubic((rp - 0.86) / 0.14));
        }

        tonearmAngleJolt = 0;

        if (rp >= 1) {
          animatedArmAngle = ARM_PARKED_ANGLE;
          tonearmLiftPx = 0;
          returnAnimDuration = 0;
        }
      } else {
        animatedArmAngle += (targetArmAngle - animatedArmAngle) * Math.min(1, dt * 2.5);
        tonearmLiftPx = 0;
        tonearmAngleJolt = 0;
      }
    }

    paintFrame();
    lastPaintTimestamp = timestamp;

    if (isAnimating()) {
      animationId = requestAnimationFrame(draw);
    } else {
      animationId = null;
    }
  }

  function drawMachineSurface(W: number, H: number) {
    const base = Math.min(W, H);
    const R = 14;
    const FRONT_H = H * 0.1;
    const MAIN_H = H - FRONT_H;

    // ── 1. 机身主体：暖胡桃木 ───────────────────────────────────
    {
      const g = ctx.createLinearGradient(0, 0, W * 0.55, H * 0.88);
      g.addColorStop(0,    '#d4906c');
      g.addColorStop(0.18, '#c07850');
      g.addColorStop(0.46, '#a86238');
      g.addColorStop(0.72, '#985828');
      g.addColorStop(1,    '#7e4818');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, R);
      ctx.fill();
    }

    // ── 2. 木纹——主纹理 ─────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, W, MAIN_H, [R, R, 0, 0]);
    ctx.clip();

    for (let i = 0; i < 42; i++) {
      const t  = i / 42;
      const y  = H * (t * 1.1 - 0.05);
      const a1 = Math.sin(i * 0.91 + 0.4) * 7;
      const a2 = Math.sin(i * 1.33 + 1.2) * 9;
      const a3 = Math.sin(i * 0.57 + 2.5) * 6;
      const a4 = Math.sin(i * 0.72 + 3.1) * 4;
      const alpha = i % 5 === 0 ? 0.072 : i % 3 === 0 ? 0.048 : 0.026;
      const lw    = i % 7 === 0 ? 2.4   : i % 3 === 0 ? 1.4   : 0.75;
      ctx.beginPath();
      ctx.moveTo(-10, y);
      ctx.bezierCurveTo(W * 0.24, y + a1, W * 0.52, y + a2, W * 0.78, y + a3);
      ctx.bezierCurveTo(W * 0.88, y + a3 * 0.72, W * 0.95, y + a4, W + 10, y);
      ctx.strokeStyle = `rgba(52, 22, 4, ${alpha})`;
      ctx.lineWidth = lw;
      ctx.stroke();
    }

    // 细横纹（微斜角）
    for (let i = 0; i < 22; i++) {
      const t = i / 22;
      const y = H * (t * 1.08 - 0.04);
      const sk = Math.sin(i * 1.18 + 0.9) * 0.018;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + W * sk);
      ctx.strokeStyle = `rgba(170, 88, 24, ${0.018 + Math.abs(Math.sin(i * 0.88)) * 0.014})`;
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }

    // 木节暗示（椭圆形）
    for (let i = 0; i < 6; i++) {
      const kx = W * (0.1 + i * 0.15 + Math.sin(i * 1.9) * 0.06);
      const ky = MAIN_H * (0.22 + Math.sin(i * 1.65 + 0.7) * 0.2);
      const rx = base * (0.055 + Math.sin(i * 2.2) * 0.018);
      ctx.beginPath();
      ctx.ellipse(kx, ky, rx, base * 0.012, Math.sin(i) * 0.14, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(48, 20, 3, ${0.038 + Math.sin(i * 2.8) * 0.009})`;
      ctx.lineWidth = 0.85;
      ctx.stroke();
    }
    ctx.restore();

    // ── 3. 清漆光泽（顶光源 left-top）────────────────────────────
    {
      const sheen = ctx.createRadialGradient(W * 0.14, H * 0.09, 0, W * 0.2, H * 0.15, W * 0.75);
      sheen.addColorStop(0,    'rgba(255, 248, 228, 0.13)');
      sheen.addColorStop(0.25, 'rgba(255, 248, 228, 0.055)');
      sheen.addColorStop(0.58, 'rgba(255, 248, 228, 0.01)');
      sheen.addColorStop(1,    'rgba(0, 0, 0, 0.055)');
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.roundRect(0, 0, W, MAIN_H, [R, R, 0, 0]);
      ctx.fill();
    }

    // ── 4. 播放面嵌框（金属镶边）────────────────────────────────
    {
      const PAD = base * 0.028;
      const iX  = PAD;
      const iY  = PAD * 0.75;
      const iW  = W - PAD * 2;
      const iH  = MAIN_H - PAD * 1.38;
      const iR  = 11;

      // 嵌框阴影
      ctx.save();
      ctx.shadowColor    = 'rgba(0,0,0,0.38)';
      ctx.shadowBlur     = base * 0.016;
      ctx.shadowOffsetX  = 1;
      ctx.shadowOffsetY  = 2;
      ctx.strokeStyle    = 'rgba(0,0,0,0)';
      ctx.lineWidth      = 4;
      ctx.beginPath();
      ctx.roundRect(iX, iY, iW, iH, iR);
      ctx.stroke();
      ctx.restore();

      // 金属镶边主体（亮面）
      const metalHL = ctx.createLinearGradient(iX, iY, iX + iW, iY + iH);
      metalHL.addColorStop(0,    'rgba(228, 215, 182, 0.82)');
      metalHL.addColorStop(0.32, 'rgba(192, 178, 143, 0.64)');
      metalHL.addColorStop(0.64, 'rgba(152, 138, 106, 0.52)');
      metalHL.addColorStop(1,    'rgba(112, 98, 72, 0.42)');
      ctx.strokeStyle = metalHL;
      ctx.lineWidth   = 2.8;
      ctx.beginPath();
      ctx.roundRect(iX + 1.4, iY + 1.4, iW - 2.8, iH - 2.8, iR - 0.5);
      ctx.stroke();

      // 嵌框下/右暗边
      ctx.strokeStyle = 'rgba(28, 12, 3, 0.38)';
      ctx.lineWidth   = 1.1;
      ctx.beginPath();
      ctx.roundRect(iX + 2.8, iY + 2.8, iW - 2.8, iH - 2.8, iR - 1);
      ctx.stroke();

      // 顶左高光弧线
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 248, 228, 0.52)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(iX + iR, iY + 1.2);
      ctx.lineTo(iX + iW * 0.42, iY + 1.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(iX + 1.2, iY + iR);
      ctx.lineTo(iX + 1.2, iY + iH * 0.38);
      ctx.stroke();
      ctx.restore();
    }

    // ── 5. 转盘凹槽阴影（盘井）──────────────────────────────────
    {
      const { cx, cy, platterRadius: pr } = getTurntableGeometry(W, H);
      const wellR  = pr * 1.09;
      const wellSh = ctx.createRadialGradient(cx, cy, wellR * 0.82, cx, cy, wellR * 1.1);
      wellSh.addColorStop(0,    'rgba(0,0,0,0)');
      wellSh.addColorStop(0.5,  'rgba(0,0,0,0.05)');
      wellSh.addColorStop(0.82, 'rgba(0,0,0,0.16)');
      wellSh.addColorStop(1,    'rgba(0,0,0,0.28)');
      ctx.beginPath();
      ctx.arc(cx, cy, wellR, 0, Math.PI * 2);
      ctx.fillStyle = wellSh;
      ctx.fill();

      // 盘井顶左高光弧
      ctx.beginPath();
      ctx.arc(cx, cy, wellR * 0.998, -Math.PI * 0.78, -Math.PI * 0.22);
      ctx.strokeStyle = 'rgba(215, 195, 155, 0.1)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // ── 6. 前面板（控制条）──────────────────────────────────────
    {
      const pG = ctx.createLinearGradient(0, MAIN_H, 0, H);
      pG.addColorStop(0,   '#201a12');
      pG.addColorStop(0.4, '#181410');
      pG.addColorStop(1,   '#100e0b');
      ctx.fillStyle = pG;
      ctx.beginPath();
      ctx.roundRect(0, MAIN_H, W, FRONT_H, [0, 0, R, R]);
      ctx.fill();

      // 拉丝横纹
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(0, MAIN_H, W, FRONT_H, [0, 0, R, R]);
      ctx.clip();
      for (let i = 0; i < 22; i++) {
        const ly = MAIN_H + FRONT_H * (i / 22) + FRONT_H / 44;
        ctx.beginPath();
        ctx.moveTo(0, ly);
        ctx.lineTo(W, ly);
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.016)' : 'rgba(0,0,0,0.02)';
        ctx.lineWidth   = 0.7;
        ctx.stroke();
      }
      ctx.restore();

      // 面板与主面分隔线（亮）
      const sepG = ctx.createLinearGradient(0, MAIN_H, W, MAIN_H);
      sepG.addColorStop(0,    'rgba(255, 232, 172, 0)');
      sepG.addColorStop(0.1,  'rgba(255, 232, 172, 0.3)');
      sepG.addColorStop(0.5,  'rgba(255, 232, 172, 0.42)');
      sepG.addColorStop(0.9,  'rgba(255, 232, 172, 0.28)');
      sepG.addColorStop(1,    'rgba(255, 232, 172, 0)');
      ctx.strokeStyle = sepG;
      ctx.lineWidth   = 1.1;
      ctx.beginPath();
      ctx.moveTo(R * 0.35, MAIN_H);
      ctx.lineTo(W - R * 0.35, MAIN_H);
      ctx.stroke();

      // 分隔线下方投影
      const sepSh = ctx.createLinearGradient(0, MAIN_H, 0, MAIN_H + base * 0.024);
      sepSh.addColorStop(0, 'rgba(0,0,0,0.3)');
      sepSh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sepSh;
      ctx.fillRect(0, MAIN_H, W, base * 0.024);
    }

    {
      const plateW = Math.min(W * 0.245, base * 0.335);
      const plateH = FRONT_H * 0.19;
      const plateX = (W - plateW) * 0.5;
      const plateY = MAIN_H + FRONT_H * 0.84;
      const plateR = plateH * 0.52;
      const plateTop = plateY - plateH / 2;
      const textY = plateY + plateH * 0.04;
      const textSize = Math.max(11, plateH * 0.62);
      const tracking = Math.max(1.6, textSize * 0.26);

      const plateGrad = ctx.createLinearGradient(plateX, plateTop, plateX, plateTop + plateH);
      plateGrad.addColorStop(0, 'rgba(86, 61, 28, 0.92)');
      plateGrad.addColorStop(0.38, 'rgba(53, 37, 18, 0.96)');
      plateGrad.addColorStop(1, 'rgba(26, 18, 10, 0.98)');
      ctx.fillStyle = plateGrad;
      ctx.beginPath();
      ctx.roundRect(plateX, plateTop, plateW, plateH, plateR);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 230, 174, 0.22)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.roundRect(plateX + 0.6, plateTop + 0.6, plateW - 1.2, plateH - 1.2, plateR - 0.5);
      ctx.stroke();

      const topGleam = ctx.createLinearGradient(plateX, plateTop, plateX, plateTop + plateH * 0.5);
      topGleam.addColorStop(0, 'rgba(255, 244, 212, 0.22)');
      topGleam.addColorStop(1, 'rgba(255, 244, 212, 0)');
      ctx.fillStyle = topGleam;
      ctx.beginPath();
      ctx.roundRect(plateX + 1, plateTop + 1, plateW - 2, plateH * 0.48, [plateR - 1, plateR - 1, 0, 0]);
      ctx.fill();

      ctx.save();
      ctx.font = `700 ${textSize}px Georgia, "Times New Roman", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const goldText = ctx.createLinearGradient(plateX, plateTop, plateX, plateTop + plateH);
      goldText.addColorStop(0, '#f2d27a');
      goldText.addColorStop(0.22, '#e3bf67');
      goldText.addColorStop(0.52, '#be8d38');
      goldText.addColorStop(1, '#7a5a1e');
      ctx.fillStyle = goldText;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 2;
      ctx.shadowOffsetY = 1;
      drawSpacedText('LOFYL', W * 0.5, textY, tracking);
      ctx.restore();

      ctx.strokeStyle = 'rgba(255, 235, 185, 0.24)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(plateX + plateW * 0.08, plateTop + plateH * 0.26);
      ctx.lineTo(plateX + plateW * 0.92, plateTop + plateH * 0.26);
      ctx.stroke();
    }

    // ── 9. 边缘高光与暗边 ─────────────────────────────────────────
    {
      // 顶边高光
      const topHL = ctx.createLinearGradient(0, 0, 0, base * 0.038);
      topHL.addColorStop(0, 'rgba(255, 245, 222, 0.26)');
      topHL.addColorStop(1, 'rgba(255, 245, 222, 0)');
      ctx.fillStyle = topHL;
      ctx.beginPath();
      ctx.roundRect(0, 0, W, base * 0.038, [R, R, 0, 0]);
      ctx.fill();

      // 左边高光
      const leftHL = ctx.createLinearGradient(0, 0, base * 0.028, 0);
      leftHL.addColorStop(0, 'rgba(255, 245, 222, 0.14)');
      leftHL.addColorStop(1, 'rgba(255, 245, 222, 0)');
      ctx.fillStyle = leftHL;
      ctx.fillRect(0, R, base * 0.028, H - R * 2);

      // 右下暗边
      const rightSh = ctx.createLinearGradient(W - base * 0.045, 0, W, 0);
      rightSh.addColorStop(0, 'rgba(0,0,0,0)');
      rightSh.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = rightSh;
      ctx.beginPath();
      ctx.roundRect(W - base * 0.045, 0, base * 0.045, H, [0, R, R, 0]);
      ctx.fill();

      const botSh = ctx.createLinearGradient(0, H - base * 0.045, 0, H);
      botSh.addColorStop(0, 'rgba(0,0,0,0)');
      botSh.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = botSh;
      ctx.beginPath();
      ctx.roundRect(0, H - base * 0.045, W, base * 0.045, [0, 0, R, R]);
      ctx.fill();

      // 外框线
      ctx.strokeStyle = 'rgba(28, 14, 3, 0.62)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.roundRect(0.75, 0.75, W - 1.5, H - 1.5, R - 0.25);
      ctx.stroke();

      // 外框内侧一条细亮线（强调材质厚度）
      ctx.strokeStyle = 'rgba(255, 242, 210, 0.1)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.roundRect(2, 2, W - 4, H - 4, R - 1.5);
      ctx.stroke();
    }
  }

  function drawPlatterShadow(W: number, H: number) {
    const { cx, cy, platterRadius: r } = getTurntableGeometry(W, H);

    ctx.save();
    ctx.translate(cx, cy);

    const dropSh = ctx.createRadialGradient(r * 0.06, r * 0.09, r * 0.72, r * 0.06, r * 0.09, r * 1.22);
    dropSh.addColorStop(0,   'rgba(0,0,0,0)');
    dropSh.addColorStop(0.42,'rgba(0,0,0,0.12)');
    dropSh.addColorStop(0.72,'rgba(0,0,0,0.22)');
    dropSh.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.22, 0, Math.PI * 2);
    ctx.fillStyle = dropSh;
    ctx.fill();

    ctx.restore();
  }

  function drawPlatterStaticHighlights(W: number, H: number) {
    const { cx, cy, platterRadius: r } = getTurntableGeometry(W, H);

    ctx.save();
    ctx.translate(cx, cy);

    // 固定灯位下的金属掠射高光，不应跟随转盘旋转。
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.01, -Math.PI * 0.88, -Math.PI * 0.28);
    ctx.strokeStyle = 'rgba(248, 234, 190, 0.34)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r * 0.93, -Math.PI * 0.72, -Math.PI * 0.36);
    ctx.strokeStyle = 'rgba(255, 246, 212, 0.16)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const metalWash = ctx.createRadialGradient(-r * 0.18, -r * 0.22, r * 0.04, 0, 0, r * 0.92);
    metalWash.addColorStop(0, 'rgba(255, 244, 210, 0.16)');
    metalWash.addColorStop(0.22, 'rgba(255, 244, 210, 0.06)');
    metalWash.addColorStop(1, 'rgba(255, 244, 210, 0)');
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2);
    ctx.fillStyle = metalWash;
    ctx.fill();

    ctx.restore();
  }

  function drawDiscShadow(cx: number, cy: number, r: number) {
    ctx.save();
    const shadow = ctx.createRadialGradient(
      cx - r * 0.08,
      cy - r * 0.06,
      r * 0.78,
      cx,
      cy,
      r * 1.05,
    );
    shadow.addColorStop(0, 'rgba(0,0,0,0)');
    shadow.addColorStop(0.84, 'rgba(0,0,0,0.02)');
    shadow.addColorStop(0.94, 'rgba(0,0,0,0.12)');
    shadow.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.02, 0, Math.PI * 2);
    ctx.fillStyle = shadow;
    ctx.fill();
    ctx.restore();
  }

  function drawSpindle(W: number, H: number) {
    const { cx, cy, discRadius: r } = getTurntableGeometry(W, H);
    const spindleRadius = Math.max(1.7, r * 0.0072);
    const capRadius = spindleRadius * 1.65;

    ctx.save();

    ctx.beginPath();
    ctx.arc(cx, cy, capRadius * 1.9, 0, Math.PI * 2);
    const baseShadow = ctx.createRadialGradient(cx, cy, capRadius * 0.4, cx, cy, capRadius * 1.9);
    baseShadow.addColorStop(0, 'rgba(0,0,0,0.12)');
    baseShadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = baseShadow;
    ctx.fill();

    const spindleGrad = ctx.createLinearGradient(cx - spindleRadius, cy - capRadius, cx + spindleRadius, cy + capRadius);
    spindleGrad.addColorStop(0, '#f1ead8');
    spindleGrad.addColorStop(0.3, '#cfc5ab');
    spindleGrad.addColorStop(0.68, '#8d8678');
    spindleGrad.addColorStop(1, '#efe6cf');
    ctx.beginPath();
    ctx.arc(cx, cy, spindleRadius, 0, Math.PI * 2);
    ctx.fillStyle = spindleGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, capRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,245,220,0.22)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.restore();
  }

  function drawPlatter(
    W: number,
    H: number,
    options: { applyTransform?: boolean; includeShadow?: boolean } = {},
  ) {
    const { cx, cy, platterRadius: r } = getTurntableGeometry(W, H);
    const applyTransform = options.applyTransform ?? true;
    const includeShadow = options.includeShadow ?? true;

    if (includeShadow) {
      drawPlatterShadow(W, H);
      drawPlatterStaticHighlights(W, H);
    }

    ctx.save();
    if (applyTransform) {
      ctx.translate(cx, cy);
      ctx.rotate(platAngle);
    } else {
      ctx.translate(cx, cy);
    }

    // ── 金属转盘本体 ─────────────────────────────────────────────
    const metalG = ctx.createRadialGradient(-r * 0.14, -r * 0.14, r * 0.06, 0, 0, r * 1.04);
    metalG.addColorStop(0,    '#d8c18a');
    metalG.addColorStop(0.34, '#b39157');
    metalG.addColorStop(0.7,  '#7f6636');
    metalG.addColorStop(0.9,  '#5d4925');
    metalG.addColorStop(1,    '#463618');
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.04, 0, Math.PI * 2);
    ctx.fillStyle = metalG;
    ctx.fill();

    // 金属边缘精车纹（细同心圆）
    for (let i = 0; i < 4; i++) {
      const rr = r * (0.98 + i * 0.016);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
      ctx.lineWidth   = 0.9;
      ctx.stroke();
    }

    // ── 橡胶防滑垫 ──────────────────────────────────────────────
    const matR  = r * 0.974;
    const matG = ctx.createRadialGradient(-r * 0.06, -r * 0.06, r * 0.02, 0, 0, matR);
    matG.addColorStop(0,    '#7d8288');
    matG.addColorStop(0.42, '#5a6066');
    matG.addColorStop(0.76, '#454a50');
    matG.addColorStop(1,    '#2c3035');
    ctx.beginPath();
    ctx.arc(0, 0, matR, 0, Math.PI * 2);
    ctx.fillStyle = matG;
    ctx.fill();

    // 垫面同心细纹（提示橡胶材质）
    for (let i = 0; i < 7; i++) {
      const rr = matR * (0.18 + i * 0.12);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth   = 0.85;
      ctx.stroke();
    }

    // 垫面放射纹（8条，极细）
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * matR * 0.12, Math.sin(a) * matR * 0.12);
      ctx.lineTo(Math.cos(a) * matR * 0.88, Math.sin(a) * matR * 0.88);
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.lineWidth   = 0.5;
      ctx.stroke();
    }

    // 垫边高光（材质边缘）
    ctx.beginPath();
    ctx.arc(0, 0, matR * 0.999, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(220, 226, 234, 0.24)';
    ctx.lineWidth   = 1.1;
    ctx.stroke();

    ctx.restore();
  }

  function drawDisc(
    W: number,
    H: number,
    options: { applyRotation?: boolean; includeLighting?: boolean; applyEccentricity?: boolean } = {},
  ) {
    const { cx, cy, discRadius: r } = getTurntableGeometry(W, H);
    const playableInnerRadius = side ? getPlayableInnerRadius(side.totalDuration) : GROOVE_INNER_RADIUS;
    const applyRotation = options.applyRotation ?? true;
    const includeLighting = options.includeLighting ?? true;
    const applyEccentricity = options.applyEccentricity ?? true;
    const recordOffset = applyEccentricity ? getRecordCenterOffsetPx(r) : { x: 0, y: 0 };

    ctx.save();
    ctx.translate(cx + recordOffset.x, cy + recordOffset.y);
    if (applyRotation) {
      ctx.rotate(platAngle);
    }

    drawDiscBody(r);

    // 刻槽（同心圆，带微弱光泽）
    const grooveOuterPx = r * GROOVE_OUTER_RADIUS;
    const grooveInnerPx = r * playableInnerRadius;
    drawOuterLeadInGloss(r, grooveOuterPx);
    for (let i = 0; i <= 90; i++) {
      const t = i / 90;
      const gr = grooveInnerPx + t * (grooveOuterPx - grooveInnerPx);
      const alpha = 0.03 + 0.05 * Math.pow(Math.sin(t * Math.PI), 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, gr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(210, 200, 170, ${alpha})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // dead wax：可播放纹理结束后，保留更平滑的内圈
    if (playableInnerRadius > LABEL_RADIUS + 0.02) {
      const labelEdgePx = r * LABEL_RADIUS * 1.02;
      const deadWaxGrad = ctx.createRadialGradient(0, 0, labelEdgePx, 0, 0, grooveInnerPx);
      deadWaxGrad.addColorStop(0, 'rgba(40,34,24,0.18)');
      deadWaxGrad.addColorStop(0.5, 'rgba(26,22,16,0.12)');
      deadWaxGrad.addColorStop(0.84, 'rgba(12,10,8,0.05)');
      deadWaxGrad.addColorStop(1, 'rgba(255,244,216,0.028)');
      ctx.beginPath();
      ctx.arc(0, 0, grooveInnerPx, 0, Math.PI * 2);
      ctx.arc(0, 0, labelEdgePx, 0, Math.PI * 2, true);
      ctx.fillStyle = deadWaxGrad;
      ctx.fill('evenodd');

      // 可播放刻槽终点的收尾环
      ctx.beginPath();
      ctx.arc(0, 0, grooveInnerPx, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(235,224,190,0.07)';
      ctx.lineWidth = 0.95;
      ctx.stroke();

      // dead wax 区域内只保留很稀疏的收尾环，不再像满盘刻槽
      const deadWaxSpan = grooveInnerPx - labelEdgePx;
      for (let i = 1; i <= 3; i++) {
        const rr = grooveInnerPx - deadWaxSpan * (i / 4);
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        ctx.strokeStyle = i === 1
          ? 'rgba(250,238,205,0.05)'
          : 'rgba(220,208,172,0.03)';
        ctx.lineWidth = i === 1 ? 0.8 : 0.55;
        ctx.stroke();
      }

      // 标签边缘附近再压一圈收口
      ctx.beginPath();
      ctx.arc(0, 0, labelEdgePx * 1.06, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    drawRotatingDiscTexture(r, grooveInnerPx, grooveOuterPx);
    drawLabel(r);
    ctx.restore();

    if (includeLighting) {
      drawDiscLighting(cx + recordOffset.x, cy + recordOffset.y, r);
    }
  }

  function drawDiscLightingLayer(W: number, H: number, applyEccentricity: boolean = true) {
    const { cx, cy, discRadius: r } = getTurntableGeometry(W, H);
    const recordOffset = applyEccentricity ? getRecordCenterOffsetPx(r) : { x: 0, y: 0 };
    drawDiscLighting(cx + recordOffset.x, cy + recordOffset.y, r);
  }

  function drawDiscBody(discRadius: number) {
    if (artworkMode === 'overlay' && discArtworkUrl && coverImage) {
      drawColoredVinylBody(discRadius);
      return;
    }

    drawStandardDiscBody(discRadius);
  }

  function drawStandardDiscBody(discRadius: number) {
    ctx.beginPath();
    ctx.arc(0, 0, discRadius, 0, Math.PI * 2);
    const discGrad = ctx.createRadialGradient(-discRadius * 0.1, -discRadius * 0.1, 0, 0, 0, discRadius);
    discGrad.addColorStop(0, '#2a2824');
    discGrad.addColorStop(0.4, '#18160f');
    discGrad.addColorStop(1, '#0e0c08');
    ctx.fillStyle = discGrad;
    ctx.fill();

    const rimGrad = ctx.createRadialGradient(0, 0, discRadius * 0.9, 0, 0, discRadius * 1.01);
    rimGrad.addColorStop(0, 'rgba(255, 246, 220, 0)');
    rimGrad.addColorStop(0.72, 'rgba(255, 246, 220, 0)');
    rimGrad.addColorStop(0.93, 'rgba(255, 246, 220, 0.04)');
    rimGrad.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
    ctx.beginPath();
    ctx.arc(0, 0, discRadius, 0, Math.PI * 2);
    ctx.fillStyle = rimGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, discRadius * 0.998, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(230, 220, 190, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawOuterLeadInGloss(discRadius: number, grooveOuterPx: number) {
    const outerBandInner = grooveOuterPx;
    const outerBandOuter = discRadius * 0.998;

    if (outerBandOuter <= outerBandInner) return;

    const shellGrad = ctx.createRadialGradient(0, 0, outerBandInner, 0, 0, outerBandOuter);
    shellGrad.addColorStop(0, 'rgba(255,248,228,0)');
    shellGrad.addColorStop(0.38, 'rgba(255,248,228,0.025)');
    shellGrad.addColorStop(0.74, 'rgba(255,248,228,0.055)');
    shellGrad.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.beginPath();
    ctx.arc(0, 0, outerBandOuter, 0, Math.PI * 2);
    ctx.arc(0, 0, outerBandInner, 0, Math.PI * 2, true);
    ctx.fillStyle = shellGrad;
    ctx.fill('evenodd');

    ctx.beginPath();
    ctx.arc(0, 0, outerBandInner + (outerBandOuter - outerBandInner) * 0.12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,244,216,0.08)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  function drawOuterLeadInHighlight(discRadius: number, grooveOuterPx: number) {
    const outerBandInner = grooveOuterPx;
    const outerBandOuter = discRadius * 0.998;

    if (outerBandOuter <= outerBandInner) return;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const ringHighlight = ctx.createConicGradient(0, 0, 0);
    ringHighlight.addColorStop(0, 'rgba(255,248,230,0)');
    ringHighlight.addColorStop(0.08, 'rgba(255,248,230,0)');
    ringHighlight.addColorStop(0.18, 'rgba(255,248,230,0.16)');
    ringHighlight.addColorStop(0.28, 'rgba(255,248,230,0.05)');
    ringHighlight.addColorStop(0.5, 'rgba(255,248,230,0)');
    ringHighlight.addColorStop(0.68, 'rgba(255,248,230,0.09)');
    ringHighlight.addColorStop(0.78, 'rgba(255,248,230,0.02)');
    ringHighlight.addColorStop(1, 'rgba(255,248,230,0)');
    ctx.strokeStyle = ringHighlight;
    ctx.lineWidth = Math.max(1.2, discRadius * 0.018);
    ctx.beginPath();
    ctx.arc(0, 0, (outerBandInner + outerBandOuter) * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    const specular = ctx.createConicGradient(0, 0, 0);
    specular.addColorStop(0, 'rgba(255,252,240,0)');
    specular.addColorStop(0.12, 'rgba(255,252,240,0)');
    specular.addColorStop(0.2, 'rgba(255,252,240,0.22)');
    specular.addColorStop(0.25, 'rgba(255,252,240,0.08)');
    specular.addColorStop(1, 'rgba(255,252,240,0)');
    ctx.strokeStyle = specular;
    ctx.lineWidth = Math.max(0.9, discRadius * 0.01);
    ctx.beginPath();
    ctx.arc(0, 0, outerBandOuter - (outerBandOuter - outerBandInner) * 0.28, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function getCoverImagePlacement(radius: number, scale: number = 1) {
    if (!coverImage) {
      return { drawWidth: 0, drawHeight: 0, offsetX: 0, offsetY: 0 };
    }

    const targetSize = radius * 2 * scale;
    const imageSize = Math.max(coverImage.naturalWidth || coverImage.width, 1);
    const imageHeight = Math.max(coverImage.naturalHeight || coverImage.height, 1);
    const imageRatio = imageSize / imageHeight;
    let drawWidth = targetSize;
    let drawHeight = targetSize;
    let offsetX = -targetSize / 2;
    let offsetY = -targetSize / 2;

    if (imageRatio > 1) {
      drawWidth = targetSize * imageRatio;
      offsetX = -drawWidth / 2;
    } else if (imageRatio < 1) {
      drawHeight = targetSize / imageRatio;
      offsetY = -drawHeight / 2;
    }

    return { drawWidth, drawHeight, offsetX, offsetY };
  }

  function drawCoverImage(radius: number, scale: number = 1) {
    if (!coverImage) return;
    const { drawWidth, drawHeight, offsetX, offsetY } = getCoverImagePlacement(radius, scale);
    ctx.drawImage(coverImage, offsetX, offsetY, drawWidth, drawHeight);
  }

  function drawClippedCoverImage(radius: number) {
    if (!coverImage) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.clip();
    drawCoverImage(radius);
    ctx.restore();
  }

  function drawColoredVinylBody(discRadius: number) {
    drawStandardDiscBody(discRadius);
    if (!coverImage) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, discRadius, 0, Math.PI * 2);
    ctx.clip();

    // 让封面图像成为“胶料颜色来源”，而不是一张直接贴上的图。
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.filter = `blur(${Math.max(10, discRadius * 0.05)}px) saturate(1.2) contrast(1.06) brightness(0.86)`;
    drawCoverImage(discRadius, 1.14);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.34;
    ctx.filter = 'saturate(1.35) contrast(1.08)';
    drawCoverImage(discRadius, 1.02);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.18;
    ctx.filter = `blur(${Math.max(2, discRadius * 0.014)}px) brightness(0.82)`;
    drawCoverImage(discRadius, 1.06);
    ctx.restore();

    const smoke = ctx.createRadialGradient(0, -discRadius * 0.16, discRadius * 0.08, 0, 0, discRadius);
    smoke.addColorStop(0, 'rgba(255,255,255,0.04)');
    smoke.addColorStop(0.34, 'rgba(255,248,232,0.025)');
    smoke.addColorStop(0.62, 'rgba(20,18,16,0.06)');
    smoke.addColorStop(1, 'rgba(8,6,5,0.22)');
    ctx.beginPath();
    ctx.arc(0, 0, discRadius, 0, Math.PI * 2);
    ctx.fillStyle = smoke;
    ctx.fill();

    const resinDepth = ctx.createRadialGradient(0, 0, discRadius * 0.34, 0, 0, discRadius * 0.98);
    resinDepth.addColorStop(0, 'rgba(255,255,255,0)');
    resinDepth.addColorStop(0.58, 'rgba(255,255,255,0)');
    resinDepth.addColorStop(0.82, 'rgba(255,248,230,0.03)');
    resinDepth.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.beginPath();
    ctx.arc(0, 0, discRadius, 0, Math.PI * 2);
    ctx.fillStyle = resinDepth;
    ctx.fill();

    // 彩胶中心通常不会把图案一直印到标签位置，给中区一个更像树脂的过渡。
    const innerResin = ctx.createRadialGradient(0, 0, discRadius * LABEL_RADIUS * 0.4, 0, 0, discRadius * LABEL_RADIUS * 1.18);
    innerResin.addColorStop(0, 'rgba(18,14,12,0.34)');
    innerResin.addColorStop(0.72, 'rgba(12,10,8,0.16)');
    innerResin.addColorStop(1, 'rgba(12,10,8,0)');
    ctx.beginPath();
    ctx.arc(0, 0, discRadius * LABEL_RADIUS * 1.18, 0, Math.PI * 2);
    ctx.fillStyle = innerResin;
    ctx.fill();

    ctx.restore();
  }

  function drawRotatingDiscTexture(discRadius: number, grooveInnerPx: number, grooveOuterPx: number) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, grooveOuterPx, 0, Math.PI * 2);
    ctx.arc(0, 0, grooveInnerPx, 0, Math.PI * 2, true);
    ctx.clip('evenodd');

    // 极弱的不对称压纹，给旋转中的盘面一点细微层次。
    const swirl = ctx.createRadialGradient(
      -discRadius * 0.18,
      discRadius * 0.22,
      0,
      -discRadius * 0.18,
      discRadius * 0.22,
      discRadius * 0.7
    );
    swirl.addColorStop(0, 'rgba(255,245,220,0.018)');
    swirl.addColorStop(0.22, 'rgba(255,245,220,0.008)');
    swirl.addColorStop(0.5, 'rgba(255,245,220,0)');
    ctx.fillStyle = swirl;
    ctx.beginPath();
    ctx.arc(0, 0, grooveOuterPx * 0.98, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawDiscLighting(cx: number, cy: number, r: number) {
    const TAU = Math.PI * 2;
    const toConicStop = (angle: number) => {
      const normalized = ((angle % TAU) + TAU) % TAU;
      return normalized / TAU;
    };

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.995, 0, Math.PI * 2);
    ctx.moveTo(cx + r * LABEL_RADIUS * 1.18, cy);
    ctx.arc(cx, cy, r * LABEL_RADIUS * 1.18, 0, Math.PI * 2, true);
    ctx.clip('evenodd');

    // 外缘暗角，强化厚度和压盘感
    const rimShade = ctx.createRadialGradient(cx, cy, r * 0.66, cx, cy, r * 1.03);
    rimShade.addColorStop(0, 'rgba(0,0,0,0)');
    rimShade.addColorStop(0.72, 'rgba(0,0,0,0.02)');
    rimShade.addColorStop(0.9, 'rgba(0,0,0,0.13)');
    rimShade.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = rimShade;
    ctx.fill();

    // 沿刻槽生长的掠射高光：让反光顺着盘面纹理走，而不是像贴了一层玻璃。
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'screen';

    const grooveInner = r * LABEL_RADIUS * 1.22;
    const grooveOuter = r * 0.985;
    drawOuterLeadInHighlight(r, r * GROOVE_OUTER_RADIUS);
    const highlightBands = [
      { start: -2.22, end: -1.48, peak: -1.86, alpha: 0.1, width: 1.1, feather: 0.16 },
      { start: -1.28, end: -0.86, peak: -1.04, alpha: 0.055, width: 0.72, feather: 0.12 },
      { start: 1.94, end: 2.18, peak: 2.07, alpha: 0.022, width: 0.58, feather: 0.1 },
    ];

    for (const band of highlightBands) {
      ctx.save();
      ctx.shadowColor = `rgba(255, 246, 220, ${band.alpha * 0.16})`;
      ctx.shadowBlur = r * 0.018;
      const gradient = ctx.createConicGradient(0, 0, 0);
      const fadeInStart = toConicStop(band.start - band.feather);
      const solidStart = toConicStop(band.start + band.feather * 0.18);
      const peakStop = toConicStop(band.peak);
      const solidEnd = toConicStop(band.end - band.feather * 0.18);
      const fadeOutEnd = toConicStop(band.end + band.feather);
      gradient.addColorStop(0, 'rgba(255, 247, 224, 0)');
      gradient.addColorStop(fadeInStart, 'rgba(255, 247, 224, 0)');
      gradient.addColorStop(solidStart, `rgba(255, 247, 224, ${band.alpha * 0.42})`);
      gradient.addColorStop(peakStop, `rgba(255, 247, 224, ${band.alpha})`);
      gradient.addColorStop(solidEnd, `rgba(255, 247, 224, ${band.alpha * 0.36})`);
      gradient.addColorStop(fadeOutEnd, 'rgba(255, 247, 224, 0)');
      gradient.addColorStop(1, 'rgba(255, 247, 224, 0)');
      ctx.strokeStyle = gradient;

      const ringCount = Math.max(44, Math.round((grooveOuter - grooveInner) / 3.1));
      for (let i = 0; i < ringCount; i++) {
        const t = i / (ringCount - 1);
        const rr = grooveInner + (grooveOuter - grooveInner) * t;
        const centerWeight = 1 - Math.abs(t - 0.52) / 0.52;
        const radiusAlpha = Math.pow(Math.max(0, centerWeight), 1.05);
        const shimmer = 0.82 + 0.18 * Math.sin(t * 26 + band.peak * 3.4);
        const alpha = band.alpha * radiusAlpha * shimmer;

        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, TAU);
        ctx.globalAlpha = alpha / band.alpha;
        ctx.lineWidth = band.width;
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'soft-light';
    const blendWash = ctx.createRadialGradient(-r * 0.24, -r * 0.42, 0, -r * 0.24, -r * 0.42, r * 0.72);
    blendWash.addColorStop(0, 'rgba(255, 248, 228, 0.03)');
    blendWash.addColorStop(0.4, 'rgba(255, 248, 228, 0.012)');
    blendWash.addColorStop(1, 'rgba(255, 248, 228, 0)');
    ctx.fillStyle = blendWash;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.985, 0, Math.PI * 2);
    ctx.arc(0, 0, grooveInner, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.restore();
  }

  function drawLabel(discRadius: number) {
    const labelR = discRadius * LABEL_RADIUS;
    const hasCenteredCover = artworkMode === 'centered' && discArtworkUrl && coverImage;
    const hasOverlayCover = artworkMode === 'overlay' && discArtworkUrl && coverImage;

    if (hasCenteredCover) {
      drawClippedCoverImage(labelR);
      ctx.beginPath();
      ctx.arc(0, 0, labelR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fill();
    } else if (hasOverlayCover) {
      const labelShade = ctx.createRadialGradient(0, 0, discRadius * 0.02, 0, 0, labelR * 1.08);
      labelShade.addColorStop(0, 'rgba(0,0,0,0.18)');
      labelShade.addColorStop(0.82, 'rgba(0,0,0,0.34)');
      labelShade.addColorStop(1, 'rgba(255,240,210,0.08)');
      ctx.beginPath();
      ctx.arc(0, 0, labelR, 0, Math.PI * 2);
      ctx.fillStyle = labelShade;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, labelR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,240,210,0.16)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    } else {
      // 暖色调标签（奶油+红）
      const labelGrad = ctx.createRadialGradient(0, -labelR * 0.2, 0, 0, 0, labelR);
      labelGrad.addColorStop(0, '#c44030');
      labelGrad.addColorStop(1, '#7a2010');
      ctx.beginPath();
      ctx.arc(0, 0, labelR, 0, Math.PI * 2);
      ctx.fillStyle = labelGrad;
      ctx.fill();

      // 标签边缘高光
      ctx.beginPath();
      ctx.arc(0, 0, labelR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,220,180,0.2)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 标签文字作为图面的一部分，跟随碟片一起旋转
    if (side) {
      ctx.save();
      ctx.font = `bold ${labelR * 0.09}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = `${labelR * 0.018}px`;
      ctx.fillStyle = hasCenteredCover || hasOverlayCover
        ? 'rgba(255,240,210,0.72)'
        : 'rgba(255,240,210,0.82)';
      ctx.fillText(`SIDE ${side.label}`, 0, labelR * 0.4, labelR * 1.5);
      ctx.restore();
    }

    // 중心孔
    ctx.beginPath();
    ctx.arc(0, 0, discRadius * 0.02, 0, Math.PI * 2);
    ctx.fillStyle = '#08060a';
    ctx.fill();
  }

  function drawTrackMarkers(W: number, H: number, applyEccentricity: boolean = true) {
    if (!side || side.tracks.length < 2) return;
    const { cx, cy, discRadius: r } = getTurntableGeometry(W, H);
    const recordOffset = applyEccentricity ? getRecordCenterOffsetPx(r) : { x: 0, y: 0 };
    const grooveOuterPx = r * GROOVE_OUTER_RADIUS;
    const grooveInnerPx = r * getPlayableInnerRadius(side.totalDuration);
    const markerBandWidth = Math.max(0.95, r * 0.0048);
    const shadowBandWidth = markerBandWidth * 1.45;
    const sheenBandWidth = Math.max(0.45, markerBandWidth * 0.24);

    ctx.save();
    ctx.translate(cx + recordOffset.x, cy + recordOffset.y);
    ctx.beginPath();
    ctx.arc(0, 0, grooveOuterPx, 0, Math.PI * 2);
    ctx.arc(0, 0, grooveInnerPx, 0, Math.PI * 2, true);
    ctx.clip('evenodd');

    let accumulated = 0;
    for (let i = 1; i < side.tracks.length; i++) {
      accumulated += side.tracks[i - 1].duration;
      const markerRadius = trackOffsetToRadius(accumulated, side.totalDuration) * r;

      ctx.beginPath();
      ctx.arc(0, 0, markerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(8, 7, 5, 0.10)';
      ctx.lineWidth = shadowBandWidth;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, markerRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(214, 200, 166, 0.035)';
      ctx.lineWidth = markerBandWidth;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, markerRadius - markerBandWidth * 0.32, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.lineWidth = sheenBandWidth;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, markerRadius + markerBandWidth * 0.24, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(244, 232, 202, 0.03)';
      ctx.lineWidth = sheenBandWidth;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawTonearm(W: number, H: number) {
    const {
      pivotWX,
      pivotWY,
      angle,
      ux,
      uy,
      nx,
      ny,
      rearStemLen,
      rearWeightOffset,
      shellBaseX,
      shellBaseY,
    } = getTonearmRenderState(W, H);
    const shellLocalX = (shellBaseX - pivotWX) * ux + (shellBaseY - pivotWY) * uy;
    const shellLocalY = (shellBaseX - pivotWX) * nx + (shellBaseY - pivotWY) * ny;
    const armStartLocalX = 11;
    const armLen = Math.max(0, shellLocalX - armStartLocalX);
    const control1LocalX = armStartLocalX + armLen * 0.26;
    const control2LocalX = armStartLocalX + armLen * 0.72;
    const control1LocalY = shellLocalY + armLen * 0.09;
    const control2LocalY = shellLocalY - armLen * 0.11;

    // 基座阴影
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(pivotWX + 2, pivotWY + 7, 24, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 配重杆
    ctx.save();
    ctx.strokeStyle = '#7f765d';
    ctx.lineWidth = 6.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotWX - ux * 5, pivotWY - uy * 5);
    ctx.lineTo(pivotWX - ux * rearStemLen, pivotWY - uy * rearStemLen);
    ctx.stroke();

    const counterweightX = pivotWX - ux * rearWeightOffset;
    const counterweightY = pivotWY - uy * rearWeightOffset;
    const counterGrad = ctx.createLinearGradient(
      counterweightX - nx * 8 - ux * 6,
      counterweightY - ny * 8 - uy * 6,
      counterweightX + nx * 8 + ux * 6,
      counterweightY + ny * 8 + uy * 6
    );
    counterGrad.addColorStop(0, '#433f36');
    counterGrad.addColorStop(0.5, '#958a6d');
    counterGrad.addColorStop(1, '#2c2822');
    ctx.fillStyle = counterGrad;
    ctx.beginPath();
    ctx.ellipse(counterweightX, counterweightY, 9.8, 11.6, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,228,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 枢轴底座与云台
    ctx.save();
    ctx.beginPath();
    ctx.arc(pivotWX, pivotWY, 14, 0, Math.PI * 2);
    const baseGrad = ctx.createRadialGradient(pivotWX - 4, pivotWY - 5, 1, pivotWX, pivotWY, 14);
    baseGrad.addColorStop(0, '#d8cfb3');
    baseGrad.addColorStop(0.45, '#a79a7a');
    baseGrad.addColorStop(1, '#655844');
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.24)';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(pivotWX, pivotWY, 8.2, 0, Math.PI * 2);
    const hubGrad = ctx.createRadialGradient(pivotWX - 2, pivotWY - 3, 1, pivotWX, pivotWY, 8.2);
    hubGrad.addColorStop(0, '#f0e5c7');
    hubGrad.addColorStop(0.48, '#b1a381');
    hubGrad.addColorStop(1, '#4d4437');
    ctx.fillStyle = hubGrad;
    ctx.fill();
    ctx.restore();

    // 主臂：在唱臂局部坐标内定义弯管形状，避免跟随 wobble 时出现抖动。
    ctx.save();
    ctx.translate(pivotWX, pivotWY);
    ctx.rotate(angle);
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    const armGrad = ctx.createLinearGradient(
      armStartLocalX,
      -6,
      shellLocalX,
      6
    );
    armGrad.addColorStop(0, '#6d6554');
    armGrad.addColorStop(0.16, '#d8cda8');
    armGrad.addColorStop(0.42, '#9f9478');
    armGrad.addColorStop(0.7, '#f1e6c0');
    armGrad.addColorStop(1, '#756b58');
    ctx.strokeStyle = armGrad;
    ctx.lineWidth = 8.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(armStartLocalX, 0);
    ctx.bezierCurveTo(
      control1LocalX,
      control1LocalY,
      control2LocalX,
      control2LocalY,
      shellLocalX,
      shellLocalY,
    );
    ctx.stroke();
    ctx.restore();

    // 主臂高光与下缘阴影
    ctx.save();
    ctx.translate(pivotWX, pivotWY);
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(255,249,229,0.44)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armStartLocalX, 1.2);
    ctx.bezierCurveTo(
      control1LocalX,
      control1LocalY + 1.4,
      control2LocalX,
      control2LocalY + 0.9,
      shellLocalX,
      shellLocalY + 0.7,
    );
    ctx.stroke();
    ctx.strokeStyle = 'rgba(76,64,42,0.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(armStartLocalX, -2);
    ctx.bezierCurveTo(
      control1LocalX,
      control1LocalY - 2.2,
      control2LocalX,
      control2LocalY - 1.5,
      shellLocalX,
      shellLocalY - 1.3,
    );
    ctx.stroke();
    ctx.restore();

    // 弯臂下方的次级阴影，补一点厚度
    ctx.save();
    ctx.translate(pivotWX, pivotWY);
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 5.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armStartLocalX, -0.8);
    ctx.bezierCurveTo(
      control1LocalX,
      control1LocalY - 1.1,
      control2LocalX,
      control2LocalY - 0.9,
      shellLocalX,
      shellLocalY - 0.7,
    );
    ctx.stroke();
    ctx.restore();

    // 头壳
    ctx.save();
    ctx.translate(shellBaseX, shellBaseY);
    ctx.rotate(angle);
    const shellGrad = ctx.createLinearGradient(-14, 0, 5, 0);
    shellGrad.addColorStop(0, '#6e6653');
    shellGrad.addColorStop(0.55, '#d7ca9f');
    shellGrad.addColorStop(1, '#6f6754');
    ctx.fillStyle = shellGrad;
    ctx.beginPath();
    ctx.moveTo(-14.5, -4.1);
    ctx.lineTo(-11.8, 4.5);
    ctx.lineTo(2.2, 3.3);
    ctx.lineTo(4.2, -2.9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,228,0.2)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 唱头
    ctx.fillStyle = '#4b463d';
    ctx.fillRect(-3.1, -3.6, 8.6, 7.2);
    ctx.fillStyle = '#6a6356';
    ctx.fillRect(0.8, -2.7, 4.3, 5.3);

    // 唱针杆与针尖
    ctx.strokeStyle = '#3b332b';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(4.2, 0.8);
    ctx.lineTo(6.6, 7.2);
    ctx.stroke();
    ctx.fillStyle = isPlaying ? '#d84a3a' : '#7b5648';
    ctx.beginPath();
    ctx.arc(6.8, 7.3, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 枢轴中心盖
    ctx.beginPath();
    ctx.arc(pivotWX, pivotWY, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#2d261f';
    ctx.fill();
  }

  function getTonearmRenderState(W: number, H: number, armAngle: number = animatedArmAngle) {
    const { pivotX, pivotY, armLengthPx } = getTonearmGeometry(W, H);
    const angle = armAngle + tonearmAngleJolt;
    const pivotWX = pivotX;
    const pivotWY = pivotY;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const nx = -uy;
    const ny = ux;
    const stylusX = pivotWX + ux * armLengthPx;
    const stylusY = pivotWY + uy * armLengthPx + tonearmLiftPx;
    const stylusLocalX = 6.8;
    const stylusLocalY = 7.3;
    const shellBaseX = stylusX - (ux * stylusLocalX - uy * stylusLocalY);
    const shellBaseY = stylusY - (uy * stylusLocalX + ux * stylusLocalY) + tonearmLiftPx * 0.15;

    return {
      pivotWX,
      pivotWY,
      angle,
      needleX: stylusX,
      needleY: stylusY,
      ux,
      uy,
      nx,
      ny,
      rearStemLen: 18,
      rearWeightOffset: 30,
      shellBaseX,
      shellBaseY,
      armStartX: pivotWX + ux * 11,
      armStartY: pivotWY + uy * 11,
      startHalfWidth: 4.8,
      endHalfWidth: 2.2,
      tipX: stylusX,
      tipY: stylusY,
    };
  }

  function getCanvasPoint(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (drawW / rect.width),
      y: (e.clientY - rect.top) * (drawH / rect.height),
    };
  }

  function getDragTimeFromPoint(x: number, y: number): number | null {
    if (!side) return null;

    const { cx, cy, discRadius: r } = getTurntableGeometry(drawW, drawH);
    const recordOffset = getRecordCenterOffsetPx(r);
    const playableInnerRadius = getPlayableInnerRadius(side.totalDuration);
    const normalizedRadius = Math.hypot(
      x - (cx + recordOffset.x),
      y - (cy + recordOffset.y),
    ) / r;
    const playableSpan = GROOVE_OUTER_RADIUS - playableInnerRadius;

    if (playableSpan <= 0) return 0;
    if (normalizedRadius < playableInnerRadius || normalizedRadius > GROOVE_OUTER_RADIUS) return null;

    return ((GROOVE_OUTER_RADIUS - normalizedRadius) / playableSpan) * side.totalDuration;
  }

  function getArmAngleFromPoint(x: number, y: number): number {
    const { pivotX, pivotY } = getTonearmGeometry(drawW, drawH);
    return Math.atan2(y - pivotY, x - pivotX);
  }

  function updateNeedleHover(e: PointerEvent) {
    if (!drawW || !drawH) return;
    const point = getCanvasPoint(e);
    const { tipX, tipY } = getTonearmRenderState(drawW, drawH);
    isNeedleHovering = Math.hypot(point.x - tipX, point.y - tipY) <= NEEDLE_DRAG_HIT_RADIUS;
  }

  function updateDraggedNeedle(e: PointerEvent) {
    const point = getCanvasPoint(e);
    if (isManualCarryDrag) {
      dragArmAngle = getArmAngleFromPoint(point.x, point.y);
      animatedArmAngle = dragArmAngle;
      const time = getDragTimeFromPoint(point.x, point.y);
      dragPreviewTime = time;
      if (time !== null) {
        onSeek(time);
      }
      requestDraw();
      return;
    }

    const time = getDragTimeFromPoint(point.x, point.y);
    if (time === null || !side) return;

    dragPreviewTime = time;
    animatedArmAngle = computeArmAngle(sideTimeToRadius(time, side.totalDuration));
    onSeek(time);
    requestDraw();
  }

  function handlePointerDown(e: PointerEvent) {
    if (!side || !canvas || drawW === 0) return;

    updateNeedleHover(e);
    if (!isNeedleHovering) return;

    activePointerId = e.pointerId;
    isDraggingNeedle = true;
    isManualCarryDrag = !isPlaying;
    dragPreviewTime = isManualCarryDrag ? null : effectiveTime;
    dragArmAngle = isManualCarryDrag ? animatedArmAngle : null;
    canvas.setPointerCapture(e.pointerId);
    onNeedleDragStart();
    updateDraggedNeedle(e);
    requestDraw();
    e.preventDefault();
  }

  function handlePointerMove(e: PointerEvent) {
    if (!canvas || drawW === 0) return;

    if (isDraggingNeedle && activePointerId === e.pointerId) {
      updateDraggedNeedle(e);
      e.preventDefault();
      return;
    }

    updateNeedleHover(e);
  }

  function stopNeedleDrag(e: PointerEvent) {
    if (!canvas) return;
    if (activePointerId !== e.pointerId) return;

    const finalTime = isManualCarryDrag ? dragPreviewTime : (dragPreviewTime ?? effectiveTime);
    const shouldCommitDrop = e.type !== 'pointercancel';

    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    isDraggingNeedle = false;
    activePointerId = null;
    dragPreviewTime = null;
    dragArmAngle = null;
    isManualCarryDrag = false;
    isNeedleHovering = false;
    if (shouldCommitDrop) {
      onNeedleDrop(finalTime);
    }
    requestDraw();
  }

  function loadCoverImage(src: string | undefined) {
    if (!src) {
      coverImage = null;
      coverImageVersion += 1;
      discBaseLayerDirty = true;
      return;
    }

    const image = new Image();
    image.onload = () => {
      coverImage = image;
      coverImageVersion += 1;
      discBaseLayerDirty = true;
      scheduleCanvasSync();
    };
    image.src = src;
  }

  onMount(() => {
    ctx = canvas.getContext('2d', { alpha: false })!;

    syncCanvasSize();
    scheduleCanvasSync();
    requestAnimationFrame(() => scheduleCanvasSync());
    resizeObserver = new ResizeObserver(() => scheduleCanvasSync());
    resizeObserver.observe(wrapElement);
    window.addEventListener('resize', scheduleCanvasSync);

    requestDraw();
  });

  let discLayerCacheKey = '';
  $: {
    const nextDiscLayerKey = [
      side?.label ?? 'none',
      side?.totalDuration ?? 0,
      side?.tracks.map((track) => `${track.id}:${track.duration}`).join('|') ?? '',
      artworkMode,
      discArtworkUrl ?? '',
      coverImageVersion,
    ].join('::');

    if (nextDiscLayerKey !== discLayerCacheKey) {
      discLayerCacheKey = nextDiscLayerKey;
      discBaseLayerDirty = true;
      discLightingLayerDirty = true;
      requestDraw();
    }
  }

  $: if (canvas) {
    scheduleCanvasSync();
  }

  $: if (canvas) {
    loadCoverImage(discArtworkUrl);
  }

  onDestroy(() => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
    if (scheduledSyncId !== null) {
      cancelAnimationFrame(scheduledSyncId);
    }
    resizeObserver?.disconnect();
    window.removeEventListener('resize', scheduleCanvasSync);
  });

</script>

<div bind:this={wrapElement} class="turntable-wrap">
  <div
    class="machine-unit"
    style={canvasDisplaySize ? `width:${canvasDisplaySize}px;height:${canvasDisplaySize}px` : undefined}
  >
    <canvas
      bind:this={canvas}
      class="turntable-canvas"
      class:dragging={isDraggingNeedle}
      class:needle-hover={isNeedleHovering}
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={stopNeedleDrag}
      on:pointercancel={stopNeedleDrag}
      on:pointerleave={() => { if (!isDraggingNeedle) isNeedleHovering = false; }}
      title="拖动唱针头控制播放位置"
    ></canvas>

    <!-- ── 切换动画覆盖层 ─────────────────────────────────────── -->
    {#if swapAnim !== 'idle'}
      <div
        class="swap-overlay"
        class:swap-overlay--swap={swapAnim === 'swap'}
        class:swap-overlay--flip={swapAnim === 'flip'}
        aria-hidden="true"
      >
        <!-- 封套（换碟时从顶部伸入） -->
        {#if swapAnim === 'swap'}
          <div class="swap-sleeve swap-sleeve--outgoing">
            {#if swapFromCoverUrl}
              <img src={swapFromCoverUrl} alt="" class="swap-sleeve-img" draggable="false" />
            {/if}
            <span class="swap-sleeve-paper" aria-hidden="true"></span>
            <span class="swap-sleeve-opening" aria-hidden="true"></span>
            <span class="swap-sleeve-gloss" aria-hidden="true"></span>
          </div>

          <div class="swap-sleeve swap-sleeve--incoming">
            {#if swapToCoverUrl}
              <img src={swapToCoverUrl} alt="" class="swap-sleeve-img" draggable="false" />
            {/if}
            <span class="swap-sleeve-paper" aria-hidden="true"></span>
            <span class="swap-sleeve-opening" aria-hidden="true"></span>
            <span class="swap-sleeve-gloss" aria-hidden="true"></span>
          </div>
        {/if}

        <!-- 唱片圆盘（覆盖在 canvas 上，用于动画） -->
        <div
          class="swap-vinyl"
          class:swap-vinyl--outgoing={swapAnim === 'swap'}
        >
          <span
            class="swap-vinyl-face swap-vinyl-face--front"
            class:swap-vinyl-face--overlay-art={artworkMode === 'overlay' && !!swapFromDiscArtworkUrl}
            aria-hidden="true"
          >
            {#if artworkMode === 'overlay' && swapFromDiscArtworkUrl}
              <img src={swapFromDiscArtworkUrl} alt="" class="swap-vinyl-body-art swap-vinyl-body-art--base" draggable="false" />
              <img src={swapFromDiscArtworkUrl} alt="" class="swap-vinyl-body-art swap-vinyl-body-art--soft" draggable="false" />
              <span class="swap-vinyl-body-resin" aria-hidden="true"></span>
            {/if}
            <span class="swap-vinyl-grooves" aria-hidden="true"></span>
            <span class="swap-vinyl-label" aria-hidden="true">
              {#if artworkMode === 'centered' && swapFromDiscArtworkUrl}
                <img src={swapFromDiscArtworkUrl} alt="" class="swap-vinyl-label-art" draggable="false" />
              {/if}
              <span class="swap-vinyl-label-shade" aria-hidden="true"></span>
              {#if swapFromSideLabel}
                <span class="swap-vinyl-side-text" aria-hidden="true">SIDE {swapFromSideLabel}</span>
              {/if}
            </span>
            <span class="swap-vinyl-spindle" aria-hidden="true"></span>
            <span class="swap-vinyl-sheen" aria-hidden="true"></span>
          </span>
          {#if swapAnim === 'flip'}
            <span
              class="swap-vinyl-face swap-vinyl-face--back"
              class:swap-vinyl-face--overlay-art={artworkMode === 'overlay' && !!swapToDiscArtworkUrl}
              aria-hidden="true"
            >
              {#if artworkMode === 'overlay' && swapToDiscArtworkUrl}
                <img src={swapToDiscArtworkUrl} alt="" class="swap-vinyl-body-art swap-vinyl-body-art--base" draggable="false" />
                <img src={swapToDiscArtworkUrl} alt="" class="swap-vinyl-body-art swap-vinyl-body-art--soft" draggable="false" />
                <span class="swap-vinyl-body-resin" aria-hidden="true"></span>
              {/if}
              <span class="swap-vinyl-grooves" aria-hidden="true"></span>
              <span class="swap-vinyl-label" aria-hidden="true">
                {#if artworkMode === 'centered' && swapToDiscArtworkUrl}
                  <img src={swapToDiscArtworkUrl} alt="" class="swap-vinyl-label-art" draggable="false" />
                {/if}
                <span class="swap-vinyl-label-shade" aria-hidden="true"></span>
                {#if swapToSideLabel}
                  <span class="swap-vinyl-side-text" aria-hidden="true">SIDE {swapToSideLabel}</span>
                {/if}
              </span>
              <span class="swap-vinyl-spindle" aria-hidden="true"></span>
              <span class="swap-vinyl-sheen" aria-hidden="true"></span>
            </span>
          {/if}
        </div>

        {#if swapAnim === 'swap'}
          <div class="swap-vinyl swap-vinyl--incoming">
            <span
              class="swap-vinyl-face swap-vinyl-face--front"
              class:swap-vinyl-face--overlay-art={artworkMode === 'overlay' && !!swapToDiscArtworkUrl}
              aria-hidden="true"
            >
              {#if artworkMode === 'overlay' && swapToDiscArtworkUrl}
                <img src={swapToDiscArtworkUrl} alt="" class="swap-vinyl-body-art swap-vinyl-body-art--base" draggable="false" />
                <img src={swapToDiscArtworkUrl} alt="" class="swap-vinyl-body-art swap-vinyl-body-art--soft" draggable="false" />
                <span class="swap-vinyl-body-resin" aria-hidden="true"></span>
              {/if}
              <span class="swap-vinyl-grooves" aria-hidden="true"></span>
              <span class="swap-vinyl-label" aria-hidden="true">
                {#if artworkMode === 'centered' && swapToDiscArtworkUrl}
                  <img src={swapToDiscArtworkUrl} alt="" class="swap-vinyl-label-art" draggable="false" />
                {/if}
                <span class="swap-vinyl-label-shade" aria-hidden="true"></span>
                {#if swapToSideLabel}
                  <span class="swap-vinyl-side-text" aria-hidden="true">SIDE {swapToSideLabel}</span>
                {/if}
              </span>
              <span class="swap-vinyl-spindle" aria-hidden="true"></span>
              <span class="swap-vinyl-sheen" aria-hidden="true"></span>
            </span>
          </div>
        {/if}
      </div>
    {/if}

    <div class="machine-front-controls">
      <button
        class="console-btn"
        class:engaged={transportEngaged}
        on:click={onTogglePlay}
        aria-label={transportEngaged ? '停止播放' : '开始播放'}
        type="button"
      >
        <span class="console-led" aria-hidden="true"></span>
        <span class="console-btn-text">PLAY</span>
      </button>

      <button
        class="console-btn console-btn-compact"
        class:engaged={isSpectrumEnabled}
        on:click={onToggleSpectrum}
        aria-label={isSpectrumEnabled ? '关闭频谱计' : '开启频谱计'}
        type="button"
      >
        <span class="console-led" aria-hidden="true"></span>
        <span class="console-btn-text">SPEC</span>
      </button>

      <div
        class="front-spectrum"
        class:disabled={!isSpectrumEnabled}
        aria-hidden="true"
      >
        {#each displayedSpectrumLevels as level}
          {@const litRows = getSpectrumLitRows(level)}
          <div class="spectrum-column">
            {#each SPECTRUM_ROWS as row}
              <span class="spectrum-cell" class:lit={row < litRows}></span>
            {/each}
          </div>
        {/each}
      </div>

      <div class="art-switch-btns machine-art-toggle" role="group" aria-label="封面显示模式">
        <button
          class="art-btn"
          class:active={artworkMode === 'overlay'}
          on:click={() => onArtworkModeChange('overlay')}
          type="button"
        >DISC</button>
        <button
          class="art-btn"
          class:active={artworkMode === 'centered'}
          on:click={() => onArtworkModeChange('centered')}
          type="button"
        >LABEL</button>
      </div>
    </div>
  </div>
</div>

<style>
  .turntable-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .machine-unit {
    position: relative;
    flex: 0 0 auto;
  }

  .turntable-canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: default;
    border-radius: 0.02em;
  }

  .turntable-canvas.needle-hover {
    cursor: grab;
  }

  .turntable-canvas.dragging {
    cursor: grabbing;
  }

  .machine-front-controls {
    position: absolute;
    left: 50%;
    bottom: 3.9%;
    transform: translateX(-50%);
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-family: 'Courier New', monospace;
    width: min(86%, 520px);
  }

  .art-switch-btns {
    display: flex;
    gap: 2px;
    padding: 3px;
    background: linear-gradient(180deg, #181310 0%, #0e0b08 100%);
    border: 1px solid #090706;
    border-top-color: rgba(255, 235, 185, 0.08);
    border-radius: 6px;
    box-shadow:
      inset 0 2px 6px rgba(0, 0, 0, 0.65),
      0 1px 0 rgba(255, 230, 155, 0.04);
  }

  .machine-art-toggle {
    flex: 0 0 auto;
  }

  .front-spectrum {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: 0;
    height: 42px;
    padding: 5px 12px;
    background: linear-gradient(180deg, rgba(121, 100, 63, 0.94) 0%, rgba(33, 25, 15, 0.98) 100%);
    border: 1px solid #0b0906;
    border-top-color: rgba(255, 235, 185, 0.12);
    border-radius: 8px;
    box-shadow:
      inset 0 2px 6px rgba(0, 0, 0, 0.65),
      inset 0 -1px 0 rgba(255, 230, 155, 0.04),
      0 1px 0 rgba(255, 230, 155, 0.06);
  }

  .front-spectrum.disabled {
    filter: saturate(0.4) brightness(0.78);
  }

  .spectrum-column {
    display: flex;
    flex-direction: column-reverse;
    justify-content: center;
    gap: 2px;
    height: 100%;
  }

  .spectrum-cell {
    width: 7px;
    height: 3px;
    border-radius: 999px;
    background: rgba(48, 68, 40, 0.24);
    border: 1px solid rgba(160, 188, 120, 0.05);
    transition: background 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
  }

  .spectrum-cell.lit:nth-child(-n + 3) {
    background: #9cff73;
    border-color: rgba(210, 255, 194, 0.3);
    box-shadow: 0 0 4px rgba(156, 255, 115, 0.3);
  }

  .spectrum-cell.lit:nth-child(4),
  .spectrum-cell.lit:nth-child(5) {
    background: #ffb347;
    border-color: rgba(255, 222, 170, 0.3);
    box-shadow: 0 0 4px rgba(255, 179, 71, 0.3);
  }

  .spectrum-cell.lit:nth-child(6) {
    background: #ff6f3c;
    border-color: rgba(255, 201, 182, 0.34);
    box-shadow: 0 0 5px rgba(255, 111, 60, 0.35);
  }

  .art-btn {
    padding: 5px 9px;
    font-family: 'Courier New', monospace;
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: rgba(175, 138, 68, 0.38);
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    text-shadow:
      0 0 4px rgba(255, 196, 104, 0.08),
      0 0 10px rgba(255, 196, 104, 0.04);
    transition: background 0.14s ease, color 0.14s ease, box-shadow 0.14s ease, text-shadow 0.14s ease;
    text-transform: uppercase;
  }

  .art-btn:hover:not(.active) {
    color: rgba(200, 162, 82, 0.65);
    text-shadow:
      0 0 6px rgba(255, 196, 104, 0.18),
      0 0 14px rgba(255, 196, 104, 0.08);
  }

  .art-btn.active {
    background: linear-gradient(180deg, #252015 0%, #161108 100%);
    color: rgba(218, 178, 96, 0.88);
    box-shadow:
      inset 0 1px 4px rgba(0, 0, 0, 0.55),
      inset 0 -1px 0 rgba(255, 230, 140, 0.04);
    text-shadow:
      0 0 6px rgba(255, 204, 118, 0.42),
      0 0 14px rgba(255, 204, 118, 0.16);
  }

  /* ── Play / Stop button ── */
  .console-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 8px 11px;
    background: linear-gradient(180deg, #282018 0%, #161209 100%);
    border: 1px solid #0c0a06;
    border-top-color: rgba(255, 235, 185, 0.12);
    border-radius: 7px;
    cursor: pointer;
    flex: 0 0 auto;
    font-family: 'Courier New', monospace;
    transition: filter 0.1s ease;
    box-shadow:
      inset 0 1px 4px rgba(0, 0, 0, 0.55),
      inset 0 -1px 0 rgba(255, 230, 155, 0.04),
      0 1px 0 rgba(255, 230, 155, 0.06);
  }

  .console-btn:hover {
    filter: brightness(1.18);
  }

  .console-btn:active {
    filter: brightness(0.9);
    box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.75);
  }

  .console-btn.engaged {
    box-shadow:
      inset 0 3px 8px rgba(0, 0, 0, 0.7),
      inset 0 1px 0 rgba(255, 230, 155, 0.02);
  }

  .console-btn-compact {
    min-width: 48px;
  }

  .console-led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 32%, #3a4530, #181f12);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.55);
    transition: background 0.15s ease, box-shadow 0.18s ease;
  }

  .console-btn.engaged .console-led {
    background: radial-gradient(circle at 36% 30%, #ff5038, #c02416);
    box-shadow:
      0 0 8px rgba(205, 45, 22, 0.75),
      0 0 18px rgba(205, 45, 22, 0.28),
      inset 0 -1px 2px rgba(0, 0, 0, 0.32);
  }

  .console-btn-text {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.24em;
    color: rgba(218, 190, 135, 0.52);
    text-shadow:
      0 0 5px rgba(255, 205, 125, 0.16),
      0 0 12px rgba(255, 205, 125, 0.06);
    text-transform: uppercase;
    transition: color 0.15s ease, text-shadow 0.15s ease;
  }

  .console-btn.engaged .console-btn-text {
    color: rgba(218, 190, 135, 0.88);
    text-shadow:
      0 0 7px rgba(255, 208, 130, 0.42),
      0 0 16px rgba(255, 208, 130, 0.16);
  }

  /* ════════════════════════════════════════════════════════════════
     切换动画覆盖层
     ────────────────────────────────────────────────────────────────
     定位基准（归一化来自 Turntable.svelte canvas 常量）：
       盘片圆心    CENTER_X=50%  CENTER_Y=46.2%
       盘片半径    DISC_RADIUS=38.2%
       标签半径    LABEL_RADIUS=0.35 → 占盘片直径 35%
  ════════════════════════════════════════════════════════════════ */

  .swap-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 20;
    overflow: hidden;
  }

  /* ── 封套 ──────────────────────────────────────────────────── */
  /*
   * 与唱片圆盘完全同尺寸、同位置（left=11.8% top=8% width=76.4%）。
   * 动画通过 translateY 控制入场 / 离场；
   * swap-overlay overflow:hidden 负责裁切顶部，使封套仅露出下半段。
   *
   * 静止帧（translateY(-62%)）时：
   *   封套底边 = 8% + 76.4% − 62%×76.4% = 37%
   *   约 48% 的封套（下半部分）在帧内可见。
   */
  .swap-sleeve {
    position: absolute;
    left: 11.8%;
    top: 8%;
    width: 76.4%;
    aspect-ratio: 1;
    z-index: 2;
    border-radius: 5px;
    overflow: hidden;
    background: linear-gradient(155deg, #ece1c5 0%, #ddd1b0 100%);
    box-shadow:
      inset 0 0 0 6px rgba(234, 222, 196, 0.48),
      0 0 0 1.5px rgba(72, 46, 14, 0.20),
      0 22px 64px rgba(4, 2, 0, 0.62);
    transform: translateY(-110%);
    opacity: 0;
  }

  .swap-sleeve--outgoing {
    z-index: 6;
  }

  .swap-sleeve--incoming {
    z-index: 5;
  }

  .swap-sleeve-img {
    position: absolute;
    inset: 6px;
    width: calc(100% - 12px);
    height: calc(100% - 12px);
    object-fit: cover;
    border-radius: 3px;
    display: block;
    user-select: none;
    transform: rotate(180deg);
    transform-origin: center;
  }

  /* 纸板横纹 */
  .swap-sleeve-paper {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: repeating-linear-gradient(
      180deg,
      rgba(100, 72, 34, 0.028) 0px,
      rgba(100, 72, 34, 0.028) 1px,
      transparent 1px,
      transparent 5px
    );
  }

  /* 底部开口阴影（唱片从下方插入的入口边缘） */
  .swap-sleeve-opening {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 12%;
    z-index: 3;
    pointer-events: none;
    background: linear-gradient(0deg, rgba(12, 6, 1, 0.32) 0%, transparent 100%);
  }

  /* 塑封高光 */
  .swap-sleeve-gloss {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    background:
      linear-gradient(
        140deg,
        rgba(255, 255, 255, 0.18) 0%,
        rgba(255, 255, 255, 0.04) 26%,
        transparent 46%
      ),
      linear-gradient(
        320deg,
        rgba(0, 0, 0, 0.06) 0%,
        transparent 38%
      );
  }

  /* ── 黑胶唱片 ──────────────────────────────────────────────── */
  /*
   * 与 canvas 中的盘片对齐：
   *   left = 50% − 38.2% = 11.8%
   *   top  = 46.2% − 38.2% = 8%
   *   width/height = 76.4%
   */
  .swap-vinyl {
    position: absolute;
    left: 11.8%;
    top: 8%;
    width: 76.4%;
    aspect-ratio: 1;
    z-index: 1;
    pointer-events: none;
    transform-style: preserve-3d;
    transform-origin: 50% 50%;
  }

  .swap-vinyl--outgoing {
    z-index: 4;
  }

  .swap-vinyl--incoming {
    z-index: 3;
    opacity: 0;
  }

  .swap-vinyl-face {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
    background:
      radial-gradient(circle at 36% 34%, #2e2c26, #18160f 36%, #0d0b08 100%);
    box-shadow: 0 14px 48px rgba(0, 0, 0, 0.72);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
  }

  .swap-vinyl-face--overlay-art {
    background:
      radial-gradient(circle at 36% 34%, #24211d, #14110d 38%, #0a0806 100%);
  }

  .swap-overlay--swap .swap-vinyl-face {
    box-shadow: none;
  }

  .swap-vinyl-face--back {
    transform: rotateX(180deg);
  }

  /* 黑胶纹路（模拟刻槽高频反光） */
  .swap-vinyl-grooves {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background:
      repeating-radial-gradient(
        circle at center,
        rgba(255, 244, 216, 0) 0%,
        rgba(255, 244, 216, 0) 0.72%,
        rgba(255, 244, 216, 0.044) 0.74%,
        rgba(255, 244, 216, 0.044) 0.86%
      );
    -webkit-mask-image: radial-gradient(
      circle at center,
      transparent 0%,
      transparent 41.5%,
      #000 43%,
      #000 96.8%,
      transparent 98.6%
    );
    mask-image: radial-gradient(
      circle at center,
      transparent 0%,
      transparent 41.5%,
      #000 43%,
      #000 96.8%,
      transparent 98.6%
    );
    opacity: 0.9;
    z-index: 2;
    pointer-events: none;
  }

  .swap-vinyl-grooves::before,
  .swap-vinyl-grooves::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    pointer-events: none;
  }

  .swap-vinyl-grooves::before {
    background:
      radial-gradient(
        circle at center,
        transparent 0%,
        transparent 34.5%,
        rgba(255, 242, 205, 0.055) 35.1%,
        transparent 35.8%
      ),
      radial-gradient(
        circle at center,
        transparent 0%,
        transparent 41.6%,
        rgba(255, 240, 205, 0.07) 42.2%,
        transparent 42.8%
      ),
      radial-gradient(
        circle at center,
        transparent 0%,
        transparent 47.2%,
        rgba(255, 236, 196, 0.03) 47.7%,
        transparent 48.1%
      );
    opacity: 0.9;
    mix-blend-mode: screen;
  }

  .swap-vinyl-grooves::after {
    background:
      radial-gradient(
        circle at center,
        transparent 0%,
        transparent 83.6%,
        rgba(255, 246, 222, 0.06) 85.1%,
        rgba(255, 246, 222, 0.018) 88%,
        transparent 92%
      ),
      radial-gradient(
        circle at 34% 28%,
        rgba(255, 248, 228, 0.07) 0%,
        rgba(255, 248, 228, 0.018) 18%,
        transparent 42%
      );
    opacity: 0.92;
    mix-blend-mode: screen;
  }

  .swap-vinyl-body-art {
    position: absolute;
    inset: -7%;
    width: 114%;
    height: 114%;
    object-fit: cover;
    border-radius: 50%;
    pointer-events: none;
  }

  .swap-vinyl-body-art--base {
    z-index: 0;
    opacity: 0.82;
    filter: blur(18px) saturate(1.18) contrast(1.05) brightness(0.82);
    mix-blend-mode: screen;
  }

  .swap-vinyl-body-art--soft {
    z-index: 1;
    opacity: 0.28;
    filter: blur(4px) saturate(1.3) contrast(1.08) brightness(0.88);
    mix-blend-mode: soft-light;
  }

  .swap-vinyl-body-resin {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: 50%;
    background:
      radial-gradient(circle at 50% 50%, rgba(10, 8, 7, 0.28) 0%, rgba(10, 8, 7, 0.16) 26%, rgba(10, 8, 7, 0) 41%),
      radial-gradient(circle at 50% 50%, rgba(255, 246, 225, 0) 58%, rgba(255, 246, 225, 0.035) 84%, rgba(0, 0, 0, 0.18) 100%),
      radial-gradient(circle at 32% 28%, rgba(255, 250, 238, 0.06), rgba(255, 250, 238, 0) 40%);
    pointer-events: none;
  }

  /* 标签区（LABEL_RADIUS = 0.35 → 直径占唱片 35%） */
  .swap-vinyl-label {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 35%;
    aspect-ratio: 1;
    border-radius: 50%;
    overflow: hidden;
    background: radial-gradient(circle at 50% 36%, #c44030, #7a2010 100%);
    box-shadow: inset 0 0 0 1px rgba(255, 220, 180, 0.14);
    z-index: 3;
  }

  .swap-vinyl-face--overlay-art .swap-vinyl-label {
    background: radial-gradient(circle at 50% 36%, rgba(22, 18, 16, 0.72), rgba(10, 8, 7, 0.92) 100%);
    box-shadow:
      inset 0 0 0 1px rgba(255, 240, 210, 0.12),
      0 0 0 1px rgba(0, 0, 0, 0.22);
  }

  .swap-vinyl-label-art {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 1;
    display: block;
  }

  .swap-vinyl-label-shade {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0.38));
  }

  .swap-vinyl-side-text {
    position: absolute;
    left: 50%;
    top: 68%;
    transform: translateX(-50%);
    font-family: "Courier New", monospace;
    font-size: clamp(10px, 0.92vw, 15px);
    font-weight: 700;
    letter-spacing: 0.22em;
    color: rgba(255, 240, 210, 0.8);
    text-shadow: 0 0 8px rgba(0, 0, 0, 0.42);
    white-space: nowrap;
  }

  /* 中心孔 */
  .swap-vinyl-spindle {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 2%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: #080608;
    z-index: 5;
  }

  /* 碟面掠射高光 */
  .swap-vinyl-sheen {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background:
      conic-gradient(
        from -55deg at 50% 50%,
        transparent 0deg,
        rgba(255, 248, 228, 0.07) 18deg,
        transparent 40deg,
        transparent 180deg,
        rgba(255, 248, 228, 0.04) 198deg,
        transparent 218deg
      );
    pointer-events: none;
    z-index: 4;
  }

  /* ── 换碟动画（swap）──────────────────────────────────────── */
  /*
   * 封套（与唱片同尺寸）：从顶部滑入，translateY(-62%) 时
   *   约 48% 的封套（下半部分）可见；驻留等待唱片插入后一起退出。
   * 唱片：原位等待封套到位 → 浮起至相同 translateY(-62%) 位置
   *   → 淡出（进入封套），封套随即退出。
   * 总时长 2 200 ms
   */
  @keyframes sleeve-outgoing {
    0%   { transform: translateY(-110%); opacity: 0; }
    12%  { transform: translateY(-62%); opacity: 1; }
    40%  { transform: translateY(-62%); opacity: 1; }
    54%  { transform: translateY(-110%); opacity: 0; }
    100% { transform: translateY(-110%); opacity: 0; }
  }

  @keyframes vinyl-outgoing {
    0%   { transform: translateY(0) scale(1); opacity: 1; }
    12%  { transform: translateY(0) scale(1); opacity: 1; }
    26%  { transform: translateY(-30%) scale(1.02); opacity: 1; }
    40%  { transform: translateY(-62%) scale(1); opacity: 1; }
    52%  { transform: translateY(-110%) scale(0.98); opacity: 0; }
    100% { transform: translateY(-110%) scale(0.98); opacity: 0; }
  }

  @keyframes sleeve-incoming {
    0%   { transform: translateY(-110%); opacity: 0; }
    46%  { transform: translateY(-110%); opacity: 0; }
    60%  { transform: translateY(-62%); opacity: 1; }
    88%  { transform: translateY(-62%); opacity: 1; }
    100% { transform: translateY(-110%); opacity: 0; }
  }

  @keyframes vinyl-incoming {
    0%   { transform: translateY(-110%) scale(0.98); opacity: 0; }
    48%  { transform: translateY(-110%) scale(0.98); opacity: 0; }
    62%  { transform: translateY(-62%) scale(1); opacity: 1; }
    76%  { transform: translateY(-30%) scale(1.02); opacity: 1; }
    90%  { transform: translateY(0) scale(1); opacity: 1; }
    100% { transform: translateY(0) scale(1); opacity: 1; }
  }

  .swap-overlay--swap .swap-sleeve--outgoing {
    animation: sleeve-outgoing 3s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards;
  }

  .swap-overlay--swap .swap-vinyl--outgoing {
    animation: vinyl-outgoing 3s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards;
  }

  .swap-overlay--swap .swap-sleeve--incoming {
    animation: sleeve-incoming 3s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards;
  }

  .swap-overlay--swap .swap-vinyl--incoming {
    animation: vinyl-incoming 3s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards;
  }

  /* ── 翻面动画（flip）──────────────────────────────────────── */
  /*
   * 唱片浮起 → 中段边缘朝向（scaleX→0）→ 展示另一面 → 落回
   * 最后淡出，露出 canvas 中已更新的盘面。
   * 总时长 1 600 ms
   */
  @keyframes vinyl-flip-side {
    0%   { transform: translateY(0)    perspective(720px) rotateX(0deg)   scale(1);    }
    18%  { transform: translateY(-8%)  perspective(720px) rotateX(0deg)   scale(1.03); }
    50%  { transform: translateY(-12%) perspective(720px) rotateX(92deg)  scale(1.02); }
    82%  { transform: translateY(-7%)  perspective(720px) rotateX(180deg) scale(1.03); }
    100% { transform: translateY(0)    perspective(720px) rotateX(180deg) scale(1);    }
  }

  .swap-overlay--flip .swap-vinyl {
    animation: vinyl-flip-side 1.6s cubic-bezier(0.42, 0, 0.58, 1) forwards;
  }

</style>
