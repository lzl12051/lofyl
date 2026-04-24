<script lang="ts">
    export let volume: number = 0.8;
  export let musicMeterLevels: number[] = [];
  export let isSpectrumEnabled: boolean = true;
  export let isTransportActive: boolean = false;
  export let onVolumeChange: (v: number) => void = () => {};
  export let onToggleSpectrum: () => void = () => {};
  export let onTogglePlay: () => void = () => {};

  // ── Fader ──────────────────────────────────────────────────
  let faderTrackEl: HTMLDivElement | null = null;

  function clamp(v: number) { return Math.max(0, Math.min(1, v)); }

  function valueFromClientY(clientY: number): number {
    if (!faderTrackEl) return volume;
    const rect = faderTrackEl.getBoundingClientRect();
    return clamp(1 - (clientY - rect.top) / rect.height);
  }

  function handleFaderPointerdown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onVolumeChange(valueFromClientY(e.clientY));
  }

  function handleFaderPointermove(e: PointerEvent) {
    if (e.buttons === 0) return;
    onVolumeChange(valueFromClientY(e.clientY));
  }

  function handleFaderWheel(e: WheelEvent) {
    e.preventDefault();
    onVolumeChange(clamp(volume + e.deltaY / 600));
  }

  function handleFaderKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.025;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault(); onVolumeChange(clamp(volume + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault(); onVolumeChange(clamp(volume - step));
    }
  }

  const TRACK_H = 100;
  const THUMB_H = 14;
  $: thumbBottom = volume * (TRACK_H - THUMB_H);
  $: fillHeight  = thumbBottom + THUMB_H / 2;

  const SPECTRUM_ROWS = 10;
  const SPECTRUM_COLS = 15;
  const ROW_INDICES = Array.from({ length: SPECTRUM_ROWS }, (_, i) => i);
  const DISPLAY_THRESHOLDS = [0.05, 0.12, 0.2, 0.28, 0.38, 0.48, 0.6, 0.72, 0.85, 0.95];

  function getLitRows(level: number): number {
    const clamped = Math.max(0, Math.min(1, level));
    const normalized = (clamped - 0.05) / 0.95;
    if (normalized <= 0) return 0;
    const shaped = Math.min(1, Math.pow(normalized, 1.45) * 0.96);
    return DISPLAY_THRESHOLDS.reduce(
      (count, threshold) => count + (shaped >= threshold ? 1 : 0),
      0,
    );
  }

  $: cols = Array.from(
    { length: SPECTRUM_COLS },
    (_, i) => (isSpectrumEnabled ? (musicMeterLevels[i] ?? 0) : 0),
  );

</script>

