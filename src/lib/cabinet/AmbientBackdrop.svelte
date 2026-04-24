<script lang="ts">
  import { onDestroy, tick } from "svelte";

  export let coverUrl: string | undefined = undefined;

  type Layer = { id: number; url: string; phase: "pending" | "in" | "out" };

  let layers: Layer[] = [];
  let nextId = 1;
  let lastUrl: string | undefined = undefined;
  let transitionPulse = 0;
  let cleanupTimers: ReturnType<typeof setTimeout>[] = [];
  let loadToken = 0;

  function later(fn: () => void, ms: number) {
    const timer = setTimeout(() => {
      cleanupTimers = cleanupTimers.filter((item) => item !== timer);
      fn();
    }, ms);
    cleanupTimers = [...cleanupTimers, timer];
  }

  function preloadImage(url: string): Promise<void> {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => resolve();
      image.src = url;
    });
  }

  async function waitForPaintFrame() {
    await tick();
    if (typeof requestAnimationFrame !== "function") return;
    // rAF runs before paint. Waiting for two frames ensures the inserted
    // opacity:0 layer is committed before we switch it to opacity:1.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  function trimToLayer(id: number) {
    layers = layers.filter((layer) => layer.id === id);
  }

  async function transitionToCover(nextUrl: string | undefined) {
    const token = ++loadToken;

    if (!nextUrl) {
      transitionPulse += 1;
      layers = layers.map((layer) => ({ ...layer, phase: "out" as const }));
      later(() => {
        if (token === loadToken) layers = [];
      }, 5200);
      return;
    }

    // Keep the old ambient image visible until the new cover has decoded.
    // Otherwise the fixed page background flashes through during album swaps.
    await preloadImage(nextUrl);
    if (token !== loadToken) return;

    const newLayer: Layer = { id: nextId++, url: nextUrl, phase: "pending" };
    layers = [...layers, newLayer];

    await waitForPaintFrame();
    if (token !== loadToken) return;

    transitionPulse += 1;
    layers = layers.map((layer) => ({
      ...layer,
      phase: layer.id === newLayer.id ? "in" : "out",
    }));
    later(() => {
      if (token === loadToken) trimToLayer(newLayer.id);
    }, 5400);
  }

  $: if (coverUrl !== lastUrl) {
    lastUrl = coverUrl;
    void transitionToCover(coverUrl);
  }

  onDestroy(() => {
    for (const timer of cleanupTimers) {
      clearTimeout(timer);
    }
    cleanupTimers = [];
    loadToken += 1;
  });
</script>

<div class="ambient" aria-hidden="true">
  {#each layers as layer (layer.id)}
    <div
      class="layer"
      class:in={layer.phase === "in"}
      class:out={layer.phase === "out"}
      style="background-image: url({layer.url});"
    ></div>
  {/each}
  {#key transitionPulse}
    <div class="transition-wash"></div>
  {/key}
  <div class="vignette"></div>
  <div class="grain"></div>
</div>

<style>
  .ambient {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
    background: #0a0604;
  }

  .layer {
    position: absolute;
    /* Oversize so blur edges + Ken Burns translation never reveal seams */
    inset: -15%;
    background-size: cover;
    background-position: center;
    /* Heavy blur + desaturation keeps it ambient, not distracting */
    filter: blur(48px) saturate(1.05) brightness(0.95);
    opacity: 0;
    will-change: opacity, transform;
    animation: kenburns 48s ease-in-out infinite alternate;
    transition: opacity 5s cubic-bezier(0.22, 0.8, 0.24, 1);
  }

  .layer.in {
    opacity: 1;
  }

  .layer.out {
    opacity: 0;
  }

  .transition-wash {
    position: absolute;
    inset: -6%;
    pointer-events: none;
    opacity: 0;
    background:
      radial-gradient(
        ellipse at 50% 45%,
        rgba(255, 230, 180, 0.11) 0%,
        rgba(140, 84, 44, 0.10) 34%,
        rgba(16, 8, 3, 0.22) 74%,
        rgba(8, 4, 1, 0.38) 100%
      ),
      linear-gradient(
        115deg,
        rgba(255, 245, 220, 0.045),
        rgba(133, 54, 30, 0.06) 48%,
        rgba(0, 0, 0, 0.18)
      );
    mix-blend-mode: soft-light;
    animation: backdrop-wash 5s cubic-bezier(0.22, 0.8, 0.24, 1) both;
  }

  @keyframes kenburns {
    0% {
      transform: scale(1.05) translate(-1.5%, -1%);
    }
    100% {
      transform: scale(1.18) translate(2%, 1.5%);
    }
  }

  @keyframes backdrop-wash {
    0% {
      opacity: 0;
      transform: scale(1.02);
    }
    18% {
      opacity: 0.92;
      transform: scale(1.015);
    }
    58% {
      opacity: 0.54;
    }
    100% {
      opacity: 0;
      transform: scale(1);
    }
  }

  /* Darkening vignette: pulls eye toward the cabinet in the center */
  .vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        ellipse at 50% 50%,
        rgba(0, 0, 0, 0) 0%,
        rgba(0, 0, 0, 0.15) 60%,
        rgba(0, 0, 0, 0.5) 100%
      );
  }

  /* Subtle film grain to break up blur banding */
  .grain {
    position: absolute;
    inset: 0;
    opacity: 0.06;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }

  @media (prefers-reduced-motion: reduce) {
    .layer {
      animation: none;
      transform: scale(1.1);
    }
    .transition-wash {
      animation: none;
      opacity: 0;
    }
  }
</style>
