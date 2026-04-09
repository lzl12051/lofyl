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

<section class="workshop-page" aria-label="制作专辑">
  <input
    bind:this={coverFileInput}
    class="visually-hidden-input"
    type="file"
    accept="image/*"
    on:change={(event) => void onCoverSelected(event)}
  />
  <input
    bind:this={discArtFileInput}
    class="visually-hidden-input"
    type="file"
    accept="image/*"
    on:change={(event) => void onDiscArtSelected(event)}
  />

  <div class="workshop-scroll">
    <header class="workshop-hero">
      <div class="hero-copy">
        <div class="hero-kicker">Album Workshop</div>
        <h1>制作专辑</h1>
        <p>在此完成专辑导入、信息维护与曲目编排。</p>
      </div>

      <button class="hero-back" type="button" on:click={onBack}>
        返回播放台
      </button>
    </header>

    {#if loadError}
      <p class="error-banner">{loadError}</p>
    {/if}

    <section class="workshop-card import-card">
      <div class="card-head">
        <div>
          <div class="section-label">开始制作</div>
          <h2>导入新的专辑素材</h2>
        </div>
        <p class="card-copy">创建新专辑，并按碟面时长自动分配 Side A / B / C / D。</p>
      </div>

      {#if isDesktopApp}
        <div class="action-row">
          <button
            class="action-pill"
            type="button"
            disabled={isBusy}
            on:click={() => void onImport("files", "new")}
          >
            导入文件
          </button>
          <button
            class="action-pill"
            type="button"
            disabled={isBusy}
            on:click={() => void onImport("folder", "new")}
          >
            导入文件夹
          </button>
        </div>
      {:else}
        <p class="card-copy">当前环境不支持本地文件导入。</p>
      {/if}
    </section>

    {#if album}
      <section class="workshop-grid">
        <article class="workshop-card album-card">
          <div class="card-head">
            <div>
              <div class="section-label">当前专辑</div>
              <h2>{album.title}</h2>
            </div>
            <div class="album-badge">
              {playbackAlbum?.discs ?? Math.ceil(album.sides.length / 2)} 张碟
            </div>
          </div>

          <div class="album-summary">
            <div>
              <span class="summary-label">艺术家</span>
              <strong>{album.artist || "未填写"}</strong>
            </div>
            <div>
              <span class="summary-label">盘面</span>
              <strong>{album.sides.length} 面</strong>
            </div>
            <div>
              <span class="summary-label">曲目</span>
              <strong>{countAlbumTracks(album)} 首</strong>
            </div>
            <div>
              <span class="summary-label">时长</span>
              <strong>{Math.floor(getAlbumDuration(album) / 60)} 分钟</strong>
            </div>
          </div>

          {#if isDesktopApp}
            <div class="subsection">
              <div class="subsection-head">
                <div class="section-label">追加素材</div>
                <p>向当前专辑追加音频文件。</p>
              </div>

              <div class="action-row">
                <button
                  class="action-pill"
                  type="button"
                  disabled={isBusy}
                  on:click={() => void onImport("files", "current")}
                >
                  追加文件
                </button>
                <button
                  class="action-pill"
                  type="button"
                  disabled={isBusy}
                  on:click={() => void onImport("folder", "current")}
                >
                  追加文件夹
                </button>
              </div>
            </div>
          {/if}

          <div class="subsection">
            <div class="subsection-head">
              <div class="section-label">标题</div>
              <p>修改后的标题会同步到曲库与播放界面。</p>
            </div>
            <div class="title-editor-field">
              <input
                class="title-input"
                bind:value={albumTitleDraft}
                placeholder="专辑名称"
                on:keydown={handleTitleKeydown}
              />
              <button
                class="action-pill compact"
                type="button"
                disabled={isBusy}
                on:click={() => void onSaveTitle()}
              >
                保存标题
              </button>
            </div>
          </div>
        </article>

        <article class="workshop-card cover-card">
          <div class="card-head">
            <div>
              <div class="section-label">封面</div>
              <h2>唱片视觉</h2>
            </div>
            <p class="card-copy">封面和盘面可分别设置。未单独设置盘面图时，会默认沿用专辑封面。</p>
          </div>

          <div class="cover-layout">
            <div class="cover-preview-shell">
              {#if album.coverUrl}
                <img
                  class="cover-preview-image"
                  src={album.coverUrl}
                  alt={`《${album.title}》封面`}
                />
              {:else}
                <div class="cover-preview-empty">
                  <span>{album.title.trim()[0] ?? "L"}</span>
                </div>
              {/if}
            </div>

            <div class="cover-copy">
              <p>建议使用正方形图片。封面会同步到曲库列表、播放界面与默认盘面图。</p>
              <div class="action-row">
                <button
                  class="action-pill"
                  type="button"
                  disabled={isBusy}
                  on:click={() => coverFileInput?.click()}
                >
                  选择图片
                </button>
                <button
                  class="action-pill muted"
                  type="button"
                  disabled={!album.coverUrl || isBusy}
                  on:click={() => void onClearCover()}
                >
                  移除封面
                </button>
              </div>
            </div>
          </div>

          <div class="subsection">
            <div class="subsection-head">
              <div>
                <div class="section-label">盘面图</div>
                <p>仅作用于唱片盘面。留空时自动跟随当前专辑封面。</p>
              </div>
              <div class="album-badge">
                {album.discArtUrl ? "已自定义" : "跟随封面"}
              </div>
            </div>

            <div class="cover-layout">
              <div class="cover-preview-shell disc-preview-shell">
                {#if album.discArtUrl || album.coverUrl}
                  <img
                    class="cover-preview-image"
                    src={album.discArtUrl ?? album.coverUrl}
                    alt={`《${album.title}》盘面图`}
                  />
                {:else}
                  <div class="cover-preview-empty">
                    <span>{album.title.trim()[0] ?? "L"}</span>
                  </div>
                {/if}
              </div>

              <div class="cover-copy">
                <p>
                  可为黑胶盘面单独指定图片，不影响曲库封面。未设置时会自动使用上方封面图。
                </p>
                <div class="action-row">
                  <button
                    class="action-pill"
                    type="button"
                    disabled={isBusy}
                    on:click={() => discArtFileInput?.click()}
                  >
                    选择盘面图
                  </button>
                  <button
                    class="action-pill muted"
                    type="button"
                    disabled={!album.discArtUrl || isBusy}
                    on:click={() => void onClearDiscArt()}
                  >
                    恢复跟随封面
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section class="workshop-card track-card">
        <div class="card-head">
          <div>
            <div class="section-label">编排曲目</div>
            <h2>整理碟面顺序</h2>
          </div>
          <p class="card-copy">可调整同一碟面内的顺序，或在不同碟面之间移动曲目。</p>
        </div>

        {#if album.sides.length === 0}
          <p class="empty-state">当前专辑还没有曲目，可以先导入文件开始制作。</p>
        {:else}
          <div class="side-editor-list">
            {#each album.sides as sideTracks, sideIndex}
              <section class="side-editor">
                <div class="side-editor-head">
                  <div>
                    <div class="side-editor-title">Side {getSideLabel(sideIndex)}</div>
                    <div class="side-editor-meta">
                      {sideTracks.length} 首 · {Math.floor(getSideDuration(sideTracks) / 60)} 分钟
                    </div>
                  </div>
                </div>

                <div class="editor-track-list">
                  {#each sideTracks as track, trackIndex}
                    <div class="editor-track">
                      <div class="editor-track-body">
                        <span class="editor-track-title">{track.title}</span>
                        <span class="editor-track-path">{track.sourceDisplayPath}</span>
                      </div>

                      <div class="editor-track-tools">
                        <button
                          class="editor-track-tool"
                          type="button"
                          disabled={isBusy}
                          on:click={() => void onMoveTrack(sideIndex, trackIndex, "up")}
                        >
                          ↑
                        </button>
                        <button
                          class="editor-track-tool"
                          type="button"
                          disabled={isBusy}
                          on:click={() => void onMoveTrack(sideIndex, trackIndex, "down")}
                        >
                          ↓
                        </button>
                        <button
                          class="editor-track-tool"
                          type="button"
                          disabled={sideIndex === 0 || isBusy}
                          on:click={() => void onMoveTrack(sideIndex, trackIndex, "left")}
                        >
                          ←
                        </button>
                        <button
                          class="editor-track-tool"
                          type="button"
                          disabled={isBusy}
                          on:click={() => void onMoveTrack(sideIndex, trackIndex, "right")}
                        >
                          →
                        </button>
                        <button
                          type="button"
                          class="editor-track-tool danger-icon"
                          disabled={isBusy}
                          on:click={() => void onRemoveTrack(sideIndex, trackIndex)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {/if}
      </section>

      <section class="workshop-card danger-card">
        <div class="card-head">
          <div>
            <div class="section-label">危险操作</div>
            <h2>删除专辑</h2>
          </div>
          <p class="card-copy">删除后将清理该专辑及其未被引用的曲目记录。</p>
        </div>

        <div class="action-row">
          <button
            class="action-pill danger"
            type="button"
            disabled={isBusy}
            on:click={onRequestDelete}
          >
            删除当前专辑
          </button>
        </div>

        {#if pendingDeleteAlbumId === album.id}
          <div class="delete-confirm" role="alert">
            <p>
              确认删除专辑《{pendingDeleteAlbumTitle}》？此操作不可撤销。
            </p>
            <div class="action-row">
              <button
                class="action-pill danger"
                type="button"
                disabled={isBusy}
                on:click={() => void onDelete()}
              >
                确认删除
              </button>
              <button
                class="action-pill muted"
                type="button"
                disabled={isBusy}
                on:click={onCancelDelete}
              >
                取消
              </button>
            </div>
          </div>
        {/if}
      </section>
    {:else}
      <section class="workshop-card empty-card">
        <div class="card-head">
          <div>
            <div class="section-label">当前状态</div>
            <h2>还没有选中的专辑</h2>
          </div>
        </div>
        <p class="card-copy">请先导入音频创建专辑，或在左侧曲库中选择现有专辑。</p>
      </section>
    {/if}
  </div>
</section>

<style>
  .workshop-page {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }

  .workshop-scroll {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 18px;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(126, 94, 47, 0.28) transparent;
  }

  .workshop-scroll::-webkit-scrollbar {
    width: 7px;
  }

  .workshop-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .workshop-scroll::-webkit-scrollbar-thumb {
    background: rgba(112, 79, 37, 0.24);
    border-radius: 999px;
    border: 1px solid rgba(255, 247, 233, 0.36);
  }

  .workshop-hero,
  .workshop-card {
    border: 1px solid rgba(112, 79, 37, 0.15);
    background:
      linear-gradient(180deg, rgba(255, 251, 243, 0.9), rgba(241, 230, 206, 0.92)),
      repeating-linear-gradient(
        180deg,
        rgba(132, 95, 43, 0.03) 0,
        rgba(132, 95, 43, 0.03) 1px,
        transparent 1px,
        transparent 28px
      );
    box-shadow:
      0 14px 30px rgba(88, 59, 25, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }

  .workshop-hero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    padding: 24px 26px;
    border-radius: 26px;
  }

  .hero-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 10px;
  }

  .hero-kicker,
  .section-label,
  .summary-label {
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #846337;
    font-family: "Courier New", monospace;
  }

  h1,
  h2 {
    color: #2b1905;
    line-height: 1.1;
  }

  h1 {
    font-size: calc(28px * var(--app-font-scale));
  }

  h2 {
    font-size: calc(16px * var(--app-font-scale));
  }

  .hero-copy p,
  .card-copy,
  .subsection-head p,
  .cover-copy p,
  .empty-state,
  .side-editor-meta,
  .editor-track-path,
  .delete-confirm p,
  .error-banner {
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.6;
    color: #745732;
  }

  .hero-back,
  .action-pill,
  .editor-track-tool {
    border: 0;
    background: transparent;
    font-family: "Courier New", monospace;
    cursor: pointer;
  }

  .hero-back,
  .action-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
    padding: 11px 16px;
    border-radius: 999px;
    color: #4a2e0c;
    background: rgba(255, 252, 246, 0.85);
    box-shadow:
      inset 0 0 0 1px rgba(102, 69, 28, 0.14),
      0 6px 18px rgba(88, 59, 25, 0.08);
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.14em;
    text-transform: uppercase;
    transition:
      transform 0.14s ease,
      box-shadow 0.14s ease,
      color 0.14s ease;
  }

  .hero-back:hover,
  .action-pill:hover {
    transform: translateY(-1px);
    color: #2b1702;
    box-shadow:
      inset 0 0 0 1px rgba(102, 69, 28, 0.18),
      0 10px 22px rgba(88, 59, 25, 0.1);
  }

  .hero-back:disabled,
  .action-pill:disabled,
  .editor-track-tool:disabled {
    opacity: 0.45;
    cursor: default;
    transform: none;
  }

  .action-pill.compact {
    padding-inline: 14px;
  }

  .action-pill.muted {
    color: #6c5430;
    background: rgba(246, 239, 225, 0.9);
  }

  .action-pill.danger {
    color: #8f2f22;
  }

  .workshop-card {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 22px 24px;
    border-radius: 22px;
  }

  .workshop-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
    gap: 18px;
  }

  .card-head,
  .subsection-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .card-head > div,
  .subsection-head > div {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .card-copy {
    max-width: 420px;
  }

  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }

  .album-badge {
    border-radius: 999px;
    padding: 8px 12px;
    background: rgba(248, 239, 221, 0.92);
    color: #65441a;
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-family: "Courier New", monospace;
  }

  .album-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .album-summary > div,
  .subsection {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .album-summary strong {
    color: #382104;
    font-size: calc(12px * var(--app-font-scale));
    line-height: 1.35;
  }

  .subsection {
    padding-top: 16px;
    border-top: 1px solid rgba(108, 76, 36, 0.14);
  }

  .title-editor-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
  }

  .title-input {
    width: 100%;
    border: 0;
    border-bottom: 1px solid rgba(127, 98, 57, 0.26);
    padding: 10px 0 8px;
    background: transparent;
    color: #432a08;
    font: inherit;
  }

  .title-input:focus {
    outline: none;
    border-bottom-color: rgba(93, 63, 26, 0.6);
  }

  .cover-layout {
    display: grid;
    grid-template-columns: 138px minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }

  .cover-preview-shell {
    width: 138px;
    aspect-ratio: 1;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid rgba(111, 80, 34, 0.18);
    background:
      linear-gradient(160deg, rgba(255, 248, 236, 0.9), rgba(228, 206, 169, 0.84)),
      repeating-linear-gradient(
        135deg,
        rgba(104, 71, 29, 0.06) 0,
        rgba(104, 71, 29, 0.06) 10px,
        transparent 10px,
        transparent 20px
      );
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  .cover-preview-image,
  .cover-preview-empty {
    width: 100%;
    height: 100%;
  }

  .cover-preview-image {
    display: block;
    object-fit: cover;
  }

  .cover-preview-empty {
    display: grid;
    place-items: center;
    color: rgba(72, 44, 11, 0.82);
    font-size: calc(36px * var(--app-font-scale));
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  .cover-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 14px;
  }

  .side-editor-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
  }

  .side-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 0 0;
    border-top: 1px solid rgba(108, 76, 36, 0.16);
  }

  .side-editor-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .side-editor-title {
    font-size: calc(15px * var(--app-font-scale));
    font-weight: 700;
    color: #3a2405;
  }

  .editor-track-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
  }

  .editor-track {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 9px 0;
    border-bottom: 1px dotted rgba(127, 98, 57, 0.18);
  }

  .editor-track-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .editor-track-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #382104;
    font-size: calc(12px * var(--app-font-scale));
  }

  .editor-track-tools {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .editor-track-tool {
    padding: 0;
    color: #613c12;
    font-size: calc(11px * var(--app-font-scale));
    transition: color 0.14s ease;
  }

  .editor-track-tool:hover {
    color: #2b1702;
  }

  .danger-icon {
    color: #933122;
  }

  .delete-confirm {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid rgba(158, 50, 37, 0.22);
    border-radius: 16px;
    background: rgba(255, 246, 242, 0.9);
  }

  .error-banner {
    border: 1px solid rgba(158, 50, 37, 0.2);
    border-radius: 16px;
    padding: 12px 16px;
    background: rgba(255, 245, 241, 0.94);
    color: #8b2d1f;
  }

  .visually-hidden-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 1180px) {
    .workshop-grid {
      grid-template-columns: 1fr;
    }

    .album-summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 920px) {
    .workshop-hero,
    .card-head,
    .subsection-head {
      flex-direction: column;
      align-items: stretch;
    }

    .album-summary,
    .title-editor-field,
    .cover-layout {
      grid-template-columns: 1fr;
    }

    .cover-preview-shell {
      width: min(100%, 220px);
    }
  }
</style>