<div class="console">
  <!-- 上半：PLAY/SPEC + 频谱 + VOL -->
  <div class="console-top">
    <div class="console-left">
      <button
        class="play-btn"
        class:engaged={isTransportActive}
        on:click={onTogglePlay}
        type="button"
        aria-label={isTransportActive ? '停止' : '播放'}
      >
        <span class="play-led" aria-hidden="true"></span>
        <span class="play-text">PLAY</span>
      </button>
      <button
        class="mini-btn spec-under-play"
        class:engaged={isSpectrumEnabled}
        on:click={onToggleSpectrum}
        type="button"
        aria-label={isSpectrumEnabled ? '关闭频谱' : '开启频谱'}
      >SPEC</button>
      <div class="screw screw-tl" aria-hidden="true"></div>
      <div class="screw screw-bl" aria-hidden="true"></div>
    </div>

    <div class="spectrum-panel" class:disabled={!isSpectrumEnabled}>
      <div class="spectrum-wrap" aria-hidden="true">
        {#each cols as level}
          {@const litRows = getLitRows(level)}
          <div class="spectrum-column">
            {#each ROW_INDICES as row}
              <span
                class="spectrum-cell"
                class:lit={row < litRows}
                class:warm={row >= 5}
                class:hot={row >= 8}
              ></span>
            {/each}
          </div>
        {/each}
      </div>
      <div class="freq-labels" aria-hidden="true">
        <span>40</span><span>100</span><span>250</span><span>660</span>
        <span>1.6K</span><span>4K</span><span>10K</span><span>16K</span>
      </div>
    </div>

    <div class="console-right">
      <div class="screw screw-tr" aria-hidden="true"></div>
      <div class="screw screw-br" aria-hidden="true"></div>

      <div class="fader-wrap">
        <span class="fader-label">VOL</span>

        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="fader-track"
          bind:this={faderTrackEl}
          role="slider"
          tabindex="0"
          aria-label="音量"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(volume * 100)}
          on:pointerdown={handleFaderPointerdown}
          on:pointermove={handleFaderPointermove}
          on:wheel|preventDefault={handleFaderWheel}
          on:keydown={handleFaderKeydown}
        >
          <div class="fader-fill" style="height:{fillHeight}px"></div>
          <div class="fader-notches" aria-hidden="true">
            {#each [0,1,2,3,4,5,6] as _}
              <div class="fader-notch"></div>
            {/each}
          </div>
          <div
            class="fader-thumb"
            style="bottom:{thumbBottom}px"
            aria-hidden="true"
          ></div>
        </div>
      </div>
    </div>
  </div>

</div>

<style>
  .console {
    position: relative;
    height: 100%;
    min-height: 0;
    border-radius: 12px;
    isolation: isolate;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(255, 230, 190, 0.09), transparent 62%),
      linear-gradient(180deg, #2d241a 0%, #1d1711 58%, #15100c 100%);
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.52),
      inset 0 1px 0 rgba(255, 230, 190, 0.17),
      0 4px 12px rgba(0, 0, 0, 0.42),
      0 0 0 1px rgba(90, 58, 31, 0.4);
    display: grid;
    grid-template-columns: 100px minmax(0, 1fr) 70px;
    align-items: stretch;
    gap: 12px;
    padding: 14px 14px 12px;
    overflow: hidden;
  }

  .console::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: inherit;
    background: url("../../assets/textures/brushed-metal-panel.webp") center / 100% 100% no-repeat;
    mix-blend-mode: soft-light;
    opacity: 0.64;
    pointer-events: none;
  }

  .console-top {
    display: contents; /* children participate directly in .console grid */
  }

  .console-left,
  .console-right {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .console-left {
    flex-direction: column;
  }

  /* PLAY 按钮 */
  .play-btn {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 11px;
    background: linear-gradient(180deg, #3a2e20 0%, #21180f 100%);
    border: 1px solid #120d08;
    border-top-color: rgba(255, 235, 185, 0.22);
    border-radius: 8px;
    color: #d4a862;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.22em;
    cursor: pointer;
    box-shadow:
      inset 0 2px 4px rgba(255, 230, 155, 0.04),
      inset 0 -2px 6px rgba(0, 0, 0, 0.7);
  }
  .play-btn.engaged {
    color: #f5c060;
  }
  .play-led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #3a2a10;
    box-shadow: inset 0 0 3px rgba(0, 0, 0, 0.8);
  }
  .play-btn.engaged .play-led {
    background: #f0b44b;
    box-shadow: 0 0 8px rgba(240, 180, 75, 0.75);
  }

  /* 频谱 */
  .spectrum-panel {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 7px;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 1px solid #15100a;
    border-top-color: rgba(255, 235, 185, 0.16);
    border-radius: 10px;
    background:
      radial-gradient(ellipse at 50% 40%, rgba(240, 180, 75, 0.12), transparent 62%),
      linear-gradient(180deg, #15100b 0%, #26190d 100%);
    box-shadow:
      inset 0 0 0 1px rgba(240, 180, 75, 0.12),
      inset 0 2px 8px rgba(0, 0, 0, 0.9),
      inset 0 0 40px rgba(240, 180, 75, 0.05),
      0 1px 0 rgba(255, 230, 155, 0.06);
    padding: 15px 18px 10px;
  }
  .spectrum-panel::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 10px;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.06),
      transparent 30%,
      transparent 80%,
      rgba(0, 0, 0, 0.3)
    );
    pointer-events: none;
  }
  .spectrum-panel.disabled {
    filter: saturate(0.42) brightness(0.62);
  }
  .spectrum-wrap,
  .freq-labels {
    position: relative;
    z-index: 1;
  }
  .spectrum-wrap {
    display: flex;
    align-items: center;
    justify-content: stretch;
    gap: 3px;
    min-height: 0;
    height: 100%;
  }
  .spectrum-column {
    flex: 1;
    display: flex;
    flex-direction: column-reverse;
    justify-content: center;
    gap: 3px;
    height: 100%;
  }
  .spectrum-cell {
    width: 100%;
    min-width: 5px;
    height: 4px;
    border-radius: 999px;
    background: rgba(48, 68, 40, 0.28);
  }
  .spectrum-cell.lit {
    background: #f4c15a;
    box-shadow:
      0 0 5px rgba(244, 193, 90, 0.9),
      0 0 12px rgba(244, 193, 90, 0.25);
  }
  .spectrum-cell.lit.warm {
    background: #f18f3d;
    box-shadow:
      0 0 6px rgba(241, 143, 61, 0.95),
      0 0 14px rgba(241, 143, 61, 0.28);
  }
  .spectrum-cell.lit.hot {
    background: #ef5c36;
    box-shadow:
      0 0 7px rgba(239, 92, 54, 0.95),
      0 0 16px rgba(239, 92, 54, 0.34);
  }
  .spectrum-panel.disabled .spectrum-cell {
    background: rgba(29, 32, 22, 0.2);
    box-shadow: none;
  }
  .spectrum-panel.disabled .freq-labels {
    opacity: 0.32;
  }
  .freq-labels {
    display: flex;
    justify-content: space-between;
    padding-top: 3px;
    color: #a87c3a;
    font-family: "JetBrains Mono", "Courier New", monospace;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .mini-btn {
    min-width: 56px;
    padding: 7px 10px;
    background: linear-gradient(180deg, #3a2e20 0%, #21180f 100%);
    border: 1px solid #120d08;
    border-top-color: rgba(255, 235, 185, 0.2);
    border-radius: 5px;
    color: #c09448;
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2em;
    cursor: pointer;
  }
  .mini-btn.engaged {
    color: #f5c060;
  }
  .spec-under-play {
    min-width: 56px;
    padding: 6px 10px;
    font-size: 12px;
  }
  .screw {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #6b5a3e 0%, #2a2218 70%);
    box-shadow:
      inset 0 1px 2px rgba(255, 235, 185, 0.2),
      inset 0 -1px 2px rgba(0, 0, 0, 0.7);
  }
  .screw::before {
    content: '';
    position: absolute;
    inset: 35%;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 1px;
    transform: rotate(35deg);
  }
  .screw-tl { top: 4px; left: 4px; }
  .screw-bl { bottom: 4px; left: 4px; }
  .screw-tr { top: 4px; right: 4px; }
  .screw-br { bottom: 4px; right: 4px; }

  /* ── Volume fader ────────────────────────────────────────── */
  .fader-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    user-select: none;
  }

  .fader-label {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: #c09448;
  }

  .fader-track {
    position: relative;
    width: 10px;
    height: 100px;
    border-radius: 5px;
    background: #0b0906;
    box-shadow:
      inset 0 0 0 1px rgba(0, 0, 0, 0.8),
      inset 0 2px 6px rgba(0, 0, 0, 0.9),
      0 0 0 1px rgba(255, 230, 155, 0.08);
    cursor: ns-resize;
    outline: none;
    flex-shrink: 0;
    overflow: visible;
  }
  .fader-track:focus-visible {
    box-shadow:
      inset 0 0 0 1px rgba(240, 180, 75, 0.5),
      inset 0 2px 6px rgba(0, 0, 0, 0.9),
      0 0 6px rgba(240, 180, 75, 0.3);
  }

  .fader-fill {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    border-radius: 5px;
    background: linear-gradient(180deg, #f0b44b 0%, #c97a22 100%);
    box-shadow: 0 0 8px rgba(240, 180, 75, 0.4);
    pointer-events: none;
  }

  .fader-notches {
    position: absolute;
    inset: 4px 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    pointer-events: none;
    z-index: 1;
  }
  .fader-notch {
    width: 4px;
    height: 1px;
    background: rgba(255, 230, 155, 0.12);
    border-radius: 1px;
  }

  .fader-thumb {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 26px;
    height: 14px;
    border-radius: 3px;
    background: linear-gradient(180deg, #4a3820 0%, #2e2010 50%, #3a2a14 100%);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.7),
      0 1px 0 rgba(255, 235, 155, 0.18),
      0 2px 6px rgba(0, 0, 0, 0.6),
      inset 0 1px 0 rgba(255, 230, 155, 0.14);
    pointer-events: none;
    z-index: 2;
  }
  .fader-thumb::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 20%;
    right: 20%;
    height: 1px;
    transform: translateY(-1px);
    background: rgba(255, 210, 120, 0.35);
    border-radius: 1px;
  }
  .fader-thumb::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 20%;
    right: 20%;
    height: 1px;
    transform: translateY(1px);
    background: rgba(255, 210, 120, 0.2);
    border-radius: 1px;
  }

</style>
