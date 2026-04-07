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
  export let coverUrl: string | undefined = undefined;
  export let artworkMode: DiscArtworkMode = 'centered';
  export let onSeek: (timeInSide: number) => void = () => {};
  export let onTogglePlay: () => void = () => {};
  export let onNeedleDragStart: () => void = () => {};
  export let onNeedleDrop: (timeInSide: number | null) => void = () => {};
  export let onArtworkModeChange: (mode: DiscArtworkMode) => void = () => {};

  let wrapElement: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let animationId: number;
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

  // CSS 逻辑像素尺寸（用于所有绘图计算）
  let drawW = 0;
  let drawH = 0;

  let platAngle = 0;
  let platterSpeed = 0;
  let lastTimestamp = 0;
  let wobbleTime = 0;
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
  const PLATTER_SPINDOWN_MS = 1500;
  const TONEARM_CUE_MS = 1500;
  const TONEARM_DROP_MS = 700;
  const CENTER_X_NORM = 0.46;
  const CENTER_Y_NORM = 0.5;
  const PLATTER_RADIUS_NORM = 0.4;
  const DISC_RADIUS_NORM = 0.382;
  const PIVOT_X_CANVAS_NORM = 0.93;
  const PIVOT_Y_CANVAS_NORM = 0.115;
  const NEEDLE_DRAG_HIT_RADIUS = 18;

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
  $: targetArmAngle = (tonearmState === 'playing' || tonearmState === 'holding' || tonearmState === 'cueing' || tonearmState === 'dropping' || dragPreviewTime !== null || dragArmAngle !== null)
    ? (dragArmAngle ?? computeArmAngle(needleRadius))
    : ARM_PARKED_ANGLE;

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

  function startPlatterSpeedAnimation(nextSpeed: number) {
    const now = performance.now();
    platterSpeedFrom = platterSpeed;
    platterSpeedTo = nextSpeed;
    platterSpeedAnimStart = now;
    platterSpeedAnimDuration = nextSpeed > platterSpeed ? PLATTER_SPINUP_MS : PLATTER_SPINDOWN_MS;
  }

  function startCueAnimation(nextAngle: number) {
    cueStartAngle = animatedArmAngle;
    cueTargetAngle = nextAngle;
    cueAnimStart = performance.now();
    cueAnimDuration = TONEARM_CUE_MS;
  }

  function startDropAnimation() {
    dropAnimStart = performance.now();
    dropAnimDuration = TONEARM_DROP_MS;
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
      animatedArmAngle = targetArmAngle;
      tonearmLiftPx = 7;
      tonearmAngleJolt = 0;
    } else if (tonearmState === 'dropping') {
      startDropAnimation();
    } else if (tonearmState === 'parked') {
      dropAnimDuration = 0;
      cueAnimDuration = 0;
      tonearmAngleJolt = 0;
      if (previousTonearmState === 'playing' && dragPreviewTime === null) {
        // 播放中停止 → 慢速抬臂归位（约 5 秒）
        returnArmFromAngle = animatedArmAngle;
        returnAnimStart = performance.now();
        returnAnimDuration = 5000;
      } else {
        returnAnimDuration = 0;
        tonearmLiftPx = 0;
      }
    }
    previousTonearmState = tonearmState;
  }

  function solveStylusPosition(radius: number, pivotX: number, pivotY: number) {
    const clampedRadius = Math.max(GROOVE_INNER_RADIUS, Math.min(GROOVE_OUTER_RADIUS, radius));
    const pivotToCenter = Math.hypot(pivotX, pivotY);

    // 圆与圆求交：唱针既在唱片半径 clampedRadius 上，也在以枢轴为圆心、
    // 唱臂长度为半径的轨迹上。选 y 更大的交点，让唱针落在唱片右下侧。
    const a =
      (clampedRadius * clampedRadius - ARM_LENGTH_NORM * ARM_LENGTH_NORM + pivotToCenter * pivotToCenter)
      / (2 * pivotToCenter);
    const h = Math.sqrt(Math.max(0, clampedRadius * clampedRadius - a * a));
    const baseX = (a * pivotX) / pivotToCenter;
    const baseY = (a * pivotY) / pivotToCenter;
    const offsetX = (-pivotY / pivotToCenter) * h;
    const offsetY = (pivotX / pivotToCenter) * h;

    const candidateA = { x: baseX + offsetX, y: baseY + offsetY };
    const candidateB = { x: baseX - offsetX, y: baseY - offsetY };
    const stylus = candidateA.y > candidateB.y ? candidateA : candidateB;

    return {
      x: stylus.x,
      y: stylus.y,
      armAngle: Math.atan2(stylus.y - pivotY, stylus.x - pivotX),
      discAngle: Math.atan2(stylus.y, stylus.x),
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
    return solveStylusPosition(radius, pivotNormX, pivotNormY).armAngle;
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

    const dpr = window.devicePixelRatio || 1;
    const nextDrawW = canvasDisplaySize || canvas.clientWidth;
    const nextDrawH = canvasDisplaySize || canvas.clientHeight || nextDrawW;

    if (!nextDrawW || !nextDrawH) return;
    if (drawW === nextDrawW && drawH === nextDrawH && canvas.width === nextDrawW * dpr && canvas.height === nextDrawH * dpr) {
      return;
    }

    drawW = nextDrawW;
    drawH = nextDrawH;
    canvas.width = Math.round(drawW * dpr);
    canvas.height = Math.round(drawH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function scheduleCanvasSync() {
    if (scheduledSyncId !== null) {
      cancelAnimationFrame(scheduledSyncId);
    }

    scheduledSyncId = requestAnimationFrame(() => {
      scheduledSyncId = null;
      syncCanvasSize();
    });
  }

  function getMechanicalWobble(radius: number) {
    const t = wobbleTime;
    const strength = 0.35 + platterSpeed * 0.65;

    return {
      platterOffsetX:
        (Math.sin(t * 0.73) * radius * 0.0014 +
        Math.sin(t * 1.41 + 0.8) * radius * 0.0005) * strength,
      platterOffsetY:
        (Math.cos(t * 0.67 + 0.5) * radius * 0.0012 +
        Math.sin(t * 1.18 + 1.9) * radius * 0.00045) * strength,
      platterRotation:
        Math.sin(t * 0.52 + 0.3) * 0.003 * strength,
      platterScaleX:
        1 + Math.sin(t * 0.58 + 0.6) * 0.0011 * strength,
      platterScaleY:
        1 + Math.cos(t * 0.54 + 1.7) * 0.0009 * strength,
      armAngle:
        (Math.sin(t * 0.84 + 0.2) * 0.0038 +
        Math.sin(t * 1.63 + 1.1) * 0.0014) * strength,
      armPivotX:
        Math.sin(t * 0.62 + 0.9) * radius * 0.001 * strength,
      armPivotY:
        Math.cos(t * 0.7 + 1.4) * radius * 0.0009 * strength,
    };
  }

  function draw(timestamp: number) {
    if (!ctx || drawW === 0) return;

    const dt = lastTimestamp ? (timestamp - lastTimestamp) / 1000 : 0;
    lastTimestamp = timestamp;
    wobbleTime = timestamp / 1000;

    // ── 转盘转速动画（spinup/spindown）──────────────────────────
    if (platterSpeedAnimDuration > 0) {
      const pp = Math.min(1, (timestamp - platterSpeedAnimStart) / platterSpeedAnimDuration);
      // 加速：easeInOut；减速：easeOutQuart（快速衰减后拖尾）
      const isSpinup = platterSpeedTo > platterSpeedFrom;
      const eased = isSpinup ? easeInOutCubic(pp) : easeOutQuart(pp);
      platterSpeed = platterSpeedFrom + (platterSpeedTo - platterSpeedFrom) * eased;
      if (pp >= 1) {
        platterSpeed = platterSpeedTo;
        platterSpeedAnimDuration = 0;
      }
    }
    platAngle += RAD_PER_SEC * platterSpeed * dt;

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

    const W = drawW;
    const H = drawH;

    ctx.clearRect(0, 0, W, H);
    drawMachineSurface(W, H);
    drawPlatter(W, H);
    drawDisc(W, H);
    if (side) drawTrackMarkers(W, H);
    drawTonearm(W, H);

    animationId = requestAnimationFrame(draw);
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

    // ── 7. 电源 LED ──────────────────────────────────────────────
    {
      const ledX = W * 0.074;
      const ledY = MAIN_H + FRONT_H * 0.5;
      const ledR = base * 0.012;

      // 光晕
      const glow = ctx.createRadialGradient(ledX, ledY, 0, ledX, ledY, ledR * 3.2);
      glow.addColorStop(0,   'rgba(255, 165, 25, 0.18)');
      glow.addColorStop(0.45,'rgba(220, 130, 15, 0.07)');
      glow.addColorStop(1,   'rgba(180, 100, 8, 0)');
      ctx.beginPath();
      ctx.arc(ledX, ledY, ledR * 3.2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // LED 本体
      const ledG = ctx.createRadialGradient(ledX - ledR * 0.22, ledY - ledR * 0.28, 0, ledX, ledY, ledR);
      ledG.addColorStop(0,   '#ffb828');
      ledG.addColorStop(0.5, '#d48018');
      ledG.addColorStop(1,   '#7a4205');
      ctx.beginPath();
      ctx.arc(ledX, ledY, ledR, 0, Math.PI * 2);
      ctx.fillStyle = ledG;
      ctx.fill();
      ctx.strokeStyle = 'rgba(60, 30, 4, 0.55)';
      ctx.lineWidth   = 0.9;
      ctx.stroke();

      // POWER 小字
      ctx.save();
      ctx.font         = `${base * 0.016}px 'Courier New', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = 'rgba(188, 150, 70, 0.46)';
      ctx.fillText('POWER', ledX, ledY + ledR * 2.3);
      ctx.restore();
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

  function drawPlatter(W: number, H: number) {
    const { cx, cy, platterRadius: r } = getTurntableGeometry(W, H);
    const wobble = getMechanicalWobble(r);

    ctx.save();
    ctx.translate(cx + wobble.platterOffsetX, cy + wobble.platterOffsetY);
    ctx.rotate(wobble.platterRotation);
    ctx.scale(wobble.platterScaleX, wobble.platterScaleY);

    // ── 转盘投影 ─────────────────────────────────────────────────
    const dropSh = ctx.createRadialGradient(r * 0.06, r * 0.09, r * 0.72, r * 0.06, r * 0.09, r * 1.22);
    dropSh.addColorStop(0,   'rgba(0,0,0,0)');
    dropSh.addColorStop(0.42,'rgba(0,0,0,0.12)');
    dropSh.addColorStop(0.72,'rgba(0,0,0,0.22)');
    dropSh.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.22, 0, Math.PI * 2);
    ctx.fillStyle = dropSh;
    ctx.fill();

    // ── 金属转盘本体 ─────────────────────────────────────────────
    const metalG = ctx.createRadialGradient(-r * 0.14, -r * 0.14, r * 0.06, 0, 0, r * 1.04);
    metalG.addColorStop(0,    '#ddd5c5');
    metalG.addColorStop(0.38, '#bdb5a5');
    metalG.addColorStop(0.72, '#9e9688');
    metalG.addColorStop(0.9,  '#888075');
    metalG.addColorStop(1,    '#6e6860');
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

    // 顶左高光弧（金属光泽）
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.01, -Math.PI * 0.88, -Math.PI * 0.28);
    ctx.strokeStyle = 'rgba(240, 230, 210, 0.28)';
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // ── 橡胶防滑垫 ──────────────────────────────────────────────
    const matR  = r * 0.974;
    const matG = ctx.createRadialGradient(-r * 0.06, -r * 0.06, r * 0.02, 0, 0, matR);
    matG.addColorStop(0,    '#302e24');
    matG.addColorStop(0.5,  '#201e16');
    matG.addColorStop(1,    '#14120e');
    ctx.beginPath();
    ctx.arc(0, 0, matR, 0, Math.PI * 2);
    ctx.fillStyle = matG;
    ctx.fill();

    // 垫面同心细纹（提示橡胶材质）
    for (let i = 0; i < 7; i++) {
      const rr = matR * (0.18 + i * 0.12);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.016)';
      ctx.lineWidth   = 0.85;
      ctx.stroke();
    }

    // 垫面放射纹（8条，极细）
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * matR * 0.12, Math.sin(a) * matR * 0.12);
      ctx.lineTo(Math.cos(a) * matR * 0.88, Math.sin(a) * matR * 0.88);
      ctx.strokeStyle = 'rgba(255,255,255,0.012)';
      ctx.lineWidth   = 0.5;
      ctx.stroke();
    }

    // 垫边高光（材质边缘）
    ctx.beginPath();
    ctx.arc(0, 0, matR * 0.999, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(85, 75, 55, 0.5)';
    ctx.lineWidth   = 1.1;
    ctx.stroke();

    ctx.restore();
  }

  function drawDisc(W: number, H: number) {
    const { cx, cy, discRadius: r } = getTurntableGeometry(W, H);
    const playableInnerRadius = side ? getPlayableInnerRadius(side.totalDuration) : GROOVE_INNER_RADIUS;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(platAngle);

    drawDiscBody(r);

    // 刻槽（同心圆，带微弱光泽）
    const grooveOuterPx = r * GROOVE_OUTER_RADIUS;
    const grooveInnerPx = r * playableInnerRadius;
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

    drawDiscLighting(cx, cy, r);
  }

  function drawDiscBody(discRadius: number) {
    if (artworkMode === 'overlay' && coverUrl && coverImage) {
      drawClippedCoverImage(discRadius);

      const coverShade = ctx.createRadialGradient(0, 0, discRadius * 0.12, 0, 0, discRadius);
      coverShade.addColorStop(0, 'rgba(0,0,0,0.06)');
      coverShade.addColorStop(0.55, 'rgba(0,0,0,0.12)');
      coverShade.addColorStop(1, 'rgba(0,0,0,0.34)');
      ctx.beginPath();
      ctx.arc(0, 0, discRadius, 0, Math.PI * 2);
      ctx.fillStyle = coverShade;
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.arc(0, 0, discRadius, 0, Math.PI * 2);
    const discGrad = ctx.createRadialGradient(-discRadius * 0.1, -discRadius * 0.1, 0, 0, 0, discRadius);
    discGrad.addColorStop(0, '#2a2824');
    discGrad.addColorStop(0.4, '#18160f');
    discGrad.addColorStop(1, '#0e0c08');
    ctx.fillStyle = discGrad;
    ctx.fill();
  }

  function drawClippedCoverImage(radius: number) {
    if (!coverImage) return;

    const imageSize = Math.max(coverImage.naturalWidth || coverImage.width, 1);
    const imageHeight = Math.max(coverImage.naturalHeight || coverImage.height, 1);
    const imageRatio = imageSize / imageHeight;
    const targetSize = radius * 2;
    let drawWidth = targetSize;
    let drawHeight = targetSize;
    let offsetX = -radius;
    let offsetY = -radius;

    if (imageRatio > 1) {
      drawWidth = targetSize * imageRatio;
      offsetX = -drawWidth / 2;
    } else if (imageRatio < 1) {
      drawHeight = targetSize / imageRatio;
      offsetY = -drawHeight / 2;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(coverImage, offsetX, offsetY, drawWidth, drawHeight);
    ctx.restore();
  }

  function drawRotatingDiscTexture(discRadius: number, grooveInnerPx: number, grooveOuterPx: number) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, grooveOuterPx, 0, Math.PI * 2);
    ctx.arc(0, 0, grooveInnerPx, 0, Math.PI * 2, true);
    ctx.clip('evenodd');

    // 极弱的不对称压纹和擦痕，提供“它在转”的视觉锚点。
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

    ctx.strokeStyle = 'rgba(240,232,208,0.03)';
    ctx.lineCap = 'round';
    ctx.lineWidth = discRadius * 0.006;
    ctx.beginPath();
    ctx.arc(discRadius * 0.02, -discRadius * 0.02, discRadius * 0.74, -Math.PI * 0.08, Math.PI * 0.16);
    ctx.stroke();

    ctx.lineWidth = discRadius * 0.004;
    ctx.beginPath();
    ctx.arc(-discRadius * 0.04, discRadius * 0.03, discRadius * 0.58, Math.PI * 0.48, Math.PI * 0.82);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(20,16,12,0.08)';
    ctx.lineWidth = discRadius * 0.01;
    ctx.beginPath();
    ctx.arc(discRadius * 0.08, discRadius * 0.06, discRadius * 0.63, -Math.PI * 0.72, -Math.PI * 0.48);
    ctx.stroke();

    ctx.restore();
  }

  function drawDiscLighting(cx: number, cy: number, r: number) {
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

    // 黑胶最外圈的光滑高光带，强调盘片本体材质而不是唱盘底座
    const glossyOuterRing = ctx.createRadialGradient(cx, cy, r * 0.78, cx, cy, r * 1.01);
    glossyOuterRing.addColorStop(0, 'rgba(255,248,228,0)');
    glossyOuterRing.addColorStop(0.72, 'rgba(255,248,228,0.016)');
    glossyOuterRing.addColorStop(0.88, 'rgba(255,248,228,0.052)');
    glossyOuterRing.addColorStop(0.95, 'rgba(255,248,228,0.02)');
    glossyOuterRing.addColorStop(1, 'rgba(255,248,228,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.992, 0, Math.PI * 2);
    ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2, true);
    ctx.fillStyle = glossyOuterRing;
    ctx.fill('evenodd');

    // 外圈上的柔和掠射反光，强化“抛光边缘”的感觉
    ctx.save();
    ctx.shadowColor = 'rgba(255,248,228,0.08)';
    ctx.shadowBlur = r * 0.05;
    ctx.strokeStyle = 'rgba(255,248,228,0.07)';
    ctx.lineWidth = r * 0.016;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.93, -Math.PI * 0.9, -Math.PI * 0.64);
    ctx.stroke();
    ctx.restore();

    // 非常淡且模糊的亮面，不使用条状高光
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.72);
    ctx.shadowColor = 'rgba(255,248,228,0.04)';
    ctx.shadowBlur = r * 0.12;
    const areaSheen = ctx.createRadialGradient(
      -r * 0.28,
      -r * 0.56,
      0,
      -r * 0.28,
      -r * 0.56,
      r * 0.5
    );
    areaSheen.addColorStop(0, 'rgba(255,248,228,0.016)');
    areaSheen.addColorStop(0.28, 'rgba(255,248,228,0.008)');
    areaSheen.addColorStop(0.58, 'rgba(255,248,228,0.002)');
    areaSheen.addColorStop(1, 'rgba(255,248,228,0)');
    ctx.fillStyle = areaSheen;
    ctx.beginPath();
    ctx.ellipse(-r * 0.16, -r * 0.52, r * 0.34, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 下侧轻微冷反射，避免盘面死黑
    const lowerBounce = ctx.createLinearGradient(cx, cy + r * 0.22, cx, cy + r);
    lowerBounce.addColorStop(0, 'rgba(90,100,120,0)');
    lowerBounce.addColorStop(0.7, 'rgba(90,100,120,0.012)');
    lowerBounce.addColorStop(1, 'rgba(90,100,120,0.02)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.98, Math.PI * 0.18, Math.PI * 0.82);
    ctx.strokeStyle = lowerBounce;
    ctx.lineWidth = r * 0.05;
    ctx.stroke();

    ctx.restore();
  }

  function drawLabel(discRadius: number) {
    const labelR = discRadius * LABEL_RADIUS;
    const hasCenteredCover = artworkMode === 'centered' && coverUrl && coverImage;
    const hasOverlayCover = artworkMode === 'overlay' && coverUrl && coverImage;

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
      ctx.font = `bold ${labelR * 0.23}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = `${labelR * 0.04}px`;
      ctx.fillStyle = hasCenteredCover || hasOverlayCover
        ? 'rgba(255,240,210,0.72)'
        : 'rgba(255,240,210,0.82)';
      ctx.fillText(`SIDE ${side.label}`, 0, labelR * 0.18, labelR * 1.5);
      ctx.restore();
    }

    // 중心孔
    ctx.beginPath();
    ctx.arc(0, 0, discRadius * 0.02, 0, Math.PI * 2);
    ctx.fillStyle = '#08060a';
    ctx.fill();
  }

  function drawTrackMarkers(W: number, H: number) {
    if (!side) return;
    const { cx, cy, discRadius: r, pivotNormX, pivotNormY } = getTonearmGeometry(W, H);

    ctx.save();
    ctx.translate(cx, cy);

    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      const radius = GROOVE_OUTER_RADIUS + (GROOVE_INNER_RADIUS - GROOVE_OUTER_RADIUS) * t;
      const { discAngle } = solveStylusPosition(radius, pivotNormX, pivotNormY);
      const guideHalfSpan = 0.022 - t * 0.006;

      ctx.beginPath();
      ctx.arc(0, 0, radius * r, discAngle - guideHalfSpan, discAngle + guideHalfSpan);
      ctx.strokeStyle = `rgba(210, 196, 150, ${0.035 + (1 - t) * 0.015})`;
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }

    let accumulated = 0;
    for (let i = 1; i < side.tracks.length; i++) {
      accumulated += side.tracks[i - 1].duration;
      const markerRadius = trackOffsetToRadius(accumulated, side.totalDuration);
      const { discAngle } = solveStylusPosition(markerRadius, pivotNormX, pivotNormY);
      const markerHalfSpan = 0.04;

      ctx.beginPath();
      ctx.arc(0, 0, markerRadius * r, discAngle - markerHalfSpan, discAngle + markerHalfSpan);
      ctx.strokeStyle = 'rgba(225, 210, 165, 0.42)';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, markerRadius * r, discAngle - markerHalfSpan * 0.62, discAngle + markerHalfSpan * 0.62);
      ctx.strokeStyle = 'rgba(245, 232, 190, 0.2)';
      ctx.lineWidth = 0.45;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawTonearm(W: number, H: number) {
    const {
      pivotWX,
      pivotWY,
      angle,
      needleX,
      needleY,
      ux,
      uy,
      nx,
      ny,
      rearStemLen,
      rearWeightOffset,
      shellBaseX,
      shellBaseY,
      armStartX,
      armStartY,
      startHalfWidth,
      endHalfWidth,
    } = getTonearmRenderState(W, H);

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
    ctx.lineWidth = 5.5;
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
    ctx.ellipse(counterweightX, counterweightY, 8.5, 10.5, angle, 0, Math.PI * 2);
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

    // 主臂：渐变金属的细长锥形
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    const armGrad = ctx.createLinearGradient(armStartX, armStartY, shellBaseX, shellBaseY);
    armGrad.addColorStop(0, '#8e8467');
    armGrad.addColorStop(0.18, '#d9cfab');
    armGrad.addColorStop(0.5, '#b9ad88');
    armGrad.addColorStop(0.78, '#ebe0b7');
    armGrad.addColorStop(1, '#8b8063');
    ctx.fillStyle = armGrad;
    ctx.beginPath();
    ctx.moveTo(armStartX + nx * startHalfWidth, armStartY + ny * startHalfWidth);
    ctx.lineTo(armStartX - nx * startHalfWidth, armStartY - ny * startHalfWidth);
    ctx.lineTo(shellBaseX - nx * endHalfWidth, shellBaseY - ny * endHalfWidth);
    ctx.lineTo(shellBaseX + nx * endHalfWidth, shellBaseY + ny * endHalfWidth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 主臂高光与下缘阴影
    ctx.save();
    ctx.strokeStyle = 'rgba(255,249,229,0.42)';
    ctx.lineWidth = 1.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(armStartX + nx * 1.1, armStartY + ny * 1.1);
    ctx.lineTo(shellBaseX + nx * 0.7, shellBaseY + ny * 0.7);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(76,64,42,0.28)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(armStartX - nx * 1.6, armStartY - ny * 1.6);
    ctx.lineTo(shellBaseX - nx * 1.2, shellBaseY - ny * 1.2);
    ctx.stroke();
    ctx.restore();

    // 头壳
    ctx.save();
    ctx.translate(shellBaseX, shellBaseY);
    ctx.rotate(angle);
    const shellGrad = ctx.createLinearGradient(-12, 0, 4, 0);
    shellGrad.addColorStop(0, '#7e755c');
    shellGrad.addColorStop(0.55, '#d0c49f');
    shellGrad.addColorStop(1, '#736a52');
    ctx.fillStyle = shellGrad;
    ctx.beginPath();
    ctx.moveTo(-12, -3.4);
    ctx.lineTo(-10, 3.8);
    ctx.lineTo(1.5, 2.8);
    ctx.lineTo(3.2, -2.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,248,228,0.2)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 唱头
    ctx.fillStyle = '#4b463d';
    ctx.fillRect(-2.5, -3.2, 7.6, 6.4);
    ctx.fillStyle = '#6a6356';
    ctx.fillRect(0.5, -2.4, 3.8, 4.8);

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
    const wobble = getMechanicalWobble(armLengthPx);
    const angle = armAngle + wobble.armAngle + tonearmAngleJolt;
    const pivotWX = pivotX + wobble.armPivotX;
    const pivotWY = pivotY + wobble.armPivotY;
    const needleX = pivotWX + Math.cos(angle) * armLengthPx;
    const needleY = pivotWY + Math.sin(angle) * armLengthPx + tonearmLiftPx;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const nx = -uy;
    const ny = ux;
    const shellBaseX = needleX - ux * 15;
    const shellBaseY = needleY - uy * 15 + tonearmLiftPx * 0.15;

    return {
      pivotWX,
      pivotWY,
      angle,
      needleX,
      needleY,
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
      tipX: shellBaseX + ux * 6.8 - uy * 7.3,
      tipY: shellBaseY + uy * 6.8 + ux * 7.3,
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
    const playableInnerRadius = getPlayableInnerRadius(side.totalDuration);
    const normalizedRadius = Math.hypot(x - cx, y - cy) / r;
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
      return;
    }

    const time = getDragTimeFromPoint(point.x, point.y);
    if (time === null || !side) return;

    dragPreviewTime = time;
    animatedArmAngle = computeArmAngle(sideTimeToRadius(time, side.totalDuration));
    onSeek(time);
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
  }

  onMount(() => {
    ctx = canvas.getContext('2d')!;

    if (coverUrl) {
      coverImage = new Image();
      coverImage.src = coverUrl;
    }

    syncCanvasSize();
    scheduleCanvasSync();
    requestAnimationFrame(() => scheduleCanvasSync());
    resizeObserver = new ResizeObserver(() => scheduleCanvasSync());
    resizeObserver.observe(wrapElement);
    window.addEventListener('resize', scheduleCanvasSync);

    animationId = requestAnimationFrame(draw);
  });

  $: if (coverUrl && canvas) {
    coverImage = new Image();
    coverImage.src = coverUrl;
  }

  $: if (canvas) {
    scheduleCanvasSync();
  }

  onDestroy(() => {
    cancelAnimationFrame(animationId);
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
    style:width={canvasDisplaySize ? `${canvasDisplaySize}px` : undefined}
    style:height={canvasDisplaySize ? `${canvasDisplaySize}px` : undefined}
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

    <div class="machine-console">
      <button
        class="console-btn"
        class:engaged={transportEngaged}
        on:click={onTogglePlay}
        aria-label={transportEngaged ? '停止播放' : '开始播放'}
        type="button"
      >
        <span class="console-led" aria-hidden="true"></span>
        <span class="console-btn-text">{transportEngaged ? 'STOP' : 'PLAY'}</span>
      </button>
    </div>

    <div class="machine-art-switch" aria-label="封面显示模式">
      <span class="art-switch-label">ARTWORK</span>
      <div class="art-switch-btns">
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
    border-radius: 12px;
    box-shadow:
      0 12px 40px rgba(0, 0, 0, 0.42),
      0 4px 12px rgba(0, 0, 0, 0.24);
  }

  .turntable-canvas.needle-hover {
    cursor: grab;
  }

  .turntable-canvas.dragging {
    cursor: grabbing;
  }

  /* ── Machine console (bottom-left) ── */
  .machine-console {
    position: absolute;
    bottom: 3.8%;
    left: 5%;
    display: flex;
    align-items: center;
    font-family: 'Courier New', monospace;
  }

  /* ── Artwork mode switch (bottom-right) ── */
  .machine-art-switch {
    position: absolute;
    bottom: 3.5%;
    right: 4.5%;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    font-family: 'Courier New', monospace;
  }

  .art-switch-label {
    font-size: calc(7px * var(--app-font-scale));
    letter-spacing: 0.2em;
    color: rgba(195, 160, 95, 0.38);
    text-transform: uppercase;
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

  .art-btn {
    padding: 5px 9px;
    font-family: 'Courier New', monospace;
    font-size: calc(7.5px * var(--app-font-scale));
    font-weight: 700;
    letter-spacing: 0.15em;
    color: rgba(175, 138, 68, 0.38);
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease, box-shadow 0.14s ease;
    text-transform: uppercase;
  }

  .art-btn:hover:not(.active) {
    color: rgba(200, 162, 82, 0.65);
  }

  .art-btn.active {
    background: linear-gradient(180deg, #252015 0%, #161108 100%);
    color: rgba(218, 178, 96, 0.88);
    box-shadow:
      inset 0 1px 4px rgba(0, 0, 0, 0.55),
      inset 0 -1px 0 rgba(255, 230, 140, 0.04);
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
    transition: filter 0.1s ease, transform 0.1s ease;
    box-shadow:
      inset 0 1px 4px rgba(0, 0, 0, 0.55),
      inset 0 -1px 0 rgba(255, 230, 155, 0.04),
      0 1px 0 rgba(255, 230, 155, 0.06);
  }

  .console-btn:hover {
    filter: brightness(1.18);
  }

  .console-btn:active {
    transform: translateY(1px);
    filter: brightness(0.9);
    box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.75);
  }

  .console-btn.engaged {
    box-shadow:
      inset 0 3px 8px rgba(0, 0, 0, 0.7),
      inset 0 1px 0 rgba(255, 230, 155, 0.02);
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
    font-size: calc(8px * var(--app-font-scale));
    font-weight: 700;
    letter-spacing: 0.24em;
    color: rgba(218, 190, 135, 0.52);
    text-transform: uppercase;
    transition: color 0.15s ease;
  }

  .console-btn.engaged .console-btn-text {
    color: rgba(218, 190, 135, 0.88);
  }

</style>
