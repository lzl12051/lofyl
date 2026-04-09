<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { LibraryAlbum } from "../types";
  import { countAlbumTracks, libraryAlbumToPlaybackAlbum } from "./model";

  export let albums: LibraryAlbum[] = [];
  export let selectedAlbumId: string | null = null;
  export let open = false;
  export let onClose: () => void = () => {};
  export let onConfirmSelect: (albumId: string) => void = () => {};

  type DisplayAlbum = {
    album: LibraryAlbum;
    offset: number;   // 0 = focused, +1 = next, +2 = after that, -1 = already browsed
    absOffset: number;
    visibleIndex: number;
    visibleCount: number;
    discs: number;
    sides: number;
    trackCount: number;
    isFocused: boolean;
  };

  const WHEEL_STEP_COOLDOWN_MS = 360;
  const MAX_VISIBLE_SLEEVES = 9;

  let rootElement: HTMLDivElement | null = null;
  let quickFindInput: HTMLInputElement | null = null;
  let focusAlbumId: string | null = null;
  let isQuickFindVisible = false;
  let quickFindQuery = "";
  let lastWheelAt = 0;
  let shuffleOutId: string | null = null;
  let shuffleInId: string | null = null;
  let shuffleTimer: ReturnType<typeof setTimeout> | null = null;

  function normalizeText(value: string): string {
    return value.trim().toLowerCase();
  }

  function getAlbumMonogram(title: string): string {
    const trimmed = title.trim();
    return (trimmed[0] ?? "V").toUpperCase();
  }

  function resetBrowserState() {
    focusAlbumId = selectedAlbumId ?? albums[0]?.id ?? null;
    isQuickFindVisible = false;
    quickFindQuery = "";
  }

  async function focusDialog() {
    await tick();
    rootElement?.focus();
  }

  function moveFocus(delta: number) {
    if (filteredAlbums.length === 0) return;
    const currentIndex = focusedAlbumIndex === -1 ? 0 : focusedAlbumIndex;
    const nextIndex = Math.max(
      0,
      Math.min(filteredAlbums.length - 1, currentIndex + delta),
    );
    if (nextIndex === currentIndex) return;

    const prevId = focusAlbumId;
    const nextId = filteredAlbums[nextIndex]?.id ?? null;

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

  function focusFirst() {
    focusAlbumId = filteredAlbums[0]?.id ?? null;
  }

  function focusLast() {
    focusAlbumId = filteredAlbums[filteredAlbums.length - 1]?.id ?? null;
  }

  function confirmFocusedAlbum() {
    if (!focusAlbumId) return;
    onConfirmSelect(focusAlbumId);
  }

  function toggleQuickFind() {
    isQuickFindVisible = !isQuickFindVisible;
    if (!isQuickFindVisible) {
      quickFindQuery = "";
      void focusDialog();
      return;
    }
    void tick().then(() => {
      quickFindInput?.focus();
      quickFindInput?.select();
    });
  }

  function handleSleeveClick(albumId: string) {
    if (albumId === focusAlbumId) {
      onConfirmSelect(albumId);
      return;
    }
    focusAlbumId = albumId;
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === rootElement) {
      onClose();
    }
  }

  function handleWheel(event: WheelEvent) {
    if (filteredAlbums.length === 0 || Math.abs(event.deltaY) < 12) return;
    const now = performance.now();
    if (now - lastWheelAt < WHEEL_STEP_COOLDOWN_MS) return;
    lastWheelAt = now;
    moveFocus(event.deltaY > 0 ? 1 : -1);
  }

  function handleKeydown(event: KeyboardEvent) {
    const isQuickFindShortcut =
      (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";
    const isTypingTarget =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement;

    if (isQuickFindShortcut) {
      event.preventDefault();
      if (!isQuickFindVisible) toggleQuickFind();
      else quickFindInput?.focus();
      return;
    }

    if (isTypingTarget) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      return;
    }

    switch (event.key) {
      case "Escape":       event.preventDefault(); onClose(); return;
      case "ArrowDown":
      case "ArrowRight":
      case "PageDown":     event.preventDefault(); moveFocus(1); return;
      case "ArrowUp":
      case "ArrowLeft":
      case "PageUp":       event.preventDefault(); moveFocus(-1); return;
      case "Home":         event.preventDefault(); focusFirst(); return;
      case "End":          event.preventDefault(); focusLast(); return;
      case "Enter":        event.preventDefault(); confirmFocusedAlbum(); return;
      default:             return;
    }
  }

  // ─── 核心：唱片在纵深方向的位置计算 ───────────────────────────
  //
  // 视角：从略高于正前方俯视一个装满唱片的木箱。
  //   offset = 0  → 当前唱片"拔出"，朝向观看者，居中展示
  //   offset = 1  → 箱中下一张，稍小稍高
  //   offset = 2+ → 更深处，越来越小越来越高（Time Machine 渐远感）
  //   offset < 0  → 已翻过的唱片，落回箱底，透明消失
  //
  // translateZ  控制距离（越正=越近越大，越负=越远越小）
  // translateY  控制垂直偏移（往上=视觉上"深入箱内"）
  // rotateX     控制透视倾斜（轻微仰头/俯视感）
  // scale       叠加额外缩放，增强前后差异
  // opacity     近处清晰，远处渐隐
  //
  function getSleeveStyle(item: DisplayAlbum): string {
    const { offset } = item;

    // 已翻过的唱片：沉入箱底，淡出
    if (offset < 0) {
      return [
        "--tz:-380px", "--ty:-56px", "--rx:6deg", "--rz:0deg",
        "--sc:0.6", "--opacity:0", "--blur:4px",
        "z-index:1",
      ].join(";");
    }

    let tz: number, ty: number, rx: number, sc: number, opacity: number, zi: number;

    let rz: number;
    switch (offset) {
      case 0: // 正在翻看的唱片：拔出来，大，清晰
        tz = 170; ty = 0;    rx = -2;  rz = 0;   sc = 1;    opacity = 1; zi = 80; break;
      case 1: // 紧接着下一张：稍小，略高
        tz = 40;  ty = -28;  rx = 2;   rz = 1.0; sc = 0.91; opacity = 1; zi = 70; break;
      case 2:
        tz = -90; ty = -52;  rx = 5;   rz = 1.8; sc = 0.82; opacity = 1; zi = 60; break;
      case 3:
        tz = -200; ty = -70; rx = 8;   rz = 2.4; sc = 0.73; opacity = 1; zi = 50; break;
      case 4:
        tz = -290; ty = -84; rx = 11;  rz = 2.8; sc = 0.65; opacity = 1; zi = 40; break;
      default: // offset >= 5
        tz = -350; ty = -94; rx = 13;  rz = 3.0; sc = 0.58; opacity = 1; zi = 30;
    }

    return [
      `--tz:${tz}px`,
      `--ty:${ty}px`,
      `--rx:${rx}deg`,
      `--rz:${rz}deg`,
      `--sc:${sc}`,
      `--opacity:${opacity}`,
      "--blur:0px",
      `z-index:${zi}`,
    ].join(";");
  }

  $: normalizedQuery = normalizeText(quickFindQuery);
  $: filteredAlbums = albums.filter((album) => {
    if (!normalizedQuery) return true;
    const haystack = normalizeText(`${album.title} ${album.artist}`);
    return haystack.includes(normalizedQuery);
  });
  $: availableFocusIds = new Set(filteredAlbums.map((album) => album.id));
  $: if (filteredAlbums.length === 0) {
    focusAlbumId = null;
  } else if (!focusAlbumId || !availableFocusIds.has(focusAlbumId)) {
    focusAlbumId =
      (selectedAlbumId && availableFocusIds.has(selectedAlbumId)
        ? selectedAlbumId
        : filteredAlbums[0]?.id) ?? null;
  }
  $: focusedAlbumIndex = filteredAlbums.findIndex((a) => a.id === focusAlbumId);
  $: focusedAlbum = filteredAlbums.find((a) => a.id === focusAlbumId) ?? null;
  $: visibleRangeStart = (() => {
    if (filteredAlbums.length <= MAX_VISIBLE_SLEEVES || focusedAlbumIndex <= 0) return 0;
    const c = focusedAlbumIndex - Math.floor(MAX_VISIBLE_SLEEVES / 2);
    return Math.max(0, Math.min(filteredAlbums.length - MAX_VISIBLE_SLEEVES, c));
  })();
  $: visibleRangeEnd = Math.min(filteredAlbums.length, visibleRangeStart + MAX_VISIBLE_SLEEVES);
  $: visibleWindow = filteredAlbums.slice(visibleRangeStart, visibleRangeEnd);
  $: visibleAlbums = visibleWindow.map<DisplayAlbum>((album, visibleIndex) => {
    const index = visibleRangeStart + visibleIndex;
    const playbackAlbum = libraryAlbumToPlaybackAlbum(album);
    const offset = focusedAlbumIndex === -1 ? index : index - focusedAlbumIndex;
    return {
      album, offset,
      absOffset: Math.abs(offset),
      visibleIndex, visibleCount: visibleWindow.length,
      discs: playbackAlbum.discs,
      sides: playbackAlbum.sides.length,
      trackCount: countAlbumTracks(album),
      isFocused: album.id === focusAlbumId,
    };
  });

  onMount(() => {
    resetBrowserState();
    void focusDialog();
  });
