<script lang="ts">
  // 木柜外壳：左列（唱盘+控制台）/ 右列（信息）/ 底部全宽书架
</script>

<div class="cabinet-root">
  <div class="cabinet-shell"></div>
  <div class="inlay" aria-hidden="true"></div>

  <div class="grid">
    <div class="player-stack slot">
      <div class="turntable-slot">
        <slot name="turntable" />
      </div>
      <div class="console-slot">
        <slot name="console" />
      </div>
    </div>

    <div class="info-slot">
      <slot name="info" />
    </div>

    <div class="shelf-slot">
      <slot name="shelf" />
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
    --player-width: 867px;
    --console-height: 160px;
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
    mix-blend-mode: multiply;
    opacity: 0.85;
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
    padding: 18px;
    gap: 12px;
    min-width: 0;
    min-height: 0;
  }

  /* 凹陷槽位（木板上嵌入的"孔"） */
  .slot {
    position: relative;
    border-radius: 14px;
    background: linear-gradient(
      180deg,
      rgba(40, 22, 8, 0.55),
      rgba(40, 22, 8, 0.25)
    );
    box-shadow:
      inset 0 2px 4px rgba(0, 0, 0, 0.55),
      inset 0 -1px 0 rgba(255, 230, 190, 0.15),
      0 1px 0 rgba(255, 230, 190, 0.25);
    min-width: 0;
    min-height: 0;
  }

  .turntable-slot {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    overflow: visible;
  }
  .console-slot {
    container-type: size;
    flex: 0 0 var(--console-height);
    background: none;
    box-shadow: none;
    padding: 0;
    min-height: 0;
  }
  .shelf-slot {
    grid-area: shelf;
    display: flex;
    flex-direction: column;
    padding: 0;
    min-width: 0;
    min-height: 0;
    overflow: visible;
  }
  .info-slot {
    grid-area: info;
    display: block;
    min-width: 0;
    min-height: 0;
  }

  /* 底部 VINYL PLAYER 铜牌 */
  .cabinet-footer {
    position: absolute;
    left: 32px;
    right: 32px;
    bottom: 12px;
    height: var(--footer-height);
    z-index: 3;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .brand-plate {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 180px;
    height: 28px;
    padding: 0 32px;
    border-radius: 3px;
    background:
      linear-gradient(180deg, #e9c78a 0%, #b7874a 50%, #825c2a 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 244, 214, 0.6),
      inset 0 -1px 0 rgba(44, 22, 6, 0.5),
      0 0 0 1px rgba(40, 22, 6, 0.55),
      0 2px 4px rgba(0, 0, 0, 0.55);
    color: #1b0e03;
    font-family: "JetBrains Mono", "Courier New", monospace;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.44em;
    text-indent: 0.44em;
    text-shadow: 0 1px 0 rgba(255, 243, 210, 0.35);
  }
</style>
