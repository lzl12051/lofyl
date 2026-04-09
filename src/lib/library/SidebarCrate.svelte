<script lang="ts">
  import { onMount } from "svelte";
  import type { LibraryAlbum } from "../types";
  import { countAlbumTracks, libraryAlbumToPlaybackAlbum } from "./model";

  export let albums: LibraryAlbum[] = [];
  export let selectedAlbumId: string | null = null;
  export let onSelect: (albumId: string) => void = () => {};

  const MAX_VISIBLE = 7;
  const WHEEL_COOLDOWN_MS = 360;

  let focusAlbumId: string | null = null;
  let lastWheelAt = 0;
  let shuffleOutId: string | null = null;
  let shuffleInId: string | null = null;
  let shuffleTimer: ReturnType<typeof setTimeout> | null = null;

  // 外部 selectedAlbumId 变化时，把焦点同步过来
  // （比如 App 首次加载专辑）
  $: if (selectedAlbumId && focusAlbumId === null) {
    focusAlbumId = selectedAlbumId;
  }

  function getMonogram(title: string) {
    return (title.trim()[0] ?? "V").toUpperCase();
  }

  function moveFocus(delta: number) {
    if (albums.length === 0) return;
    const idx = albums.findIndex((a) => a.id === focusAlbumId);
    const cur = idx === -1 ? 0 : idx;
    const next = Math.max(0, Math.min(albums.length - 1, cur + delta));
    if (next === cur) return;

    const prevId = focusAlbumId;
    const nextId = albums[next]?.id ?? null;

    if (delta > 0) {
      shuffleOutId = prevId;
      shuffleInId = null;
    } else {
      shuffleOutId = null;
      shuffleInId = nextId;
    }

    focusAlbumId = nextId;

    if (shuffleTimer) clearTimeout(shuffleTimer);
    shuffleTimer = setTimeout(() => {
      shuffleOutId = null;
      shuffleInId = null;
    }, 540);
  }

  function handleWheel(e: WheelEvent) {
    if (Math.abs(e.deltaY) < 10) return;
    const now = performance.now();
    if (now - lastWheelAt < WHEEL_COOLDOWN_MS) return;
    lastWheelAt = now;
    moveFocus(e.deltaY > 0 ? 1 : -1);
  }

  function handleRecordClick(albumId: string) {
    if (albumId === focusAlbumId) {
      // 已聚焦的再点一次 → 选择（放到唱机上）
      onSelect(albumId);
    } else {
      // 点其他的 → 移焦
      focusAlbumId = albumId;
    }
  }

  // ── 位置计算（纵深方向）──────────────────────────────────────
  //
  // 目标视角：专辑保持竖插在盒子里，我们从上方向下看。
  //   - 单张封套要呈现“上大下小”
  //   - 越往后越高、越远，出现在当前封套上方
  //   - 已翻过的唱片沉回箱里并淡出
  //
  function getStyle(offset: number): string {
    if (offset < 0) {
      return "--tz:-160px;--ty:12px;--rx:-8deg;--rz:0deg;--sc:0.58;--op:0;z-index:1";
    }
    let tz: number, ty: number, rx: number, rz: number, sc: number, op: number, zi: number;
    switch (offset) {
      case 0:
        tz = 100; ty = -6;  rx = -14; rz = 0;   sc = 1;    op = 1; zi = 60; break;
      case 1:
        tz = 60;  ty = -22; rx = -11; rz = 1.2; sc = 0.92; op = 1; zi = 50; break;
      case 2:
        tz = 22;  ty = -36; rx = -9;  rz = 2.2; sc = 0.84; op = 1; zi = 40; break;
      case 3:
        tz = -14; ty = -49; rx = -7;  rz = 3.0; sc = 0.76; op = 1; zi = 30; break;
      case 4:
        tz = -44; ty = -59; rx = -5;  rz = 3.5; sc = 0.68; op = 1; zi = 20; break;
      default:
        tz = -68; ty = -67; rx = -4;  rz = 3.8; sc = 0.61; op = 1; zi = 10;
    }
    return `--tz:${tz}px;--ty:${ty}px;--rx:${rx}deg;--rz:${rz}deg;--sc:${sc};--op:${op};z-index:${zi}`;
  }

  // ── 可见窗口 ─────────────────────────────────────────────────
  $: focusedIdx = albums.findIndex((a) => a.id === focusAlbumId);
  $: focusedAlbum = albums[focusedIdx] ?? null;
  $: {
    // 如果 focusAlbumId 不在 albums 里（比如删了），重置到第一张
    if (focusAlbumId && !albums.find((a) => a.id === focusAlbumId)) {
      focusAlbumId = albums[0]?.id ?? null;
    }
  }
  $: windowStart = (() => {
    if (albums.length <= MAX_VISIBLE || focusedIdx <= 0) return 0;
    const c = focusedIdx - Math.floor(MAX_VISIBLE / 2);
    return Math.max(0, Math.min(albums.length - MAX_VISIBLE, c));
  })();
  $: windowedAlbums = albums
    .slice(windowStart, windowStart + MAX_VISIBLE)
    .map((album, vi) => {
      const globalIdx = windowStart + vi;
      const offset = focusedIdx === -1 ? globalIdx : globalIdx - focusedIdx;
      const playback = libraryAlbumToPlaybackAlbum(album);
      return {
        album,
        offset,
        isSelected: album.id === selectedAlbumId,
        isFocused: album.id === focusAlbumId,
        discs: playback.discs,
        sides: playback.sides.length,
        tracks: countAlbumTracks(album),
      };
    });

  onMount(() => {
    focusAlbumId = selectedAlbumId ?? albums[0]?.id ?? null;
  });
