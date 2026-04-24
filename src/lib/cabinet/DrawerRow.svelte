<script lang="ts">
  import BrassPlate from "./BrassPlate.svelte";

  export let id = "";
  export let label = "";
  export let count: number | null = 0;
  export let isOpen = false;
  export let isPending = false;
  export let isAdd = false;
  export let isAdding = false;
  export let woodFreq = 0.9;
  export let woodHue = 0;
  export let onToggle: (id: string) => void = () => {};
  export let onClose: () => void = () => {};

  const DRAWER_OPEN_MS = 220;
  const DRAWER_CLOSE_MS = 180;
  const openEase = cubicBezier(0.22, 0.8, 0.24, 1);
  const closeEase = cubicBezier(0.55, 0, 0.72, 0.32);

  function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    function sampleX(t: number) {
      return ((ax * t + bx) * t + cx) * t;
    }

    function sampleY(t: number) {
      return ((ay * t + by) * t + cy) * t;
    }

    function sampleDerivativeX(t: number) {
      return (3 * ax * t + 2 * bx) * t + cx;
    }

    return (x: number) => {
      let t = x;
      for (let i = 0; i < 6; i += 1) {
        const dx = sampleX(t) - x;
        const d = sampleDerivativeX(t);
        if (Math.abs(dx) < 0.001 || Math.abs(d) < 0.001) break;
        t -= dx / d;
      }
      return sampleY(Math.max(0, Math.min(1, t)));
    };
  }

  function openDrawer(node: Element) {
    const h = node.scrollHeight;
    return {
      duration: DRAWER_OPEN_MS,
      easing: openEase,
      css: (t: number) => `
        height: ${Math.max(0, h * t)}px;
        opacity: ${0.28 + t * 0.72};
        transform: scaleY(${Math.max(0.001, t)});
        transform-origin: top;
        overflow: hidden;
      `,
    };
  }

  function closeDrawer(node: Element) {
    const h = node.scrollHeight;
    return {
      duration: DRAWER_CLOSE_MS,
      easing: closeEase,
      css: (t: number) => `
        height: ${Math.max(0, h * t)}px;
        opacity: ${0.2 + t * 0.8};
        transform: scaleY(${Math.max(0.001, t)});
        transform-origin: top;
        overflow: hidden;
      `,
    };
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      onClose();
    }
  }
</script>

<div
  class="drawer-row"
  class:open={isOpen}
  class:pending={isPending}
  class:drawer-add={isAdd}
  style="--wood-freq:{woodFreq}; --wood-hue:{woodHue}deg;"
>
  {#if isAdding}
    <div class="face face-adding">
      <slot name="plate" />
    </div>
  {:else}
    <button
      class="face"
      class:face-open={isOpen}
      class:face-add={isAdd}
      type="button"
      aria-expanded={isAdd ? undefined : isOpen}
      aria-controls={isAdd ? undefined : `drawer-${id}`}
      title={isAdd ? "新建分类抽屉" : isOpen ? `关闭 ${label}` : `打开 ${label}`}
      on:click={() => onToggle(id)}
      on:keydown={handleKeydown}
    >
      <slot name="plate">
        <BrassPlate {label} {count} active={isOpen} empty={isPending && (count ?? 0) === 0} />
      </slot>
      <span class="face-sheen" aria-hidden="true"></span>
    </button>
  {/if}

  {#if isOpen}
    <div id={`drawer-${id}`} class="interior" in:openDrawer out:closeDrawer>
      <slot />
    </div>
  {/if}
</div>

<style>
  .drawer-row {
    position: relative;
    border-radius: 6px;
    background:
      linear-gradient(180deg, hsl(calc(28deg + var(--wood-hue)) 38% 46%) 0%, hsl(calc(20deg + var(--wood-hue)) 44% 28%) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 232, 196, 0.25),
      inset 0 -1px 0 rgba(0, 0, 0, 0.55),
      0 1px 0 rgba(40, 22, 8, 0.45);
    flex-shrink: 0;
  }

  .drawer-row::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 6px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='turbulence' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.09  0 0 0 0 0.03  0 0 0 0.34 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    background-size: 180px 180px;
    mix-blend-mode: multiply;
    opacity: calc(0.55 + var(--wood-freq) * 0.2);
    pointer-events: none;
  }

  .drawer-row.open {
    box-shadow:
      inset 0 1px 0 rgba(255, 232, 196, 0.4),
      inset 0 -1px 0 rgba(0, 0, 0, 0.65),
      0 6px 16px -6px rgba(0, 0, 0, 0.55);
  }

  .drawer-add {
    background: linear-gradient(180deg, #87572b 0%, #5e3a18 100%);
  }

  .face {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 42px;
    padding: 0 30px;
    border: 0;
    background: transparent;
    cursor: pointer;
    z-index: 1;
    transition: background 140ms ease;
  }

  .face:hover {
    background: rgba(255, 230, 190, 0.035);
  }

  .face-open {
    background: rgba(255, 230, 190, 0.05);
  }

  .face-sheen {
    position: absolute;
    inset: 0;
    border-radius: 6px;
    background:
      linear-gradient(
        180deg,
        rgba(255, 240, 210, 0.14) 0%,
        transparent 40%,
        transparent 65%,
        rgba(0, 0, 0, 0.2) 100%
      );
    pointer-events: none;
  }

  .face-open .face-sheen {
    animation: face-highlight 120ms cubic-bezier(0.22, 0.8, 0.24, 1);
  }

  @keyframes face-highlight {
    0% {
      opacity: 0.25;
      transform: translateY(0);
      box-shadow: inset 0 0 0 rgba(255, 240, 210, 0);
    }
    45% {
      opacity: 1;
      transform: translateY(-1px);
      box-shadow: inset 0 14px 14px rgba(255, 240, 210, 0.13);
    }
    100% {
      opacity: 0.85;
      transform: translateY(0);
      box-shadow: inset 0 0 0 rgba(255, 240, 210, 0);
    }
  }

  .face:focus-visible {
    outline: 2px solid rgba(240, 180, 75, 0.65);
    outline-offset: -4px;
    border-radius: 6px;
  }

  .interior {
    position: relative;
    padding: 0 8px 8px;
    z-index: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .face {
      transition-duration: 50ms !important;
    }

    .face-open .face-sheen {
      animation-duration: 50ms !important;
    }
  }
</style>
