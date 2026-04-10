<script lang="ts">
  import {
    countAlbumTracks,
    getAlbumDuration,
    getSideDuration,
  } from "./model";
  import type { Album, LibraryAlbum } from "../types";

  export let album: LibraryAlbum | null = null;
  export let playbackAlbum: Album | null = null;
  export let albumTitleDraft = "";
  export let isDesktopApp = false;
  export let isBusy = false;
  export let loadError = "";
  export let pendingDeleteAlbumId: string | null = null;
  export let pendingDeleteAlbumTitle = "";
  export let onBack: () => void = () => {};
  export let onSaveTitle: () => void | Promise<void> = () => {};
  export let onImport: (
    kind: "files" | "folder",
    target: "new" | "current",
  ) => void | Promise<void> = () => {};
  export let onRequestDelete: () => void = () => {};
  export let onCancelDelete: () => void = () => {};
  export let onDelete: () => void | Promise<void> = () => {};
  export let onMoveTrack: (
    sideIndex: number,
    trackIndex: number,
    direction: "up" | "down" | "left" | "right",
  ) => void | Promise<void> = () => {};
  export let onRemoveTrack: (
    sideIndex: number,
    trackIndex: number,
  ) => void | Promise<void> = () => {};
  export let onCoverSelected: (event: Event) => void | Promise<void> = () => {};
  export let onClearCover: () => void | Promise<void> = () => {};
  export let onDiscArtSelected: (event: Event) => void | Promise<void> = () => {};
  export let onClearDiscArt: () => void | Promise<void> = () => {};

  let coverFileInput: HTMLInputElement | null = null;
  let discArtFileInput: HTMLInputElement | null = null;

  function getSideLabel(sideIndex: number): string {
    return String.fromCharCode(65 + sideIndex);
  }

  async function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    await onSaveTitle();
  }
</script>

