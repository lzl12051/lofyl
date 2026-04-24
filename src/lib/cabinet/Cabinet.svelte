<script lang="ts">
  // 木柜外壳：左列（唱盘+控制台）/ 右列（信息）/ 底部全宽书架
</script>

<div class="cabinet-root">
  <div class="cabinet-shell"></div>
  <div class="inlay" aria-hidden="true"></div>

  <div class="grid">
    <div class="player-stack module-frame">
      <div class="turntable-slot">
        <slot name="turntable" />
      </div>
      <div class="console-slot">
        <slot name="console" />
      </div>
    </div>

    <div class="info-slot module-frame">
      <div class="frame-content">
        <slot name="info" />
      </div>
    </div>

    <div class="shelf-slot module-frame">
      <div class="frame-content">
        <slot name="shelf" />
      </div>
    </div>
  </div>
</div>

<style>
  .cabinet-root {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    /* CSS 变量：木色/金属/象牙/墨 */
    --wood-light: #d5a773;
    --wood-mid: #b98654;
    --wood-dark: #8f5f38;
    --wood-shadow: #5a3a1f;
    --panel-black: #151310;
    --panel-black-2: #221f1b;
    --brass: #c79a5b;
    --brass-hi: #ecc987;
    --brass-dim: #8a6432;
    --amber: #f0b44b;
    --amber-dim: #6b4a1a;
    --ivory: #f2e8d6;
    --ivory-dim: #d9cdb4;
    --ink: #2a1e10;
    --ink-soft: #5a4326;
    --accent: #c9642d;
    --line: rgba(90, 58, 31, 0.22);
    --player-width: 826px;
    --console-height: 150px;
    --stack-gap: 18px;
    --top-zone-height: calc(var(--player-width) + var(--console-height) + var(--stack-gap));
  }

  .cabinet-shell {
    position: absolute;
    inset: 0;
    border-radius: 28px;
    background:
      radial-gradient(ellipse at 50% 120%, rgba(0, 0, 0, 0.55), transparent 60%),
      linear-gradient(180deg, #d9ab74 0%, #c38d58 55%, #a5743f 100%);
    box-shadow:
      0 40px 80px -20px rgba(0, 0, 0, 0.7),
      inset 0 0 0 2px rgba(90, 58, 31, 0.35),
      inset 0 0 0 10px rgba(255, 230, 195, 0.08),
      inset 0 0 0 11px rgba(90, 58, 31, 0.2);
    overflow: hidden;
  }
  .cabinet-shell::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      url("../../assets/textures/oak-monochrome-grain.webp") center / 760px 760px repeat,
      repeating-linear-gradient(
        92deg,
        rgba(90, 45, 15, 0.1) 0px,
        rgba(90, 45, 15, 0.1) 1px,
        transparent 1px,
        transparent 6px,
        rgba(255, 220, 170, 0.06) 6px,
        rgba(255, 220, 170, 0.06) 7px,
        transparent 7px,
        transparent 14px
      ),
      repeating-linear-gradient(
        90deg,
        rgba(70, 35, 10, 0.12) 0px,
        rgba(70, 35, 10, 0.12) 0.5px,
        transparent 0.5px,
        transparent 3px
      );
    background-blend-mode: multiply, normal, normal;
    mix-blend-mode: multiply;
    opacity: 0.52;
    pointer-events: none;
  }
  .cabinet-shell::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.3  0 0 0 0 0.18  0 0 0 0 0.08  0 0 0 0.25 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    background-size: 300px 300px;
    mix-blend-mode: overlay;
    opacity: 0.55;
    pointer-events: none;
  }

  .inlay {
    position: absolute;
    inset: 16px;
    border-radius: 22px;
    border: 1px solid rgba(90, 58, 31, 0.35);
    box-shadow:
      inset 0 1px 0 rgba(255, 240, 215, 0.25),
      0 0 0 4px rgba(90, 58, 31, 0.08);
    pointer-events: none;
    z-index: 2;
  }

  .grid {
    position: absolute;
    inset: 32px;
    z-index: 3;
    display: grid;
    grid-template-columns: var(--player-width) minmax(0, 1fr);
    grid-template-rows: var(--top-zone-height) minmax(0, 1fr);
    grid-template-areas:
      "player info"
      "shelf  shelf";
    gap: var(--stack-gap);
    min-height: 0;
  }

  .player-stack {
    grid-area: player;
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 12px;
    min-width: 0;
    min-height: 0;
  }

  /* Raised wooden rails around each major cabinet module. */
  .module-frame {
    position: relative;
    border-radius: 18px;
    isolation: isolate;
    background:
      linear-gradient(180deg, rgba(255, 226, 170, 0.16), rgba(31, 14, 5, 0.28)),
      url("../../assets/textures/oak-monochrome-grain.webp") center / 640px 640px repeat,
      linear-gradient(180deg, #9f6a36 0%, #653817 48%, #3a1d0b 100%);
    background-blend-mode: screen, multiply, normal;
    box-shadow:
      inset 0 1px 0 rgba(255, 235, 190, 0.34),
      inset 0 -2px 5px rgba(24, 9, 2, 0.64),
      inset 0 0 0 1px rgba(66, 32, 10, 0.76),
      0 1px 0 rgba(255, 235, 190, 0.18),
      0 12px 24px -14px rgba(0, 0, 0, 0.7);
    min-width: 0;
    min-height: 0;
  }
  .module-frame::before,
  .module-frame::after {
    content: "";
    position: absolute;
    pointer-events: none;
  }
  .module-frame::before {
    inset: 6px;
    z-index: 0;
    border-radius: 13px;
    border: 1px solid rgba(20, 8, 2, 0.72);
    box-shadow:
      inset 0 2px 6px rgba(0, 0, 0, 0.64),
      inset 0 -1px 0 rgba(255, 224, 166, 0.16),
      0 1px 0 rgba(255, 229, 174, 0.26);
  }
  .module-frame::after {
    inset: 1px;
    z-index: -1;
    border-radius: inherit;
    background:
      linear-gradient(90deg, rgba(255, 230, 175, 0.22), transparent 11%, transparent 89%, rgba(20, 8, 2, 0.26)),
      linear-gradient(180deg, rgba(255, 240, 204, 0.18), transparent 28%, transparent 72%, rgba(20, 8, 2, 0.38));
    mix-blend-mode: overlay;
  }

  .turntable-slot {
    position: relative;
    flex: 1 1 0;
    z-index: 1;
    min-height: 0;
    overflow: visible;
  }
  .console-slot {
    container-type: size;
    flex: 0 0 var(--console-height);
    position: relative;
    z-index: 1;
    background: none;
    box-shadow: none;
    padding: 0;
    min-height: 0;
  }
  .frame-content {
    position: relative;
    z-index: 1;
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .frame-content :global(> *) {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .shelf-slot {
    grid-area: shelf;
    display: flex;
    flex-direction: column;
    padding: 12px;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .info-slot {
    grid-area: info;
    display: block;
    padding: 12px;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

</style>
