<script lang="ts">
  export let label = "";
  export let count: number | null = null;
  export let active = false;
  export let empty = false;
  export let compact = false;
  export let inputMode = false;
</script>

<span
  class="plate"
  class:plate-active={active}
  class:plate-empty-state={empty}
  class:plate-compact={compact}
  class:plate-input={inputMode}
>
  {#if inputMode}
    <slot />
  {:else}
    <span class="plate-name">{label}</span>
    {#if count !== null}
      <span class="plate-dot" aria-hidden="true">·</span>
      <span class="plate-count">{count}</span>
    {:else if empty}
      <span class="plate-empty">（空）</span>
    {/if}
  {/if}
</span>

<style>
  .plate {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    width: fit-content;
    max-width: min(360px, 80%);
    min-width: 0;
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-left: 2px solid rgba(42, 26, 12, 0.26);
    border-bottom: 1px solid rgba(42, 26, 12, 0.32);
    border-radius: 0;
    background: rgba(246, 235, 214, 0.86);
    box-shadow: none;
    color: #26180c;
    font-family: "Noto Serif SC", "Songti SC", serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-shadow: none;
    transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
  }

  .plate::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 1px;
    background: rgba(255, 245, 224, 0.54);
    pointer-events: none;
  }

  :global(.face:hover) .plate {
    border-left-color: rgba(42, 26, 12, 0.5);
    border-bottom-color: rgba(42, 26, 12, 0.55);
    background: rgba(252, 243, 224, 0.94);
  }

  .plate-active {
    border-left-color: #211207;
    border-bottom-color: #211207;
    background: rgba(255, 247, 231, 0.98);
  }

  .plate-active .plate-name {
    font-weight: 700;
  }

  .plate-empty-state {
    color: rgba(38, 24, 12, 0.46);
    background: rgba(225, 211, 184, 0.6);
  }

  .plate-compact {
    padding: 0 11px;
  }

  .plate-input {
    min-width: 190px;
    max-width: 260px;
    padding: 0 12px;
  }

  .plate-name {
    position: relative;
    z-index: 1;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plate-dot {
    display: none;
  }

  .plate-count {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 100%;
    padding-left: 9px;
    border-left: 1px solid rgba(42, 26, 12, 0.28);
    border-radius: 0;
    background: transparent;
    color: rgba(38, 24, 12, 0.68);
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
  }

  .plate-empty {
    position: relative;
    z-index: 1;
    font-family: "Noto Serif SC", serif;
    font-size: 11px;
    opacity: 0.6;
  }

  :global(.plate-input input) {
    position: relative;
    z-index: 1;
  }
</style>