<section class="ws" aria-label="专辑管理">
  <input bind:this={coverFileInput} class="sr-only" type="file" accept="image/*"
    on:change={(e) => void onCoverSelected(e)} />
  <input bind:this={discArtFileInput} class="sr-only" type="file" accept="image/*"
    on:change={(e) => void onDiscArtSelected(e)} />

  <div class="ws-scroll">

    <!-- 页头 -->
    <header class="ws-head">
      <div class="ws-head-top">
        <span class="eyebrow">Album Workshop</span>
        <button class="link-btn" type="button" on:click={onBack}>← 返回播放台</button>
      </div>
      <h1>专辑管理</h1>
      <div class="head-rule"></div>
    </header>

    {#if loadError}
      <p class="error-line">{loadError}</p>
    {/if}

    <!-- 导入 -->
    {#if isDesktopApp}
      <section class="ws-section">
        <div class="section-head">
          <span class="eyebrow">导入素材</span>
          <span class="section-rule"></span>
        </div>
        <p class="section-lead">新建专辑，自动按碟面时长分配 Side A / B / C / D。</p>
        <div class="import-grid">
          <button class="import-tile" type="button" disabled={isBusy}
            on:click={() => void onImport("files", "new")}>
            <span class="import-tile-label">选择文件</span>
            <span class="import-tile-hint">单个或多个音频文件</span>
            <span class="import-tile-arrow">→</span>
          </button>
          <button class="import-tile" type="button" disabled={isBusy}
            on:click={() => void onImport("folder", "new")}>
            <span class="import-tile-label">选择文件夹</span>
            <span class="import-tile-hint">导入整个文件夹</span>
            <span class="import-tile-arrow">→</span>
          </button>
        </div>
      </section>
    {/if}

    {#if album}

      <!-- 当前专辑 -->
      <section class="ws-section">
        <div class="section-head">
          <span class="eyebrow">当前专辑</span>
          <span class="section-rule"></span>
        </div>

        <div class="album-masthead">
          <!-- 封面（封套样式）-->
          <button class="jacket-btn" type="button" disabled={isBusy}
            title="更换封面" on:click={() => coverFileInput?.click()}>
            <span class="jacket">
              {#if album.coverUrl}
                <img class="jacket-art" src={album.coverUrl} alt="" />
              {:else}
                <span class="jacket-mono">{album.title.trim()[0] ?? "L"}</span>
              {/if}
              <span class="jacket-hover">更换</span>
            </span>
          </button>

          <div class="album-body">
            <div class="album-meta-row">
              {#if album.artist}<span class="album-artist">{album.artist}</span>{/if}
              <span class="stat-set">
                <span class="stat">{countAlbumTracks(album)}<em>首</em></span>
                <span class="stat-sep">·</span>
                <span class="stat">{album.sides.length}<em>面</em></span>
                <span class="stat-sep">·</span>
                <span class="stat">{Math.floor(getAlbumDuration(album) / 60)}<em>分钟</em></span>
              </span>
            </div>
            <h2 class="album-title">{album.title}</h2>

            <!-- 标题编辑 -->
            <div class="field-row">
              <label class="field-eyebrow" for="title-input">专辑名称</label>
              <div class="field-inline">
                <input id="title-input" class="title-input" bind:value={albumTitleDraft}
                  placeholder="专辑名称" on:keydown={handleTitleKeydown} />
                <button class="stamp-btn" type="button" disabled={isBusy}
                  on:click={() => void onSaveTitle()}>保存</button>
              </div>
            </div>

            <!-- 追加 -->
            {#if isDesktopApp}
              <div class="field-row">
                <span class="field-eyebrow">追加曲目</span>
                <div class="append-row">
                  <button class="stamp-btn" type="button" disabled={isBusy}
                    on:click={() => void onImport("files", "current")}>+ 文件</button>
                  <button class="stamp-btn" type="button" disabled={isBusy}
                    on:click={() => void onImport("folder", "current")}>+ 文件夹</button>
                </div>
              </div>
            {/if}
          </div>
        </div>
      </section>

      <!-- 封面与盘面 -->
      <section class="ws-section">
        <div class="section-head">
          <span class="eyebrow">唱片视觉</span>
          <span class="section-rule"></span>
        </div>

        <div class="art-grid">
          <!-- 专辑封面：封套样式 -->
          <div class="art-item">
            <button class="jacket-btn jacket-btn--large" type="button" disabled={isBusy}
              on:click={() => coverFileInput?.click()}>
              <span class="jacket">
                {#if album.coverUrl}
                  <img class="jacket-art" src={album.coverUrl} alt="" />
                {:else}
                  <span class="jacket-mono">{album.title.trim()[0] ?? "L"}</span>
                {/if}
                <span class="jacket-hover">更换封面</span>
              </span>
            </button>
            <div class="art-caption">
              <span>专辑封面</span>
              {#if album.coverUrl}
                <button class="link-btn danger-link" type="button" disabled={isBusy}
                  on:click={() => void onClearCover()}>移除</button>
              {/if}
            </div>
          </div>

          <!-- 盘面图：黑胶唱片样式 -->
          <div class="art-item">
            <button class="vinyl-btn" type="button" disabled={isBusy}
              on:click={() => discArtFileInput?.click()}>
              <span class="vinyl">
                <!-- 中央标签（artwork 区域）-->
                <span class="vinyl-label">
                  {#if album.discArtUrl || album.coverUrl}
                    <img class="vinyl-label-art"
                      src={album.discArtUrl ?? album.coverUrl} alt="" />
                  {:else}
                    <span class="vinyl-label-mono">{album.title.trim()[0] ?? "L"}</span>
                  {/if}
                </span>
                <!-- 主轴孔 -->
                <span class="vinyl-hole" aria-hidden="true"></span>
                <span class="vinyl-hover">更换盘面图</span>
              </span>
            </button>
            <div class="art-caption">
              <span>盘面图{#if !album.discArtUrl}&ensp;<span class="muted-tag">跟随封面</span>{/if}</span>
              {#if album.discArtUrl}
                <button class="link-btn danger-link" type="button" disabled={isBusy}
                  on:click={() => void onClearDiscArt()}>恢复跟随</button>
              {/if}
            </div>
          </div>
        </div>
      </section>

      <!-- 曲目编排 -->
      <section class="ws-section">
        <div class="section-head">
          <span class="eyebrow">曲目编排</span>
          <span class="section-rule"></span>
        </div>
        <p class="section-lead">悬停曲目以显示排序控制。</p>

        {#if album.sides.length === 0}
          <p class="empty-note">尚无曲目，请先导入音频文件。</p>
        {:else}
          <div class="sides">
            {#each album.sides as sideTracks, sideIndex}
              <div class="side">
                <div class="side-head">
                  <span class="side-letter">Side {getSideLabel(sideIndex)}</span>
                  <span class="side-count">{sideTracks.length} 首 · {Math.floor(getSideDuration(sideTracks) / 60)} 分钟</span>
                </div>
                <div class="track-table">
                  {#each sideTracks as track, trackIndex}
                    <div class="track-row">
                      <span class="track-n">{String(trackIndex + 1).padStart(2, "0")}</span>
                      <div class="track-info">
                        <span class="track-title">{track.title}</span>
                        <span class="track-path">{track.sourceDisplayPath}</span>
                      </div>
                      <div class="track-ops">
                        <span class="ops-group">
                          <button class="op-btn" type="button" disabled={isBusy} title="上移"
                            on:click={() => void onMoveTrack(sideIndex, trackIndex, "up")}>↑</button>
                          <button class="op-btn" type="button" disabled={isBusy} title="下移"
                            on:click={() => void onMoveTrack(sideIndex, trackIndex, "down")}>↓</button>
                        </span>
                        <span class="ops-sep"></span>
                        <span class="ops-group">
                          <button class="op-btn" type="button"
                            disabled={sideIndex === 0 || isBusy} title="移至上一面"
                            on:click={() => void onMoveTrack(sideIndex, trackIndex, "left")}>←</button>
                          <button class="op-btn" type="button" disabled={isBusy} title="移至下一面"
                            on:click={() => void onMoveTrack(sideIndex, trackIndex, "right")}>→</button>
                        </span>
                        <span class="ops-sep"></span>
                        <button class="op-btn op-remove" type="button" disabled={isBusy} title="移除"
                          on:click={() => void onRemoveTrack(sideIndex, trackIndex)}>×</button>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- 危险区域 -->
      <section class="ws-section danger-section">
        <div class="section-head">
          <span class="eyebrow danger-eyebrow">危险区域</span>
          <span class="section-rule danger-rule"></span>
        </div>
        <div class="danger-row">
          <p class="section-lead">删除后将清除专辑及其未被引用的曲目记录。</p>
          <button class="stamp-btn stamp-danger" type="button" disabled={isBusy}
            on:click={onRequestDelete}>删除当前专辑</button>
        </div>

        {#if pendingDeleteAlbumId === album.id}
          <div class="confirm-block" role="alert">
            <p>确认删除《{pendingDeleteAlbumTitle}》？此操作不可撤销。</p>
            <div class="confirm-acts">
              <button class="stamp-btn stamp-danger" type="button" disabled={isBusy}
                on:click={() => void onDelete()}>确认删除</button>
              <button class="link-btn" type="button" disabled={isBusy}
                on:click={onCancelDelete}>取消</button>
            </div>
          </div>
        {/if}
      </section>

    {:else}
      <section class="ws-section">
        <div class="section-head">
          <span class="eyebrow">当前状态</span>
          <span class="section-rule"></span>
        </div>
        <p class="section-lead">请先导入音频创建专辑，或在左侧曲库中选择现有专辑。</p>
      </section>
    {/if}

  </div>
</section>

<style>
  /* ── 骨架 ──────────────────────────────────────────────────── */
  .ws {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  .ws-scroll {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding-right: 10px;
    scrollbar-width: thin;
    scrollbar-color: rgba(126, 94, 47, 0.22) transparent;
  }

  .ws-scroll::-webkit-scrollbar { width: 5px; }
  .ws-scroll::-webkit-scrollbar-track { background: transparent; }
  .ws-scroll::-webkit-scrollbar-thumb {
    background: rgba(112, 79, 37, 0.2);
    border-radius: 2px;
  }

  /* ── 字型基础 ──────────────────────────────────────────────── */
  .eyebrow {
    font-family: "Courier New", monospace;
    font-size: calc(8px * var(--app-font-scale));
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #9a7040;
  }

  .link-btn {
    border: 0;
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: calc(9px * var(--app-font-scale));
    color: #7a5a28;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: rgba(122, 90, 40, 0.35);
    letter-spacing: 0.06em;
    transition: color 0.12s;
  }

  .link-btn:hover:not(:disabled) { color: #2b1702; }
  .link-btn:disabled { opacity: 0.38; cursor: default; }

  .danger-link { color: #8f2f22; text-decoration-color: rgba(143,47,34,0.3); }
  .danger-link:hover:not(:disabled) { color: #5a1a10; }

  /* 印章按钮 — 矩形框，无阴影无圆角 */
  .stamp-btn {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(102, 69, 28, 0.3);
    background: transparent;
    padding: 6px 13px;
    font-family: "Courier New", monospace;
    font-size: calc(8.5px * var(--app-font-scale));
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #4a2e0c;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    white-space: nowrap;
  }

  .stamp-btn:hover:not(:disabled) {
    background: rgba(102, 69, 28, 0.07);
    border-color: rgba(102, 69, 28, 0.55);
    color: #2b1702;
  }

  .stamp-btn:disabled { opacity: 0.35; cursor: default; }

  .stamp-danger {
    border-color: rgba(143, 47, 34, 0.35);
    color: #8f2f22;
  }

  .stamp-danger:hover:not(:disabled) {
    background: rgba(143, 47, 34, 0.06);
    border-color: rgba(143, 47, 34, 0.6);
    color: #5a1a10;
  }

  /* ── 页头 ──────────────────────────────────────────────────── */
  .ws-head {
    padding-bottom: 20px;
    margin-bottom: 28px;
  }

  .ws-head-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  h1 {
    font-size: calc(30px * var(--app-font-scale));
    font-weight: 800;
    color: #1e1005;
    line-height: 1;
    margin: 0 0 16px;
    letter-spacing: -0.01em;
  }

  .head-rule {
    height: 2px;
    background: #2b1905;
  }

  /* ── 分区 ──────────────────────────────────────────────────── */
  .ws-section {
    padding-bottom: 30px;
    margin-bottom: 2px;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .section-rule {
    flex: 1;
    height: 1px;
    background: rgba(102, 69, 28, 0.22);
  }

  .section-lead {
    font-size: calc(10px * var(--app-font-scale));
    color: #7a5a30;
    line-height: 1.65;
    margin: 0 0 16px;
  }

  /* ── 导入网格 ──────────────────────────────────────────────── */
  .import-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border: 1px solid rgba(102, 69, 28, 0.22);
  }

  .import-tile {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    grid-template-areas: "label arrow" "hint arrow";
    gap: 2px 12px;
    align-items: center;
    padding: 14px 16px;
    border: 0;
    border-right: 1px solid rgba(102, 69, 28, 0.22);
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }

  .import-tile:last-child { border-right: 0; }
  .import-tile:hover:not(:disabled) { background: rgba(102, 69, 28, 0.04); }
  .import-tile:disabled { opacity: 0.38; cursor: default; }

  .import-tile-label {
    grid-area: label;
    font-size: calc(11px * var(--app-font-scale));
    font-weight: 700;
    color: #2b1905;
    letter-spacing: 0.02em;
  }

  .import-tile-hint {
    grid-area: hint;
    font-size: calc(9px * var(--app-font-scale));
    color: #9a7040;
    font-family: "Courier New", monospace;
  }

  .import-tile-arrow {
    grid-area: arrow;
    font-size: calc(16px * var(--app-font-scale));
    color: rgba(102, 69, 28, 0.35);
    transition: transform 0.12s, color 0.12s;
    line-height: 1;
  }

  .import-tile:hover:not(:disabled) .import-tile-arrow {
    transform: translateX(3px);
    color: rgba(102, 69, 28, 0.7);
  }

  /* ── 专辑 masthead ────────────────────────────────────────── */
  .album-masthead {
    display: grid;
    grid-template-columns: 106px 1fr;
    gap: 22px;
    align-items: start;
  }

  /* ── 封套按钮（jacket-btn）── 与 SidebarCrate 一致的纸板质感 ── */
  .jacket-btn {
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    display: block;
    /* 宽度由父容器决定；large 变体撑满 art-item */
    width: 106px;
    flex-shrink: 0;
  }

  .jacket-btn--large {
    width: 100%;
  }

  .jacket-btn:disabled { cursor: default; }

  /* 封套本体 — 完整复刻 SidebarCrate 的 record__jacket */
  .jacket {
    display: block;
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 2px;
    overflow: hidden;
    background: linear-gradient(160deg, #ece1c5, #ddd1b0);
    box-shadow:
      inset 0 0 0 2px rgba(234, 222, 196, 0.5),
      0 0 0 1.5px rgba(72, 46, 14, 0.22),
      3px 0 0 rgba(58, 34, 10, 0.40),
      5px 1px 0 rgba(46, 26, 6, 0.22),
      0 3px 0 rgba(62, 38, 10, 0.40),
      0 5px 0 rgba(52, 30, 8, 0.26),
      0 7px 0 rgba(42, 24, 6, 0.16),
      0 12px 28px rgba(8, 4, 1, 0.35);
  }

  /* 顶部阴影条（模拟封套插入口） */
  .jacket::before {
    content: "";
    position: absolute;
    top: 0;
    left: 5px;
    right: 5px;
    height: 4px;
    background: linear-gradient(180deg, rgba(30, 16, 4, 0.18), transparent);
    border-radius: 0 0 2px 2px;
    pointer-events: none;
    z-index: 3;
  }

  /* 封面图：留 3px 纸框 */
  .jacket-art {
    position: absolute;
    inset: 3px;
    width: calc(100% - 6px);
    height: calc(100% - 6px);
    object-fit: cover;
    border-radius: 1px;
    display: block;
    z-index: 1;
  }

  /* 无封面时的首字母 */
  .jacket-mono {
    position: absolute;
    inset: 6px;
    display: grid;
    place-items: center;
    border-radius: 1px;
    background: linear-gradient(155deg, #e4d8bc, #cfc09a);
    font-size: calc(28px * var(--app-font-scale));
    font-weight: 800;
    letter-spacing: -0.03em;
    color: rgba(80, 52, 18, 0.32);
    z-index: 1;
  }

  /* 悬停遮罩 */
  .jacket-hover {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(20, 10, 2, 0.46);
    color: rgba(255, 240, 210, 0.92);
    font-family: "Courier New", monospace;
    font-size: calc(7.5px * var(--app-font-scale));
    letter-spacing: 0.22em;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 0.14s;
    z-index: 4;
  }

  .jacket-btn:hover:not(:disabled) .jacket-hover { opacity: 1; }

  /* ── 黑胶唱片预览（vinyl-btn）──────────────────────────────── */
  .vinyl-btn {
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    display: block;
    width: 100%;
  }

  .vinyl-btn:disabled { cursor: default; }

  /* 唱片圆盘：深色底 + 放射状纹路模拟黑胶槽 */
  .vinyl {
    display: block;
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 50%;
    overflow: hidden;
    background:
      /* 同心纹：模拟黑胶唱槽 */
      repeating-radial-gradient(
        circle at 50% 50%,
        rgba(255, 255, 255, 0.025) 0px,
        rgba(255, 255, 255, 0.025) 1px,
        transparent 1px,
        transparent 4px
      ),
      /* 径向高光，模拟黑胶光泽 */
      conic-gradient(
        from 0deg,
        rgba(60, 36, 12, 0.0) 0deg,
        rgba(255, 220, 160, 0.04) 45deg,
        rgba(60, 36, 12, 0.0) 90deg,
        rgba(255, 220, 160, 0.035) 180deg,
        rgba(60, 36, 12, 0.0) 270deg,
        rgba(255, 220, 160, 0.04) 315deg,
        rgba(60, 36, 12, 0.0) 360deg
      ),
      /* 黑胶基色 */
      radial-gradient(circle at 50% 42%, #2a1a0a, #0e0804 72%);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.06),
      0 8px 28px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 220, 140, 0.06);
  }

  /* 中央标签区（圆形 artwork）*/
  .vinyl-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40%;
    height: 40%;
    border-radius: 50%;
    overflow: hidden;
    background: linear-gradient(155deg, #e4d8bc, #cfc09a);
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.35),
      0 0 8px rgba(0, 0, 0, 0.4);
    z-index: 2;
  }

  .vinyl-label-art {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .vinyl-label-mono {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    font-size: calc(14px * var(--app-font-scale));
    font-weight: 800;
    letter-spacing: -0.02em;
    color: rgba(80, 52, 18, 0.38);
  }

  /* 主轴孔 */
  .vinyl-hole {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 4.5%;
    height: 4.5%;
    border-radius: 50%;
    background: #070402;
    box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.08);
    z-index: 3;
  }

  /* 悬停遮罩 */
  .vinyl-hover {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(10, 5, 1, 0.55);
    color: rgba(255, 240, 210, 0.9);
    font-family: "Courier New", monospace;
    font-size: calc(7.5px * var(--app-font-scale));
    letter-spacing: 0.22em;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 0.14s;
    border-radius: 50%;
    z-index: 5;
  }

  .vinyl-btn:hover:not(:disabled) .vinyl-hover { opacity: 1; }

  .album-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  .album-meta-row {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
  }

  .album-artist {
    font-size: calc(10px * var(--app-font-scale));
    color: #7a5a30;
    font-style: italic;
  }

  .stat-set {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-family: "Courier New", monospace;
  }

  .stat {
    font-size: calc(10px * var(--app-font-scale));
    color: #4a2e0c;
    font-weight: 700;
  }

  .stat em {
    font-style: normal;
    font-weight: 400;
    font-size: calc(8.5px * var(--app-font-scale));
    color: #9a7040;
    margin-left: 2px;
  }

  .stat-sep { color: rgba(102, 69, 28, 0.35); font-size: calc(10px * var(--app-font-scale)); }

  h2.album-title {
    font-size: calc(18px * var(--app-font-scale));
    font-weight: 800;
    color: #1e1005;
    line-height: 1.1;
    margin: 0;
    letter-spacing: -0.01em;
  }

  /* 字段行 */
  .field-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid rgba(102, 69, 28, 0.12);
  }

  .field-eyebrow {
    font-family: "Courier New", monospace;
    font-size: calc(7.5px * var(--app-font-scale));
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #9a7040;
  }

  .field-inline {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .title-input {
    flex: 1;
    min-width: 0;
    border: 0;
    border-bottom: 1px solid rgba(102, 69, 28, 0.25);
    padding: 6px 0 5px;
    background: transparent;
    color: #2b1905;
    font: inherit;
    font-size: calc(12px * var(--app-font-scale));
    transition: border-color 0.13s;
  }

  .title-input:focus {
    outline: none;
    border-bottom-color: rgba(102, 69, 28, 0.65);
  }

  .append-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* ── 封面/盘面 ────────────────────────────────────────────── */
  .art-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px 32px;
    align-items: start;
  }

  .art-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }


  .art-caption {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-family: "Courier New", monospace;
    font-size: calc(8px * var(--app-font-scale));
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #9a7040;
  }

  .muted-tag {
    font-size: calc(7px * var(--app-font-scale));
    color: #b89058;
    letter-spacing: 0.1em;
  }

  /* ── 曲目编排 ───────────────────────────────────────────────── */
  .sides { display: flex; flex-direction: column; gap: 24px; }

  .side { display: flex; flex-direction: column; gap: 0; }

  .side-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(102, 69, 28, 0.22);
    margin-bottom: 0;
  }

  .side-letter {
    font-family: "Courier New", monospace;
    font-size: calc(10px * var(--app-font-scale));
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #3a2005;
  }

  .side-count {
    font-family: "Courier New", monospace;
    font-size: calc(8.5px * var(--app-font-scale));
    color: #9a7040;
  }

  .track-table { display: flex; flex-direction: column; }

  .track-row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(102, 69, 28, 0.09);
    transition: background 0.1s;
  }

  .track-row:last-child { border-bottom: 0; }
  .track-row:hover { background: rgba(102, 69, 28, 0.03); }

  .track-n {
    font-family: "Courier New", monospace;
    font-size: calc(8.5px * var(--app-font-scale));
    color: rgba(102, 69, 28, 0.38);
    text-align: right;
    flex-shrink: 0;
    user-select: none;
  }

  .track-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }

  .track-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: calc(11px * var(--app-font-scale));
    color: #1e1005;
    font-weight: 500;
  }

  .track-path {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: "Courier New", monospace;
    font-size: calc(8px * var(--app-font-scale));
    color: rgba(102, 69, 28, 0.42);
  }

  /* 操作组 — 默认隐藏，hover 时显现 */
  .track-ops {
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .track-row:hover .track-ops { opacity: 1; }

  .ops-group { display: flex; gap: 0; }
  .ops-sep {
    width: 1px;
    height: 14px;
    background: rgba(102, 69, 28, 0.2);
    margin: 0 4px;
    align-self: center;
  }

  .op-btn {
    border: 0;
    background: transparent;
    padding: 0 5px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: calc(11px * var(--app-font-scale));
    color: rgba(102, 69, 28, 0.55);
    cursor: pointer;
    transition: color 0.1s;
    line-height: 1;
  }

  .op-btn:hover:not(:disabled) { color: #2b1702; }
  .op-btn:disabled { opacity: 0.2; cursor: default; }

  .op-remove {
    font-size: calc(13px * var(--app-font-scale));
    color: rgba(143, 47, 34, 0.5);
    border-left: 1px solid rgba(102, 69, 28, 0.15);
    padding-left: 8px;
    margin-left: 2px;
  }

  .op-remove:hover:not(:disabled) { color: #8f2f22; }

  .empty-note {
    font-family: "Courier New", monospace;
    font-size: calc(9px * var(--app-font-scale));
    color: #9a7040;
    letter-spacing: 0.08em;
    margin: 0;
    padding: 16px 0;
  }

  /* ── 危险区域 ───────────────────────────────────────────────── */
  .danger-eyebrow { color: rgba(143, 47, 34, 0.7); }
  .danger-rule { background: rgba(143, 47, 34, 0.18); }

  .danger-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }

  .danger-row .section-lead { margin: 0; }

  .confirm-block {
    margin-top: 14px;
    padding: 14px 16px;
    border: 1px solid rgba(143, 47, 34, 0.25);
    background: rgba(255, 247, 245, 0.7);
  }

  .confirm-block p {
    font-size: calc(10px * var(--app-font-scale));
    color: #6a2018;
    line-height: 1.6;
    margin: 0 0 12px;
  }

  .confirm-acts {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  /* 错误 */
  .error-line {
    font-size: calc(9.5px * var(--app-font-scale));
    color: #8b2d1f;
    padding: 10px 14px;
    border: 1px solid rgba(143, 47, 34, 0.25);
    margin-bottom: 14px;
    background: rgba(255, 245, 241, 0.8);
  }

  /* 无障碍隐藏 */
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border: 0;
  }

  /* ── 响应式 ─────────────────────────────────────────────────── */
  @media (max-width: 860px) {
    .album-masthead { grid-template-columns: 80px 1fr; gap: 14px; }
    .cover-thumb { width: 80px; }
    .art-grid { grid-template-columns: 1fr 1fr; }
  }

  @media (max-width: 620px) {
    .import-grid { grid-template-columns: 1fr; }
    .import-tile { border-right: 0; border-bottom: 1px solid rgba(102,69,28,0.22); }
    .import-tile:last-child { border-bottom: 0; }
    .art-grid { grid-template-columns: 1fr; }
    .album-masthead { grid-template-columns: 1fr; }
    .danger-row { flex-direction: column; align-items: flex-start; }
  }
</style>
