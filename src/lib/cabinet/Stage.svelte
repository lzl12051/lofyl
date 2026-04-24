<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  export let width: number = 1600;
  export let height: number = 1600;
  export let padding: number = 12;

  let rootEl: HTMLDivElement | null = null;
  let stageEl: HTMLDivElement | null = null;
  let scale = 1;
  let resizeObserver: ResizeObserver | null = null;

  function fit() {
    if (!rootEl) return;
    const availableWidth = Math.max(0, rootEl.clientWidth - padding * 2);
    const availableHeight = Math.max(0, rootEl.clientHeight - padding * 2);
    const sx = availableWidth / width;
    const sy = availableHeight / height;
    scale = Math.min(sx, sy, 1);
  }

  onMount(() => {
    fit();
    resizeObserver = new ResizeObserver(() => fit());
    if (rootEl) {
      resizeObserver.observe(rootEl);
    }
    window.addEventListener("resize", fit);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    window.removeEventListener("resize", fit);
  });
</script>

<div class="stage-root" bind:this={rootEl}>
  <div
    class="stage-shell"
    style="width:{Math.round(width * scale)}px;height:{Math.round(height * scale)}px"
  >
    <div
      class="stage"
      bind:this={stageEl}
      style="width:{width}px;height:{height}px;transform:scale({scale})"
    >
      <slot />
    </div>
  </div>
</div>

<style>
  .stage-root {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .stage-shell {
    position: relative;
    flex: 0 0 auto;
  }
  .stage {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    transform: scale(1);
  }
</style>
