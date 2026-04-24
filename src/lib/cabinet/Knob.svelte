<script lang="ts">
  export let value: number = 0.8;        // 0~1
  export let label: string = '';
  export let size: number = 84;
  export let onChange: (v: number) => void = () => {};

  let startY = 0;
  let startValue = 0;
  let dragging = false;

  $: angle = -135 + value * 270;          // -135° ~ +135°

  function clamp(v: number) {
    return Math.max(0, Math.min(1, v));
  }

  function onPointerDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    startY = e.clientY;
    startValue = value;
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dy = startY - e.clientY;         // 向上拖 → 增大
    const next = clamp(startValue + dy / 180);
    if (next !== value) {
      value = next;
      onChange(value);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.03 : 0.03;
    const next = clamp(value + delta);
    if (next !== value) {
      value = next;
      onChange(value);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    let delta = 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') delta = 0.05;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') delta = -0.05;
    else return;
    e.preventDefault();
    const next = clamp(value + delta);
    if (next !== value) {
      value = next;
      onChange(value);
    }
  }
</script>

<div class="knob-wrap" style="--size:{size}px">
  <div
    class="knob"
    role="slider"
    tabindex="0"
    aria-label={label || 'knob'}
    aria-valuemin="0"
    aria-valuemax="1"
    aria-valuenow={value}
    class:dragging
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:wheel={onWheel}
    on:keydown={onKeydown}
  >
    <div class="knob-body">
      <div class="knob-indicator" style="transform: translate(-50%, -100%) rotate({angle}deg)"></div>
    </div>
    <!-- 环形刻度 -->
    <svg class="knob-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,230,190,0.08)" stroke-width="2" />
      <circle
        cx="50" cy="50" r="44"
        fill="none"
        stroke="url(#knobGrad)"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray={`${value * 207.3} 276.46`}
        transform="rotate(135 50 50)"
      />
      <defs>
        <linearGradient id="knobGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f0b44b" />
          <stop offset="100%" stop-color="#c9642d" />
        </linearGradient>
      </defs>
    </svg>
  </div>
  {#if label}
    <div class="knob-label">{label}</div>
  {/if}
</div>

<style>
  .knob-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .knob {
    position: relative;
    width: var(--size);
    height: var(--size);
    touch-action: none;
    outline: none;
  }
  .knob:focus-visible .knob-body {
    box-shadow:
      0 0 0 2px rgba(240, 180, 75, 0.6),
      inset 0 2px 4px rgba(255, 235, 190, 0.25),
      inset 0 -6px 12px rgba(0, 0, 0, 0.75),
      0 4px 10px rgba(0, 0, 0, 0.55);
  }
  .knob-body {
    position: absolute;
    inset: 12%;
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 30%, #4a3e2c 0%, #2a2218 60%, #181410 100%);
    box-shadow:
      inset 0 2px 4px rgba(255, 235, 190, 0.18),
      inset 0 -6px 12px rgba(0, 0, 0, 0.75),
      0 4px 10px rgba(0, 0, 0, 0.55);
    cursor: grab;
  }
  .knob.dragging .knob-body {
    cursor: grabbing;
  }
  .knob-indicator {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 3px;
    height: 42%;
    background: linear-gradient(180deg, #f0b44b 0%, #c9642d 100%);
    border-radius: 2px;
    transform-origin: 50% 100%;
    box-shadow: 0 0 6px rgba(240, 180, 75, 0.6);
  }
  .knob-ring {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .knob-label {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    color: #c79a5b;
    opacity: 0.85;
  }
</style>