</script>

<!-- ─────────────────────────────────────────────────────────────── -->

<div
  class="crate-browser"
  class:open
  bind:this={rootElement}
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-label="唱片箱浏览器"
  on:click={handleBackdropClick}
  on:keydown={handleKeydown}
>
  <section class="panel">

    <!-- 顶栏 -->
    <header class="panel__header">
      <div class="panel__title-wrap">
        <p class="panel__eyebrow">VINYL CRATE</p>
        <h2 class="panel__title">挑唱片</h2>
        <p class="panel__count">
          {albums.length} 张收藏{filteredAlbums.length !== albums.length
            ? `  ·  筛到 ${filteredAlbums.length} 张`
            : ""}
        </p>
      </div>
      <button class="panel__close" type="button" on:click={onClose}>关闭</button>
    </header>

    <!-- 唱片箱 -->
    <div class="scene">
      <div class="crate" on:wheel|preventDefault={handleWheel}>

        <!-- 3D 透视层：所有唱片在此空间内渲染 -->
        <div class="crate__stage">
          <div class="crate__depth">

            {#if visibleAlbums.length === 0}
              <div class="crate__empty">没找到匹配的专辑，换个关键词试试。</div>
            {:else}
              {#each visibleAlbums as item (item.album.id)}
                <button
                  class="sleeve"
                  class:sleeve--front={item.isFocused}
                  class:sleeve--shuffle-out={item.album.id === shuffleOutId}
                  class:sleeve--shuffle-in={item.album.id === shuffleInId}
                  type="button"
                  style={getSleeveStyle(item)}
                  aria-label="专辑 {item.album.title}"
                  aria-current={item.isFocused ? "true" : undefined}
                  on:click={() => handleSleeveClick(item.album.id)}
                >
                  <!-- 封套本体 -->
                  <span class="sleeve__jacket">

                    <!-- 封面图 / 占位首字母 -->
                    {#if item.album.coverUrl}
                      <img
                        class="sleeve__art"
                        src={item.album.coverUrl}
                        alt=""
                        draggable="false"
                      />
                    {:else}
                      <span class="sleeve__mono" aria-hidden="true">
                        {getAlbumMonogram(item.album.title)}
                      </span>
                    {/if}

                    <!-- 纸板纹理 -->
                    <span class="sleeve__paper" aria-hidden="true"></span>
                    <!-- 塑封高光 -->
                    <span class="sleeve__gloss" aria-hidden="true"></span>

                  </span>

                  <!-- 聚焦时：贴在封套下方的标签条 -->
                  {#if item.isFocused}
                    <span class="sleeve__label">
                      <span class="sleeve__label-title">{item.album.title}</span>
                      <span class="sleeve__label-meta">
                        {item.album.artist || "未署名艺人"}
                        <span class="sleeve__label-dot" aria-hidden="true"> · </span>
                        {item.discs} 张碟 · {item.sides} 面 · {item.trackCount} 首
                      </span>
                      <span class="sleeve__label-cta">再点一次，放上唱机</span>
                    </span>
                  {/if}

                </button>
              {/each}
            {/if}

          </div>
        </div>

        <!-- 木箱前板：z-index 高于所有唱片，遮住底部营造"插在箱里"的感觉 -->
        <div class="crate__front" aria-hidden="true">
          <div class="crate__front-grain"></div>
          <div class="crate__front-lip"></div>
        </div>

        <!-- 左右侧板 -->
        <div class="crate__side crate__side--l" aria-hidden="true"></div>
        <div class="crate__side crate__side--r" aria-hidden="true"></div>

        <!-- 箱底阴影 -->
        <div class="crate__floor" aria-hidden="true"></div>

        <!-- 翻页提示：左右箭头（非聚焦状态不占空间） -->
        {#if filteredAlbums.length > 1}
          <div class="crate__nav" aria-hidden="true">
            <button
              class="crate__nav-btn crate__nav-btn--prev"
              type="button"
              tabindex="-1"
              on:click|stopPropagation={() => moveFocus(-1)}
            >&#8249;</button>
            <div class="crate__nav-counter">
              {focusedAlbumIndex + 1} / {filteredAlbums.length}
            </div>
            <button
              class="crate__nav-btn crate__nav-btn--next"
              type="button"
              tabindex="-1"
              on:click|stopPropagation={() => moveFocus(1)}
            >&#8250;</button>
          </div>
        {/if}

      </div>
    </div>

    <!-- 底栏 -->
    <footer class="panel__footer">
      <div class="panel__actions">
        <button
          class="panel__btn panel__btn--ghost"
          type="button"
          on:click={toggleQuickFind}
          aria-expanded={isQuickFindVisible}
        >{isQuickFindVisible ? "收起" : "快速定位"}</button>

        {#if isQuickFindVisible}
          <label class="panel__search">
            <span class="panel__search-label">查找</span>
            <input
              bind:this={quickFindInput}
              bind:value={quickFindQuery}
              class="panel__search-input"
              type="text"
              placeholder="标题 / 艺人"
            />
          </label>
        {/if}

        <button
          class="panel__btn panel__btn--primary"
          type="button"
          disabled={!focusedAlbum}
          on:click={confirmFocusedAlbum}
        >放上唱机</button>
      </div>
    </footer>

  </section>
</div>

<!-- ─────────────────────────────────────────────────────────────── -->

<style>
  /* ═══════════════════════════════════════════════════════════════
     遮罩 + 面板
  ═══════════════════════════════════════════════════════════════ */

  .crate-browser {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    padding: 24px;
    background:
      radial-gradient(ellipse 90% 60% at 50% 0%, rgba(172, 122, 46, 0.1), transparent 58%),
      rgba(10, 6, 1, 0.68);
    backdrop-filter: blur(12px) saturate(0.65);
    outline: none;
  }

  .panel {
    width: min(1060px, 100%);
    height: min(760px, 100%);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 18px;
    padding: 30px 30px 22px;
    border-radius: 28px;
    background:
      linear-gradient(168deg, rgba(38, 22, 6, 0.97) 0%, rgba(14, 8, 2, 0.99) 100%),
      radial-gradient(circle at 20% 0%, rgba(162, 114, 44, 0.06), transparent 50%);
    box-shadow:
      0 0 0 1px rgba(180, 138, 68, 0.06),
      0 52px 120px rgba(3, 1, 0, 0.6),
      inset 0 1px 0 rgba(255, 236, 188, 0.05);
    color: #eddfc6;
  }

  /* ═══════════════════════════════════════════════════════════════
     顶栏
  ═══════════════════════════════════════════════════════════════ */

  .panel__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .panel__title-wrap {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .panel__eyebrow {
    margin: 0;
    font-family: "Courier New", monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(188, 152, 88, 0.44);
  }

  .panel__title {
    margin: 0;
    font-size: clamp(26px, 3.6vw, 44px);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.01em;
    color: #f2e6d0;
  }

  .panel__count {
    margin: 0;
    font-family: "Courier New", monospace;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(194, 162, 102, 0.4);
  }

  .panel__close {
    border: 0;
    background: transparent;
    padding: 2px 0;
    font-family: "Courier New", monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(214, 184, 128, 0.38);
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.18s ease;
  }

  .panel__close:hover { color: rgba(248, 232, 190, 0.82); }

  /* ═══════════════════════════════════════════════════════════════
     场景 + 木箱
  ═══════════════════════════════════════════════════════════════ */

  .scene {
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .crate {
    position: relative;
    width: 100%;
    max-width: 860px;
    height: min(100%, 460px);
    min-height: 380px;
    overflow: hidden;
    border-radius: 22px;
    /* 箱内壁：深色温暖木质底调 */
    background:
      linear-gradient(
        180deg,
        rgba(48, 28, 9, 0.72) 0%,
        rgba(32, 18, 5, 0.88) 50%,
        rgba(20, 11, 3, 0.96) 100%
      ),
      /* 竖向细木纹 */
      repeating-linear-gradient(
        90deg,
        rgba(120, 80, 32, 0.07) 0px, rgba(120, 80, 32, 0.07) 1px,
        transparent 1px, transparent 20px
      );
    box-shadow:
      inset 0 2px 0 rgba(255, 224, 162, 0.04),
      inset 0 -36px 56px rgba(8, 4, 1, 0.48),
      0 32px 80px rgba(3, 1, 0, 0.42);
  }

  /* ── 透视舞台 ──────────────────────────────────────────────── */
  /* 给整个 3D 场景提供视角（perspective）。
     perspective-origin 在略高于中心处，使远处唱片向上汇聚，
     营造出"往箱子深处望去"的感觉。                            */
  .crate__stage {
    position: absolute;
    inset: 0;
    perspective: 780px;
    perspective-origin: 50% 28%;
    overflow: hidden;
  }

  /* ── 3D 空间容器 ───────────────────────────────────────────── */
  .crate__depth {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
  }

  /* ═══════════════════════════════════════════════════════════════
     单张唱片封套
  ═══════════════════════════════════════════════════════════════ */

  /* 每张唱片的锚点在舞台中央略偏下（65% 是让聚焦唱片在前板上方显示）。
     transform 变量由 getSleeveStyle 注入：
       --tz  纵深（Z 轴），决定"拔出"还是"在箱内"
       --ty  垂直偏移，配合透视造出"往深处越来越高"的层叠感
       --rx  轻微 X 轴倾斜，强化立体感
       --sc  叠加缩放（perspective 投影之外的额外尺寸差异）
       --opacity 透明度
       --blur    远处轻微景深虚化                                  */
  .sleeve {
    position: absolute;
    left: 50%;
    top: 62%;
    width: 350px;
    height: 350px;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    /* 以底边中心为变换原点，使缩放/旋转从底部发生 */
    transform-origin: center bottom;
    transform:
      translateX(-50%)
      translateY(calc(-50% + var(--ty, 0px)))
      translateZ(var(--tz, 0px))
      rotateX(var(--rx, 0deg))
      rotateZ(var(--rz, 0deg))
      scale(var(--sc, 1));
    opacity: var(--opacity, 1);
    filter:
      blur(var(--blur, 0px))
      drop-shadow(0 18px 34px rgba(4, 2, 0, 0.42))
      drop-shadow(0 6px 10px rgba(4, 2, 0, 0.24));
    /* ─────────────────────────────────────────────────────────
       过渡曲线：
         - transform / opacity 用带弹性的出曲线，"拔出"时轻微弹跳
         - blur 单独较快淡入淡出                                 */
    transition:
      transform 0.44s cubic-bezier(0.22, 1.02, 0.36, 1),
      opacity   0.36s ease,
      filter    0.3s ease;
  }

  .sleeve:focus-visible { outline: none; }

  /* ── 洗牌动画 ──────────────────────────────────────────────── */
  @keyframes sleeve-shuffle {
    0% {
      transform: translateX(-50%) translateY(-50%)
        translateZ(170px) rotateX(-2deg) rotateZ(0deg) scale(1);
      opacity: 1;
    }
    20% {
      transform: translateX(-50%) translateY(calc(-50% - 96px))
        translateZ(214px) rotateX(-12deg) rotateZ(-5deg) scale(1.08);
      opacity: 1;
    }
    56% {
      transform: translateX(40%) translateY(calc(-50% + 44px))
        translateZ(-60px) rotateX(3deg) rotateZ(20deg) scale(0.74);
      opacity: 0.44;
    }
    100% {
      transform: translateX(-50%) translateY(calc(-50% - 56px))
        translateZ(-380px) rotateX(6deg) rotateZ(0deg) scale(0.6);
      opacity: 0;
    }
  }

  .sleeve--shuffle-out {
    animation: sleeve-shuffle 0.52s cubic-bezier(0.45, 0.05, 0.55, 0.95) forwards;
    transition: none !important;
    z-index: 85 !important;
  }

  .sleeve--shuffle-in {
    animation: sleeve-shuffle 0.52s cubic-bezier(0.45, 0.05, 0.55, 0.95) reverse forwards;
    transition: none !important;
    z-index: 85 !important;
  }

  /* 聚焦唱片：前板上方，过渡结束后额外点亮 */
  .sleeve--front {
    filter:
      blur(0px)
      drop-shadow(0 26px 48px rgba(4, 2, 0, 0.5))
      drop-shadow(0 8px 14px rgba(4, 2, 0, 0.3));
  }

  /* ── 封套外壳（纸板质感） ──────────────────────────────────── */
  .sleeve__jacket {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 5px;
    overflow: hidden;
    /* 奶油纸板色 */
    background: linear-gradient(170deg, #ece1c5 0%, #ddd1b0 100%);
    box-shadow:
      /* 纸框内白边（封套内页） */
      inset 0 0 0 7px rgba(236, 224, 198, 0.52),
      /* 外边缘阴影线 */
      0 0 0 1.5px rgba(80, 52, 18, 0.22),
      /* 右侧可见卡片厚度（叠放边缘） */
      4px 0 0 rgba(58, 34, 10, 0.38),
      7px 1px 0 rgba(44, 24, 6, 0.18),
      /* 底边厚度感（叠层） */
      0 4px 0 rgba(60, 36, 10, 0.38),
      0 7px 0 rgba(48, 28, 8, 0.22),
      0 9px 0 rgba(38, 20, 5, 0.12),
      /* 环境投影 */
      0 16px 36px rgba(6, 3, 0, 0.40);
  }

  /* 顶部插口细节（封套开口处的暗边） */
  .sleeve__jacket::before {
    content: "";
    position: absolute;
    top: 0;
    left: 6px;
    right: 6px;
    height: 4px;
    background: linear-gradient(180deg, rgba(40, 22, 6, 0.24), transparent);
    border-radius: 0 0 3px 3px;
    pointer-events: none;
    z-index: 3;
  }

  /* ── 封面图 ────────────────────────────────────────────────── */
  .sleeve__art {
    position: absolute;
    inset: 7px; /* 7px 纸框留白 */
    width: calc(100% - 14px);
    height: calc(100% - 14px);
    object-fit: cover;
    border-radius: 2px;
    display: block;
    user-select: none;
    z-index: 1;
  }

  /* 无封面时的首字母 */
  .sleeve__mono {
    position: absolute;
    inset: 7px;
    display: grid;
    place-items: center;
    border-radius: 2px;
    background: linear-gradient(160deg, #e6dac0, #d2c49a);
    font-size: clamp(60px, 8vw, 88px);
    font-weight: 800;
    letter-spacing: -0.04em;
    color: rgba(88, 58, 22, 0.36);
    user-select: none;
    z-index: 1;
  }

  /* 纸板纤维纹（横向）*/
  .sleeve__paper {
    position: absolute;
    inset: 0;
    z-index: 2;
    border-radius: inherit;
    pointer-events: none;
    background: repeating-linear-gradient(
      180deg,
      rgba(100, 72, 34, 0.032) 0px,
      rgba(100, 72, 34, 0.032) 1px,
      transparent 1px,
      transparent 5px
    );
  }

  /* 塑封高光（对角线反光）*/
  .sleeve__gloss {
    position: absolute;
    inset: 0;
    z-index: 4;
    border-radius: inherit;
    pointer-events: none;
    background:
      linear-gradient(
        144deg,
        rgba(255, 255, 255, 0.19) 0%,
        rgba(255, 255, 255, 0.05) 24%,
        transparent 44%
      ),
      linear-gradient(
        324deg,
        rgba(0, 0, 0, 0.06) 0%,
        transparent 36%
      );
  }

  /* ── 信息标签（聚焦唱片专属，贴在封套正下方）──────────────── */
  /* 模拟黑胶店里贴在封套外的价格 / 信息标签纸 */
  .sleeve__label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: absolute;
    /* 紧贴封套外边缘的下方 */
    top: calc(100% + 4px);
    left: -4px;
    right: -4px;
    padding: 11px 14px 10px;
    border-radius: 0 0 5px 5px;
    /* 米白纸张感 + 浅色横格线 */
    background:
      linear-gradient(180deg, rgba(252, 246, 233, 0.97), rgba(242, 232, 210, 0.95));
    background-image:
      linear-gradient(180deg, rgba(252, 246, 233, 0.97), rgba(242, 232, 210, 0.95)),
      repeating-linear-gradient(
        180deg,
        transparent 0px, transparent 17px,
        rgba(110, 82, 38, 0.07) 17px, rgba(110, 82, 38, 0.07) 18px
      );
    box-shadow:
      0 6px 20px rgba(24, 14, 3, 0.28),
      0 2px 5px rgba(24, 14, 3, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.5);
    color: #221206;
    /* 宽度超出封套 4px（左右各 2px），像贴纸略超出边缘 */
    z-index: 10;
    pointer-events: none; /* 标签本身不拦截点击 */
  }

  .sleeve__label-title {
    font-size: 16px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sleeve__label-meta {
    font-family: "Courier New", monospace;
    font-size: 9.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(72, 46, 14, 0.66);
  }

  .sleeve__label-dot { opacity: 0.4; }

  .sleeve__label-cta {
    margin-top: 2px;
    font-family: "Courier New", monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(148, 100, 32, 0.7);
  }

  /* ═══════════════════════════════════════════════════════════════
     木箱装饰（2D 层，覆盖在 3D 场景之上）
  ═══════════════════════════════════════════════════════════════ */

  /* 前板：遮住所有唱片的底部，制造"插在箱中"的感觉 */
  .crate__front {
    position: absolute;
    bottom: 0;
    left: 6px;
    right: 6px;
    height: 130px;
    z-index: 200; /* 必须高于所有唱片 */
    pointer-events: none;
    border-radius: 14px 14px 18px 18px;
    overflow: hidden;
  }

  /* 木板主体 */
  .crate__front::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(
        180deg,
        rgba(88, 55, 18, 0.94) 0%,
        rgba(64, 38, 10, 0.97) 42%,
        rgba(46, 27, 7, 1) 100%
      ),
      /* 竖向木纹 */
      repeating-linear-gradient(
        90deg,
        rgba(138, 96, 44, 0.1) 0px, rgba(138, 96, 44, 0.1) 1px,
        transparent 1px, transparent 24px
      );
    border-radius: inherit;
  }

  /* 横向木板纹（水平槽缝）*/
  .crate__front-grain {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      180deg,
      transparent 0px, transparent 30px,
      rgba(0, 0, 0, 0.07) 30px, rgba(0, 0, 0, 0.07) 31px
    );
    border-radius: inherit;
  }

  /* 顶边高光线（木板截面感）*/
  .crate__front-lip {
    position: absolute;
    top: 0;
    left: 20px;
    right: 20px;
    height: 1px;
    background: rgba(255, 216, 148, 0.09);
    border-radius: 1px;
  }

  /* 侧板 */
  .crate__side {
    position: absolute;
    top: 14px;
    bottom: 14px;
    width: 14px;
    border-radius: 8px;
    background: linear-gradient(180deg, rgba(58, 36, 12, 0.8), rgba(38, 22, 6, 0.96));
    pointer-events: none;
    z-index: 190;
  }
  .crate__side--l { left: 0; }
  .crate__side--r { right: 0; }

  /* 箱底深色阴影（营造纵深感）*/
  .crate__floor {
    position: absolute;
    bottom: 130px; /* 与前板顶部对齐 */
    left: 0;
    right: 0;
    height: 80px;
    background: linear-gradient(0deg, rgba(6, 3, 0, 0.38), transparent);
    pointer-events: none;
    z-index: 150;
  }

  /* ═══════════════════════════════════════════════════════════════
     翻页导航（前板上方的计数器 + 箭头）
  ═══════════════════════════════════════════════════════════════ */

  .crate__nav {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 250;
    display: flex;
    align-items: center;
    gap: 16px;
    pointer-events: all;
  }

  .crate__nav-btn {
    border: 0;
    background: transparent;
    color: rgba(222, 192, 136, 0.5);
    font-size: 26px;
    line-height: 1;
    padding: 0 6px;
    cursor: pointer;
    transition: color 0.16s ease, transform 0.16s ease;
    user-select: none;
  }

  .crate__nav-btn:hover {
    color: rgba(246, 224, 170, 0.88);
  }

  .crate__nav-btn--prev:hover { transform: translateX(-2px); }
  .crate__nav-btn--next:hover { transform: translateX(2px); }

  .crate__nav-counter {
    font-family: "Courier New", monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(210, 176, 112, 0.44);
    min-width: 52px;
    text-align: center;
  }

  /* 空结果 */
  .crate__empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 32px;
    text-align: center;
    font-size: 15px;
    line-height: 1.7;
    color: rgba(202, 172, 118, 0.56);
  }

  /* ═══════════════════════════════════════════════════════════════
     底栏
  ═══════════════════════════════════════════════════════════════ */

  .panel__footer {
    display: flex;
    justify-content: flex-end;
  }

  .panel__actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .panel__btn {
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: "Courier New", monospace;
    font-size: 10px;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    transition: color 0.18s ease;
  }

  .panel__btn--ghost {
    padding: 0;
    color: rgba(210, 180, 122, 0.42);
  }

  .panel__btn--ghost:hover { color: rgba(244, 222, 168, 0.8); }

  .panel__btn--primary {
    padding: 11px 22px;
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(236, 216, 172, 0.18), rgba(194, 162, 102, 0.12));
    box-shadow:
      inset 0 1px 0 rgba(255, 244, 214, 0.14),
      0 8px 18px rgba(0, 0, 0, 0.12);
    color: rgba(240, 222, 182, 0.88);
  }

  .panel__btn--primary:hover:not(:disabled) {
    color: #fff4e2;
    background:
      linear-gradient(180deg, rgba(248, 232, 188, 0.26), rgba(210, 178, 118, 0.18));
  }

  .panel__btn--primary:disabled {
    opacity: 0.32;
    cursor: default;
  }

  .panel__search {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    border-radius: 999px;
    background: rgba(226, 202, 154, 0.06);
    border: 1px solid rgba(218, 190, 136, 0.1);
  }

  .panel__search-label {
    font-family: "Courier New", monospace;
    font-size: 9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(198, 168, 108, 0.42);
    white-space: nowrap;
  }

  .panel__search-input {
    width: 160px;
    border: 0;
    background: transparent;
    color: #f0e2c6;
    font: inherit;
    font-size: 13px;
  }

  .panel__search-input::placeholder { color: rgba(212, 184, 128, 0.3); }
  .panel__search-input:focus { outline: none; }

  /* ═══════════════════════════════════════════════════════════════
     移动端适配
  ═══════════════════════════════════════════════════════════════ */

  @media (max-width: 840px) {
    .crate-browser { padding: 10px; }

    .panel {
      height: auto;
      min-height: calc(100dvh - 20px);
      padding: 20px 16px 16px;
      border-radius: 20px;
      gap: 14px;
    }

    /* 移动端：线性列表，关闭 3D 效果 */
    .crate {
      height: auto;
      min-height: 0;
      border-radius: 14px;
    }

    .crate__stage {
      perspective: none;
    }

    .crate__depth {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 18px 0 24px;
    }

    .sleeve {
      position: relative;
      left: auto;
      top: auto;
      width: min(100%, 260px);
      height: auto;
      aspect-ratio: 1;
      transform: none !important;
      opacity: 1 !important;
      filter: drop-shadow(0 10px 22px rgba(4, 2, 0, 0.32)) !important;
    }

    .sleeve__label {
      position: relative;
      top: auto;
      left: auto;
      right: auto;
      border-radius: 0 0 4px 4px;
    }

    .crate__front,
    .crate__side,
    .crate__floor,
    .crate__nav { display: none; }

    .panel__actions { flex-direction: column; align-items: stretch; }
    .panel__btn--primary { width: 100%; text-align: center; }
    .panel__search { width: 100%; justify-content: space-between; }
    .panel__search-input { width: 100%; min-width: 0; }
  }
</style>