</script>

<!-- ── 小木箱 ──────────────────────────────────────────────── -->
<div class="crate" on:wheel|preventDefault={handleWheel}>
  <!-- 3D 舞台：透视容器 -->
  <div class="crate__stage">
    <div class="crate__depth">
      {#each windowedAlbums as item (item.album.id)}
        <button
          class="record"
          class:record--active={item.isSelected}
          class:record--shuffle-out={item.album.id === shuffleOutId}
          class:record--shuffle-in={item.album.id === shuffleInId}
          style={getStyle(item.offset)}
          type="button"
          aria-label="专辑 {item.album.title}"
          aria-current={item.isFocused ? "true" : undefined}
          on:click={() => handleRecordClick(item.album.id)}
        >
          <span class="record__jacket">
            {#if item.album.coverUrl}
              <img
                class="record__art"
                src={item.album.coverUrl}
                alt=""
                draggable="false"
              />
            {:else}
              <span class="record__mono" aria-hidden="true"
                >{getMonogram(item.album.title)}</span
              >
            {/if}
            <span class="record__sheen" aria-hidden="true"></span>
            <!-- 正在播放的那张：亮点指示器 -->
            {#if item.isSelected}
              <span
                class="record__playing-dot"
                aria-label="正在播放"
                title="正在播放"
              ></span>
            {/if}
          </span>
        </button>
      {/each}
    </div>
  </div>

  <!-- 木箱前板：遮住唱片底部 + 导航控件 -->
  <div class="crate__front" aria-hidden="true">
    <div class="crate__front-grain"></div>
  </div>

  <!-- 前板导航（放在前板之上，比前板 z-index 更高） -->
  <div class="crate__nav">
    <button
      class="crate__nav-btn"
      type="button"
      disabled={focusedIdx <= 0}
      on:click={() => moveFocus(-1)}
      aria-label="上一张">&#8249;</button
    >

    <div class="crate__nav-info">
      {#if focusedAlbum}
        <span class="crate__nav-title">{focusedAlbum.title}</span>
        <span class="crate__nav-count">{focusedIdx + 1} / {albums.length}</span>
      {:else}
        <span class="crate__nav-count">暂无收藏</span>
      {/if}
    </div>

    <button
      class="crate__nav-btn"
      type="button"
      disabled={focusedIdx >= albums.length - 1}
      on:click={() => moveFocus(1)}
      aria-label="下一张">&#8250;</button
    >
  </div>

  <!-- 侧板 -->
  <div class="crate__wall crate__wall--l" aria-hidden="true"></div>
  <div class="crate__wall crate__wall--r" aria-hidden="true"></div>
</div>

<!-- 聚焦专辑信息（箱子外，标签纸风格） -->
{#if focusedAlbum}
  <div class="crate-info">
    <div class="crate-info__title">{focusedAlbum.title}</div>
    <div class="crate-info__meta">
      {focusedAlbum.artist || "未署名艺人"}
      {#if focusedAlbum.id !== selectedAlbumId}
        <button
          class="crate-info__select-btn"
          type="button"
          on:click={() => onSelect(focusedAlbum.id)}>放上唱机</button
        >
      {:else}
        <span class="crate-info__playing">· 正在播放</span>
      {/if}
    </div>
  </div>
{/if}

<!-- ─────────────────────────────────────────────────────────── -->

<style>
  /* ── 木箱容器 ──────────────────────────────────────────────── */
  .crate {
    position: relative;
    width: 100%;
    height: 316px;
    overflow: hidden;
    border-radius: 16px;
    /* 箱内壁底色：深木调 */
    background: linear-gradient(
        180deg,
        rgba(46, 26, 8, 0.78) 0%,
        rgba(28, 15, 4, 0.92) 60%,
        rgba(18, 9, 2, 0.97) 100%
      ),
      repeating-linear-gradient(
        90deg,
        rgba(110, 72, 26, 0.08) 0px,
        rgba(110, 72, 26, 0.08) 1px,
        transparent 1px,
        transparent 18px
      );
    box-shadow:
      inset 0 1px 0 rgba(255, 222, 160, 0.05),
      inset 0 -28px 44px rgba(6, 3, 0, 0.46),
      0 6px 20px rgba(0, 0, 0, 0.2),
      0 2px 4px rgba(0, 0, 0, 0.14);
    cursor: default;
    user-select: none;
  }

  /* ── 透视层 ────────────────────────────────────────────────── */
  /*
   * 视点回到画面上方，让远处封套向上汇聚，
   * 这样其他专辑会自然堆在当前专辑上方。
   * “上大下小”主要交给每张封套自身的 rotateX。
   */
  .crate__stage {
    position: absolute;
    inset: 0;
    perspective: 520px;
    perspective-origin: 50% 15%;
    overflow: hidden;
  }

  /* 不再整体倾斜整个箱内空间，保持唱片“竖着插在盒里”的姿态。 */
  .crate__depth {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
  }

  /* ── 单张唱片 ──────────────────────────────────────────────── */
  /*
   * 锚点放在底边附近，让封套像是从箱子里竖着伸出来；
   * rotateX 为负时，上沿会更靠近观察者，形成“上大下小”。
   * 封面设为 154×154px，与木箱宽度（减去内边距）契合。
   */
  .record {
    position: absolute;
    left: 50%;
    top: 45%;
    width: 200px;
    height: 200px;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    transform-origin: center bottom;
    transform: translateX(-50%) translateY(calc(-50% + var(--ty, 0px)))
      translateZ(var(--tz, 0px)) rotateX(var(--rx, 0deg)) rotateZ(var(--rz, 0deg)) scale(var(--sc, 1));
    opacity: var(--op, 1);
    transition:
      transform 0.42s cubic-bezier(0.22, 1.02, 0.36, 1),
      opacity 0.34s ease;
  }

  /* ── 洗牌动画 ──────────────────────────────────────────────── */
  /*
   * 前进：顶牌弹起 → 弧形飞出 → 插入底部消失
   * 后退：反向播放（从底部弧形飞出到顶部落下）
   */
  @keyframes card-shuffle {
    0% {
      transform: translateX(-50%) translateY(calc(-50% - 6px))
        translateZ(100px) rotateX(-14deg) rotateZ(0deg) scale(1);
      opacity: 1;
    }
    20% {
      transform: translateX(-50%) translateY(calc(-50% - 78px))
        translateZ(138px) rotateX(-24deg) rotateZ(-5deg) scale(1.08);
      opacity: 1;
    }
    56% {
      transform: translateX(36%) translateY(calc(-50% + 36px))
        translateZ(-18px) rotateX(-5deg) rotateZ(20deg) scale(0.76);
      opacity: 0.44;
    }
    100% {
      transform: translateX(-50%) translateY(calc(-50% + 12px))
        translateZ(-160px) rotateX(-8deg) rotateZ(0deg) scale(0.58);
      opacity: 0;
    }
  }

  .record--shuffle-out {
    animation: card-shuffle 0.50s cubic-bezier(0.45, 0.05, 0.55, 0.95) forwards;
    transition: none !important;
    z-index: 65 !important;
  }

  .record--shuffle-in {
    animation: card-shuffle 0.50s cubic-bezier(0.45, 0.05, 0.55, 0.95) reverse forwards;
    transition: none !important;
    z-index: 65 !important;
  }

  .record:focus-visible {
    outline: none;
  }

  /* 封套外壳：纸板质感，box-shadow 叠层模拟纸板厚度 */
  .record__jacket {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 2px;
    overflow: hidden;
    background: linear-gradient(160deg, #ece1c5, #ddd1b0);
    box-shadow:
      /* 内侧纸框留白 */
      inset 0 0 0 2px rgba(234, 222, 196, 0.5),
      /* 外边缘 */
      0 0 0 1.5px rgba(72, 46, 14, 0.22),
      /* 右侧卡片厚度（可见边缘，模拟多张叠放） */
      3px 0 0 rgba(58, 34, 10, 0.40),
      5px 1px 0 rgba(46, 26, 6, 0.22),
      /* 底部纸板厚度（叠层） */
      0 3px 0 rgba(62, 38, 10, 0.40),
      0 5px 0 rgba(52, 30, 8, 0.26),
      0 7px 0 rgba(42, 24, 6, 0.16),
      /* 环境投影 */
      0 12px 28px rgba(8, 4, 1, 0.46);
  }

  .record__jacket::before {
    content: "";
    position: absolute;
    top: 0;
    left: 5px;
    right: 5px;
    height: 4px;
    background: linear-gradient(180deg, rgba(30, 16, 4, 0.2), transparent);
    border-radius: 0 0 2px 2px;
    pointer-events: none;
    z-index: 3;
  }

  /* 封面图：铺满封套（仅保留极细纸框）*/
  .record__art {
    position: absolute;
    inset: 3px;
    width: calc(100% - 6px);
    height: calc(100% - 6px);
    object-fit: cover;
    border-radius: 2px;
    display: block;
    user-select: none;
    z-index: 1;
  }

  /* 无封面首字母 */
  .record__mono {
    position: absolute;
    inset: 6px;
    display: grid;
    place-items: center;
    border-radius: 2px;
    background: linear-gradient(155deg, #e4d8bc, #cfc09a);
    font-size: 52px;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: rgba(80, 52, 18, 0.32);
    user-select: none;
    z-index: 1;
  }

  /* 正在播放的点（右上角橙色小点） */
  .record__playing-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #e8a244;
    box-shadow: 0 0 5px rgba(232, 162, 68, 0.6);
    z-index: 5;
    animation: pulse 2.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.72;
      transform: scale(0.84);
    }
  }

  /* 正在播放的那张：琥珀色外描边 */
  .record--active .record__jacket {
    box-shadow:
      inset 0 0 0 6px rgba(234, 222, 196, 0.5),
      0 0 0 2px rgba(210, 152, 48, 0.62),
      0 0 0 1.5px rgba(72, 46, 14, 0.22),
      3px 0 0 rgba(58, 34, 10, 0.40),
      5px 1px 0 rgba(46, 26, 6, 0.22),
      0 3px 0 rgba(62, 38, 10, 0.40),
      0 5px 0 rgba(52, 30, 8, 0.26),
      0 7px 0 rgba(42, 24, 6, 0.16),
      0 12px 28px rgba(8, 4, 1, 0.46);
  }

  /* ── 木箱前板 ──────────────────────────────────────────────── */
  /* 高度 32px ≈ 154px × 20%，仅遮住聚焦唱片底部约 20% */
  .crate__front {
    position: absolute;
    bottom: 0;
    left: 4px;
    right: 4px;
    height: 32px;
    z-index: 100;
    border-radius: 10px 10px 13px 13px;
    overflow: hidden;
    pointer-events: none;
    background: linear-gradient(
        180deg,
        rgba(84, 52, 16, 0.94) 0%,
        rgba(60, 36, 10, 0.97) 40%,
        rgba(44, 25, 7, 1) 100%
      ),
      repeating-linear-gradient(
        90deg,
        rgba(132, 92, 40, 0.1) 0px,
        rgba(132, 92, 40, 0.1) 1px,
        transparent 1px,
        transparent 22px
      );
  }

  .crate__front::before {
    content: "";
    position: absolute;
    top: 0;
    left: 12px;
    right: 12px;
    height: 1px;
    background: rgba(255, 214, 140, 0.09);
  }

  .crate__front-grain {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      180deg,
      transparent 0px,
      transparent 10px,
      rgba(0, 0, 0, 0.06) 10px,
      rgba(0, 0, 0, 0.06) 11px
    );
  }

  /* ── 前板导航（z-index 高于前板）──────────────────────────── */
  .crate__nav {
    position: absolute;
    bottom: 0;
    left: 4px;
    right: 4px;
    height: 32px;
    z-index: 110;
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0 4px;
  }

  .crate__nav-btn {
    border: 0;
    background: transparent;
    color: rgba(220, 186, 120, 0.5);
    font-size: 18px;
    line-height: 1;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s ease;
    user-select: none;
  }

  .crate__nav-btn:hover:not(:disabled) {
    color: rgba(248, 222, 158, 0.9);
  }

  .crate__nav-btn:disabled {
    opacity: 0.2;
    cursor: default;
  }

  .crate__nav-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: center;
    text-align: center;
    overflow: hidden;
  }

  .crate__nav-title {
    font-size: 10px;
    font-weight: 600;
    color: rgba(238, 210, 158, 0.82);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    line-height: 1.2;
  }

  .crate__nav-count {
    font-family: "Courier New", monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    color: rgba(190, 154, 90, 0.5);
    text-transform: uppercase;
  }

  /* ── 侧板 ──────────────────────────────────────────────────── */
  .crate__wall {
    position: absolute;
    top: 10px;
    bottom: 10px;
    width: 10px;
    border-radius: 6px;
    background: linear-gradient(
      180deg,
      rgba(54, 33, 10, 0.82),
      rgba(36, 21, 5, 0.96)
    );
    z-index: 90;
    pointer-events: none;
  }
  .crate__wall--l {
    left: 0;
  }
  .crate__wall--r {
    right: 0;
  }

  /* ── 箱外信息标签 ──────────────────────────────────────────── */
  .crate-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 2px 4px;
    min-width: 0;
  }

  .crate-info__title {
    font-size: calc(11px * var(--app-font-scale, 1));
    font-weight: 700;
    color: #2a1707;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
  }

  .crate-info__meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: calc(9.5px * var(--app-font-scale, 1));
    color: #6b4e26;
    font-family: "Courier New", monospace;
    letter-spacing: 0.04em;
    flex-wrap: wrap;
  }

  .crate-info__playing {
    color: #a07032;
  }

  .crate-info__select-btn {
    border: 0;
    background: transparent;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    color: #5b3a12;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: rgba(91, 58, 18, 0.36);
    transition: color 0.14s ease;
  }

  .crate-info__select-btn:hover {
    color: #2b1905;
  }
</style>
