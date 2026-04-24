<script lang="ts">
  import {
    countAlbumTracks,
    getAlbumDuration,
    getSideDuration,
  } from "./model";
  import type { LibraryAlbum } from "../types";

  type WorkshopMode = "home" | "import" | "edit";

  export let album: LibraryAlbum | null = null;
  export let albums: LibraryAlbum[] = [];
  export let mode: WorkshopMode = "home";
  export let editingAlbumId: string | null = null;
  export let albumTitleDraft = "";
  export let isDesktopApp = false;
  export let isBusy = false;
  export let loadError = "";
  export let pendingDeleteAlbumId: string | null = null;
  export let pendingDeleteAlbumTitle = "";
  export let onModeChange: (mode: WorkshopMode) => void = () => {};
  export let onSelectAlbum: (albumId: string) => void = () => {};
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
  /** 当专辑分类发生变化时调用 */
  export let onCategoriesChange: (categories: string[]) => void | Promise<void> = () => {};
  /** 打开全局分类标签管理 */
  export let onManageCategories: () => void = () => {};
  /** 整个库里已有的所有分类名，用于自动补全建议 */
  export let availableCategories: string[] = [];

  let coverFileInput: HTMLInputElement | null = null;
  let discArtFileInput: HTMLInputElement | null = null;
  let categoryInput = '';
  let showSuggestions = false;

  $: currentCategories = album?.categories ?? [];
  $: suggestions = availableCategories
    .filter((c) => !currentCategories.includes(c) && c.toLowerCase().includes(categoryInput.toLowerCase()))
    .slice(0, 8);

  function addCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed || currentCategories.includes(trimmed)) {
      categoryInput = '';
      showSuggestions = false;
      return;
    }
    void onCategoriesChange([...currentCategories, trimmed]);
    categoryInput = '';
    showSuggestions = false;
  }

  function removeCategory(name: string) {
    void onCategoriesChange(currentCategories.filter((c) => c !== name));
  }

  function handleCategoryKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCategory(categoryInput);
    } else if (e.key === 'Escape') {
      showSuggestions = false;
    }
  }

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

    {#if mode !== "home"}
      <header class="ws-head">
        <div class="mode-tabs" role="tablist" aria-label="专辑管理模式">
          <button
            type="button"
            role="tab"
            aria-selected="false"
            on:click={() => onModeChange("home")}
          >管理首页</button>
          <button
            class:active={mode === "import"}
            type="button"
            role="tab"
            aria-selected={mode === "import"}
            on:click={() => onModeChange("import")}
          >制作新专辑</button>
          <button
            class:active={mode === "edit"}
            type="button"
            role="tab"
            aria-selected={mode === "edit"}
            disabled={albums.length === 0}
            on:click={() => onModeChange("edit")}
          >编辑现有专辑</button>
        </div>
      </header>
    {:else}
      <div class="ws-head-spacer" aria-hidden="true"></div>
    {/if}

    {#if loadError}
      <p class="error-line">{loadError}</p>
    {/if}

    {#if mode === "home"}
      <section class="manager-home" aria-label="管理专辑首页">
        <button class="manager-card manager-card--primary" type="button" on:click={() => onModeChange("import")}>
          <span class="manager-mark">NEW</span>
          <span class="manager-title">制作新专辑</span>
          <span class="manager-copy">导入音频文件或文件夹，自动整理曲面并生成可播放的黑胶专辑。</span>
          <span class="manager-action">开始制作 <span>→</span></span>
        </button>

        <button
          class="manager-card"
          type="button"
          disabled={albums.length === 0}
          on:click={() => onModeChange("edit")}
        >
          <span class="manager-mark">{albums.length} ALBUMS</span>
          <span class="manager-title">编辑现有专辑</span>
          <span class="manager-copy">调整专辑名称、分类、封面、盘面图和曲目顺序。</span>
          <span class="manager-action">{albums.length === 0 ? "暂无专辑" : "选择专辑"} <span>→</span></span>
        </button>

        <button
          class="manager-card manager-card--tags"
          type="button"
          on:click={onManageCategories}
        >
          <span class="manager-mark">{availableCategories.length} TAGS</span>
          <span class="manager-title">管理标签分类</span>
          <span class="manager-copy">重命名分类、删除分类，或从某个分类中移除不需要的专辑。</span>
          <span class="manager-action">打开标签管理 <span>→</span></span>
        </button>
      </section>

      {#if albums.length > 0}
        <section class="ws-section ws-section--compact">
          <div class="section-head">
            <span class="eyebrow">最近专辑</span>
            <span class="section-rule"></span>
          </div>
          <div class="album-switcher album-switcher--grid" aria-label="选择要编辑的专辑">
            {#each albums.slice(0, 6) as item}
              <button
                class:active={item.id === editingAlbumId}
                type="button"
                on:click={() => onSelectAlbum(item.id)}
              >
                <span class="switch-cover">
                  {#if item.coverUrl}
                    <img src={item.coverUrl} alt="" />
                  {:else}
                    <span>{item.title.trim()[0] ?? "L"}</span>
                  {/if}
                </span>
                <span class="switch-meta">
                  <strong>{item.title}</strong>
                  <em>{countAlbumTracks(item)} 首 · {item.sides.length} 面</em>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    {/if}

    <!-- 导入 -->
    {#if mode === "import"}
      <section class="ws-section">
        <div class="section-head">
          <span class="eyebrow">制作新专辑</span>
          <span class="section-rule"></span>
        </div>
        {#if isDesktopApp}
          <p class="section-lead">选择音频素材后会新建专辑，并自动按碟面时长分配 Side A / B / C / D。导入完成后直接进入编辑。</p>
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
        {:else}
          <p class="section-lead">桌面版本支持从本机导入音频文件。</p>
        {/if}
      </section>

      {#if albums.length > 0}
        <section class="ws-section">
          <div class="section-head">
            <span class="eyebrow">已有专辑</span>
            <span class="section-rule"></span>
          </div>
          <div class="album-switcher album-switcher--grid" aria-label="选择要编辑的专辑">
            {#each albums as item}
              <button
                class:active={item.id === editingAlbumId}
                type="button"
                on:click={() => onSelectAlbum(item.id)}
              >
                <span class="switch-cover">
                  {#if item.coverUrl}
                    <img src={item.coverUrl} alt="" />
                  {:else}
                    <span>{item.title.trim()[0] ?? "L"}</span>
                  {/if}
                </span>
                <span class="switch-meta">
                  <strong>{item.title}</strong>
                  <em>{countAlbumTracks(item)} 首 · {item.sides.length} 面</em>
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/if}
    {/if}

    {#if mode === "edit"}
      <section class="ws-section">
        <div class="section-head">
          <span class="eyebrow">编辑现有专辑</span>
          <span class="section-rule"></span>
        </div>
        {#if albums.length > 0}
          <div class="album-switcher album-switcher--grid" aria-label="切换正在编辑的专辑">
            {#each albums as item}
              <button
                class:active={item.id === editingAlbumId}
                type="button"
                on:click={() => onSelectAlbum(item.id)}
              >
                <span class="switch-cover">
                  {#if item.coverUrl}
                    <img src={item.coverUrl} alt="" />
                  {:else}
                    <span>{item.title.trim()[0] ?? "L"}</span>
                  {/if}
                </span>
                <span class="switch-meta">
                  <strong>{item.title}</strong>
                  <em>{countAlbumTracks(item)} 首 · {item.sides.length} 面</em>
                </span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="section-lead">还没有可编辑的专辑，请先导入音频创建专辑。</p>
        {/if}
      </section>
    {/if}

    {#if mode === "edit" && album}

      <!-- 当前专辑 -->
      <section class="ws-section">
        <div class="section-head">
          <span class="eyebrow">正在编辑</span>
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

            <!-- 分类标签 -->
            <div class="field-row">
              <div class="category-field-head">
                <span class="field-eyebrow">分类标签</span>
                <button class="link-btn" type="button" on:click={onManageCategories}>管理全部标签</button>
              </div>
              <div class="cat-editor">
                {#each currentCategories as cat}
                  <span class="cat-chip">
                    {cat}
                    <button class="cat-chip-remove" type="button" aria-label="移除 {cat}"
                      on:click={() => removeCategory(cat)}>✕</button>
                  </span>
                {/each}
                <div class="cat-input-wrap">
                  <input
                    class="cat-input"
                    type="text"
                    placeholder="输入分类后回车…"
                    maxlength="32"
                    bind:value={categoryInput}
                    on:keydown={handleCategoryKeydown}
                    on:focus={() => (showSuggestions = true)}
                    on:blur={() => setTimeout(() => (showSuggestions = false), 150)}
                  />
                  {#if showSuggestions && suggestions.length > 0}
                    <ul class="cat-suggestions">
                      {#each suggestions as s}
                        <li>
                          <button type="button" on:click={() => addCategory(s)}>{s}</button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
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
            on:click={onRequestDelete}>删除正在编辑的专辑</button>
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

    {:else if mode === "edit"}
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
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 16px;
    min-height: 42px;
    margin-bottom: 24px;
  }

  .ws-head-spacer {
    height: 42px;
    margin-bottom: 24px;
  }

  .mode-tabs {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(102, 69, 28, 0.26);
    background: rgba(255, 248, 235, 0.48);
  }

  .mode-tabs button {
    border: 0;
    border-right: 1px solid rgba(102, 69, 28, 0.2);
    background: transparent;
    padding: 7px 12px;
    color: #7a5a30;
    cursor: pointer;
    font-family: "Courier New", monospace;
    font-size: calc(8px * var(--app-font-scale));
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .mode-tabs button:last-child {
    border-right: 0;
  }

  .mode-tabs button.active {
    background: rgba(102, 69, 28, 0.1);
    color: #2b1905;
    font-weight: 700;
  }

  .mode-tabs button:disabled {
    opacity: 0.36;
    cursor: default;
  }

  /* ── 分区 ──────────────────────────────────────────────────── */
  .ws-section {
    padding-bottom: 30px;
    margin-bottom: 2px;
  }

  .ws-section--compact {
    padding-bottom: 10px;
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

  /* ── 管理首页 ──────────────────────────────────────────────── */
  .manager-home {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    margin-bottom: 28px;
  }

  .manager-card {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 12px;
    min-height: 220px;
    border: 1px solid rgba(102, 69, 28, 0.22);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(255, 250, 240, 0.82), rgba(239, 224, 194, 0.72)),
      linear-gradient(135deg, rgba(74, 46, 12, 0.08), transparent 58%);
    padding: 22px;
    color: #2b1905;
    cursor: pointer;
    text-align: left;
    transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease;
  }

  .manager-card:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: rgba(102, 69, 28, 0.5);
    background:
      linear-gradient(180deg, rgba(255, 251, 244, 0.94), rgba(238, 220, 184, 0.82)),
      linear-gradient(135deg, rgba(74, 46, 12, 0.1), transparent 58%);
  }

  .manager-card:disabled {
    cursor: default;
    opacity: 0.48;
  }

  .manager-card--primary {
    border-color: rgba(74, 46, 12, 0.42);
  }

  .manager-card--tags {
    min-height: 172px;
    grid-column: 1 / -1;
  }

  .manager-mark {
    width: fit-content;
    border-bottom: 1px solid rgba(102, 69, 28, 0.32);
    padding-bottom: 4px;
    font-family: "Courier New", monospace;
    font-size: calc(8px * var(--app-font-scale));
    letter-spacing: 0.16em;
    color: #9a7040;
  }

  .manager-title {
    font-size: calc(20px * var(--app-font-scale));
    font-weight: 800;
    line-height: 1.12;
    color: #1e1005;
  }

  .manager-copy {
    max-width: 28em;
    font-size: calc(10.5px * var(--app-font-scale));
    line-height: 1.7;
    color: #6b4a24;
  }

  .manager-action {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: "Courier New", monospace;
    font-size: calc(8.5px * var(--app-font-scale));
    letter-spacing: 0.16em;
    color: #4a2e0c;
    text-transform: uppercase;
  }

  .manager-action span {
    font-size: calc(15px * var(--app-font-scale));
    line-height: 1;
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

  .album-switcher {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(126, 94, 47, 0.24) transparent;
  }

  .album-switcher--grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    overflow: visible;
    padding-bottom: 0;
  }

  .album-switcher::-webkit-scrollbar {
    height: 5px;
  }

  .album-switcher::-webkit-scrollbar-track {
    background: transparent;
  }

  .album-switcher::-webkit-scrollbar-thumb {
    background: rgba(112, 79, 37, 0.2);
    border-radius: 2px;
  }

  .album-switcher button {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    min-width: 190px;
    border: 1px solid rgba(102, 69, 28, 0.2);
    background: transparent;
    padding: 8px;
    color: #2b1905;
    cursor: pointer;
    text-align: left;
  }

  .album-switcher--grid button {
    min-width: 0;
  }

  .album-switcher button:hover:not(.active) {
    background: rgba(102, 69, 28, 0.05);
  }

  .album-switcher button.active {
    background: rgba(102, 69, 28, 0.1);
    border-color: rgba(102, 69, 28, 0.45);
  }

  .switch-cover {
    display: grid;
    place-items: center;
    width: 42px;
    aspect-ratio: 1;
    overflow: hidden;
    background: linear-gradient(155deg, #e4d8bc, #cfc09a);
    box-shadow:
      inset 0 0 0 1px rgba(80, 52, 18, 0.18),
      2px 1px 0 rgba(58, 34, 10, 0.22);
  }

  .switch-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .switch-cover span {
    color: rgba(80, 52, 18, 0.42);
    font-weight: 800;
  }

  .switch-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .switch-meta strong {
    min-width: 0;
    overflow: hidden;
    color: #2b1905;
    font-size: calc(10.5px * var(--app-font-scale));
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .switch-meta em {
    color: #9a7040;
    font-family: "Courier New", monospace;
    font-size: calc(8px * var(--app-font-scale));
    font-style: normal;
    letter-spacing: 0.08em;
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

  .category-field-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    min-width: 0;
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

  /* ── 分类标签编辑器 ─────────────────────────────────────────── */
  .cat-editor {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: rgba(255, 248, 235, 0.65);
    border: 1px solid rgba(102, 69, 28, 0.25);
    border-radius: 8px;
    min-height: 38px;
  }
  .cat-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    background: linear-gradient(180deg, #d5a06b 0%, #b47f48 100%);
    border-radius: 999px;
    color: #3a2410;
    font-family: "Noto Serif SC", serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
  }
  .cat-chip-remove {
    background: none;
    border: none;
    padding: 0;
    margin-left: 2px;
    color: #5a3818;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.7;
  }
  .cat-chip-remove:hover { opacity: 1; }
  .cat-input-wrap {
    position: relative;
    flex: 1 1 120px;
    min-width: 100px;
  }
  .cat-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-family: "Noto Serif SC", serif;
    font-size: 13px;
    color: #4a3218;
    padding: 2px 4px;
  }
  .cat-input::placeholder { color: rgba(90, 58, 31, 0.4); }
  .cat-suggestions {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 160px;
    background: #fdf6e3;
    border: 1px solid rgba(102, 69, 28, 0.25);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
    list-style: none;
    padding: 4px;
    z-index: 10;
  }
  .cat-suggestions li button {
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    background: none;
    border: none;
    border-radius: 5px;
    font-family: "Noto Serif SC", serif;
    font-size: 13px;
    color: #4a3218;
    cursor: pointer;
  }
  .cat-suggestions li button:hover {
    background: rgba(201, 154, 91, 0.2);
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
    .manager-home { grid-template-columns: 1fr; }
    .album-masthead { grid-template-columns: 80px 1fr; gap: 14px; }
    .art-grid { grid-template-columns: 1fr 1fr; }
  }

  @media (max-width: 620px) {
    .ws-head { align-items: flex-start; flex-direction: column; }
    .mode-tabs { width: 100%; overflow-x: auto; }
    .mode-tabs button { flex: 1 0 auto; }
    .manager-card { min-height: 180px; padding: 18px; }
    .import-grid { grid-template-columns: 1fr; }
    .import-tile { border-right: 0; border-bottom: 1px solid rgba(102,69,28,0.22); }
    .import-tile:last-child { border-bottom: 0; }
    .art-grid { grid-template-columns: 1fr; }
    .album-masthead { grid-template-columns: 1fr; }
    .danger-row { flex-direction: column; align-items: flex-start; }
  }
</style>
