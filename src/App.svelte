<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Turntable from "./lib/turntable/Turntable.svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    isDesktopRuntime,
    pickDesktopAudioFiles,
    pickDesktopAudioFolder,
  } from "./lib/audio/importAudio";
  import {
    appendPreparedImportToAlbum,
    countAlbumTracks,
    createLibraryAlbumFromPreparedImport,
    getAlbumDuration,
    getSideDuration,
    libraryAlbumToPlaybackAlbum,
    moveTrackWithinAlbum,
    removeTrackFromAlbum,
    renameLibraryAlbum,
  } from "./lib/library/model";
  import {
    deleteLibraryAlbum,
    loadLibrary,
    saveLibraryAlbum,
  } from "./lib/library/persistence";
  import { VinylEngine } from "./lib/audio/vinylEngine";
  import type {
    Album,
    DiscArtworkMode,
    DiscSide,
    LibraryAlbum,
    TonearmState,
  } from "./lib/types";

  let libraryAlbums: LibraryAlbum[] = [];
  let selectedAlbumId: string | null = null;
  let playbackAlbum: Album | null = null;
  let engine: VinylEngine | null = null;
  let currentSideIndex = 0;
  let currentTime = 0;
  let isPlaying = false;
  let isPlatterSpinning = false;
  let isLoading = false;
  let isSavingLibrary = false;
  let loadError = "";
  let tonearmState: TonearmState = "parked";
  let discArtworkMode: DiscArtworkMode = "centered";
  let startSequenceToken = 0;
  let manualSpinupStartedAt: number | null = null;
  const MUSIC_METER_BANDS = 16;
  let musicMeterLevels = createEmptyMusicMeterLevels();
  let isSpectrumEnabled = true;
  let albumTitleDraft = "";
  let titleDraftAlbumId: string | null = null;
  let isEditorOpen = false;
  let libraryPanelVisible = true;

  const isDesktopApp = isDesktopRuntime();

  function onTitlebarMousedown(e: MouseEvent) {
    if (e.buttons === 1) {
      getCurrentWindow().startDragging();
    }
  }

  const PLATTER_SPINUP_MS = 2300;
  const TONEARM_CUE_MS = 1500;
  const TONEARM_SETTLE_PAUSE_MS = 110;
  const TONEARM_DROP_MS = 700;

  function createEmptyMusicMeterLevels(): number[] {
    return Array.from({ length: MUSIC_METER_BANDS }, () => 0);
  }

  function resetMusicMeter() {
    musicMeterLevels = createEmptyMusicMeterLevels();
  }

  $: selectedAlbum =
    libraryAlbums.find((album) => album.id === selectedAlbumId) ?? null;
  $: currentSide = playbackAlbum?.sides[currentSideIndex] ?? null;

  $: if ((selectedAlbum?.id ?? null) !== titleDraftAlbumId) {
    albumTitleDraft = selectedAlbum?.title ?? "";
    titleDraftAlbumId = selectedAlbum?.id ?? null;
  }

  $: if (!selectedAlbum) {
    isEditorOpen = false;
  }

  function sortAlbums(albums: LibraryAlbum[]): LibraryAlbum[] {
    return [...albums].sort((left, right) => {
      if (right.updatedAt !== left.updatedAt)
        return right.updatedAt - left.updatedAt;
      return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      });
    });
  }

  function replaceAlbum(updatedAlbum: LibraryAlbum) {
    const otherAlbums = libraryAlbums.filter(
      (album) => album.id !== updatedAlbum.id,
    );
    libraryAlbums = sortAlbums([updatedAlbum, ...otherAlbums]);
    selectedAlbumId = updatedAlbum.id;
  }

  function getAlbumById(albumId: string | null): LibraryAlbum | null {
    if (!albumId) return null;
    return libraryAlbums.find((album) => album.id === albumId) ?? null;
  }

  function resetPlaybackState() {
    cancelStartupSequence();
    engine?.destroy();
    engine = null;
    currentSideIndex = 0;
    currentTime = 0;
    isPlaying = false;
    isPlatterSpinning = false;
    tonearmState = "parked";
    manualSpinupStartedAt = null;
    resetMusicMeter();
  }

  function bindEngineCallbacks(targetEngine: VinylEngine) {
    targetEngine.onTimeUpdate = (time) => {
      currentTime = time;
      musicMeterLevels = targetEngine.getVisualLevels(MUSIC_METER_BANDS);
    };

    targetEngine.onSideEnded = () => {
      cancelStartupSequence();
      targetEngine.stopLeadInNoise();
      isPlaying = false;
      isPlatterSpinning = false;
      tonearmState = "parked";
      currentTime = currentSide?.totalDuration ?? 0;
      manualSpinupStartedAt = null;
      resetMusicMeter();
    };
  }

  async function syncSelectedAlbumToPlayer(
    albumId: string | null = selectedAlbumId,
  ) {
    const album = getAlbumById(albumId);

    resetPlaybackState();
    playbackAlbum = album ? libraryAlbumToPlaybackAlbum(album) : null;

    if (!playbackAlbum || playbackAlbum.sides.length === 0) {
      return;
    }

    engine = new VinylEngine();
    bindEngineCallbacks(engine);
    await engine.loadSide(playbackAlbum.sides[0]);
  }

  async function loadPersistedLibrary() {
    if (!isDesktopApp) return;

    isLoading = true;
    loadError = "";

    try {
      libraryAlbums = sortAlbums(await loadLibrary());
      selectedAlbumId = libraryAlbums[0]?.id ?? null;
      await syncSelectedAlbumToPlayer(selectedAlbumId);
    } catch (err) {
      loadError = "加载曲库失败：" + String(err);
      console.error(err);
    } finally {
      isLoading = false;
    }
  }

  async function persistAlbum(updatedAlbum: LibraryAlbum) {
    isSavingLibrary = true;
    loadError = "";

    try {
      const savedAlbum = await saveLibraryAlbum(updatedAlbum);
      replaceAlbum(savedAlbum);
      await syncSelectedAlbumToPlayer(savedAlbum.id);
    } catch (err) {
      loadError = "保存失败：" + String(err);
      console.error(err);
    } finally {
      isSavingLibrary = false;
    }
  }

  async function importAlbum(
    kind: "files" | "folder",
    target: "new" | "current",
  ) {
    isLoading = true;
    loadError = "";

    try {
      const prepared =
        kind === "files"
          ? await pickDesktopAudioFiles()
          : await pickDesktopAudioFolder();

      if (!prepared) return;

      if (target === "new" || !selectedAlbum) {
        await persistAlbum(createLibraryAlbumFromPreparedImport(prepared));
      } else {
        await persistAlbum(
          appendPreparedImportToAlbum(selectedAlbum, prepared),
        );
      }
    } catch (err) {
      loadError = "导入失败：" + String(err);
      console.error(err);
    } finally {
      isLoading = false;
    }
  }

  async function saveCurrentAlbumTitle() {
    if (!selectedAlbum) return;

    const trimmedTitle = albumTitleDraft.trim();
    if (!trimmedTitle || trimmedTitle === selectedAlbum.title) {
      albumTitleDraft = selectedAlbum.title;
      return;
    }

    await persistAlbum(renameLibraryAlbum(selectedAlbum, trimmedTitle));
  }

  async function selectAlbumById(albumId: string) {
    if (selectedAlbumId === albumId) return;
    selectedAlbumId = albumId;
    await syncSelectedAlbumToPlayer(albumId);
  }

  async function moveTrack(
    sideIndex: number,
    trackIndex: number,
    direction: "up" | "down" | "left" | "right",
  ) {
    if (!selectedAlbum) return;
    await persistAlbum(
      moveTrackWithinAlbum(selectedAlbum, sideIndex, trackIndex, direction),
    );
  }

  async function removeTrack(sideIndex: number, trackIndex: number) {
    if (!selectedAlbum) return;
    await persistAlbum(
      removeTrackFromAlbum(selectedAlbum, sideIndex, trackIndex),
    );
  }

  async function deleteCurrentAlbum() {
    if (!selectedAlbum) return;
    if (!window.confirm(`删除专辑《${selectedAlbum.title}》？`)) return;

    isSavingLibrary = true;
    loadError = "";

    try {
      const removedAlbumId = selectedAlbum.id;
      await deleteLibraryAlbum(removedAlbumId);
      libraryAlbums = libraryAlbums.filter(
        (album) => album.id !== removedAlbumId,
      );
      selectedAlbumId = libraryAlbums[0]?.id ?? null;
      isEditorOpen = false;
      await syncSelectedAlbumToPlayer(selectedAlbumId);
    } catch (err) {
      loadError = "删除失败：" + String(err);
      console.error(err);
    } finally {
      isSavingLibrary = false;
    }
  }

  function getSideLabel(sideIndex: number): string {
    return String.fromCharCode(65 + sideIndex);
  }

  function openEditor() {
    if (!selectedAlbum) return;
    isEditorOpen = true;
  }

  function closeEditor() {
    isEditorOpen = false;
  }

  function toggleLibraryPanel() {
    libraryPanelVisible = !libraryPanelVisible;
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function isCurrentTrack(
    sideRef: DiscSide | null,
    trackIndex: number,
    time: number,
  ): boolean {
    if (!sideRef || !isPlaying) return false;
    let accumulated = 0;
    for (let i = 0; i < trackIndex; i++) {
      accumulated += sideRef.tracks[i].duration;
    }
    const end = accumulated + sideRef.tracks[trackIndex].duration;
    return time >= accumulated && time < end;
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cancelStartupSequence() {
    startSequenceToken += 1;
  }

  function clearManualCueState() {
    manualSpinupStartedAt = null;
  }

  function cancelManualCueInteraction() {
    if (!engine) return;
    cancelStartupSequence();
    engine.stopLeadInNoise();
    isPlaying = false;
    isPlatterSpinning = false;
    tonearmState = "parked";
    clearManualCueState();
    resetMusicMeter();
  }

  async function beginPlaybackSequence() {
    if (!engine || !currentSide) return;

    const token = ++startSequenceToken;
    clearManualCueState();
    tonearmState = "parked";
    isPlatterSpinning = true;
    await engine.startLeadInNoise();

    await wait(PLATTER_SPINUP_MS);
    if (token !== startSequenceToken) return;

    tonearmState = "cueing";
    await wait(TONEARM_CUE_MS);
    if (token !== startSequenceToken) return;

    await wait(TONEARM_SETTLE_PAUSE_MS);
    if (token !== startSequenceToken) return;

    tonearmState = "dropping";
    await wait(TONEARM_DROP_MS);
    if (token !== startSequenceToken) return;

    await engine.playWithOptions(currentTime, { keepNoise: true });
    if (token !== startSequenceToken) {
      engine.stop();
      resetMusicMeter();
      return;
    }

    isPlaying = true;
    tonearmState = "playing";
  }

  async function beginManualCueSpinup() {
    if (!engine || !currentSide) return;
    if (isPlaying || tonearmState === "cueing" || tonearmState === "dropping")
      return;
    if (manualSpinupStartedAt !== null && isPlatterSpinning) return;

    cancelStartupSequence();
    tonearmState = "holding";

    if (!isPlatterSpinning) {
      isPlatterSpinning = true;
      manualSpinupStartedAt = performance.now();
      await engine.startLeadInNoise();
      return;
    }

    manualSpinupStartedAt = performance.now();
  }

  async function beginPlaybackFromManualCue(timeInSide: number) {
    if (!engine || !currentSide) return;

    const token = ++startSequenceToken;
    currentTime = timeInSide;
    tonearmState = "holding";

    if (!isPlatterSpinning) {
      isPlatterSpinning = true;
      manualSpinupStartedAt = performance.now();
      await engine.startLeadInNoise();
      if (token !== startSequenceToken) return;
    }

    if (manualSpinupStartedAt === null) {
      manualSpinupStartedAt = performance.now() - PLATTER_SPINUP_MS;
    }

    const remainingSpinupMs = Math.max(
      0,
      PLATTER_SPINUP_MS - (performance.now() - manualSpinupStartedAt),
    );
    if (remainingSpinupMs > 0) {
      await wait(remainingSpinupMs);
      if (token !== startSequenceToken) return;
    }

    await wait(TONEARM_SETTLE_PAUSE_MS);
    if (token !== startSequenceToken) return;

    tonearmState = "dropping";
    await wait(TONEARM_DROP_MS);
    if (token !== startSequenceToken) return;

    await engine.playWithOptions(timeInSide, { keepNoise: true });
    if (token !== startSequenceToken) {
      engine.stop();
      resetMusicMeter();
      return;
    }

    clearManualCueState();
    isPlaying = true;
    tonearmState = "playing";
  }

  async function togglePlay() {
    if (!engine || !currentSide) return;

    if (
      isPlaying ||
      isPlatterSpinning ||
      tonearmState === "cueing" ||
      tonearmState === "dropping"
    ) {
      cancelStartupSequence();
      engine.pause();
      engine.stopLeadInNoise();
      isPlaying = false;
      isPlatterSpinning = false;
      tonearmState = "parked";
      clearManualCueState();
      resetMusicMeter();
    } else {
      await beginPlaybackSequence();
    }
  }

  async function handleSeek(timeInSide: number) {
    if (!engine || !currentSide) return;
    currentTime = timeInSide;
    if (isPlaying) {
      await engine.playWithOptions(timeInSide, { keepNoise: true });
    }
  }

  async function switchSide(index: number) {
    if (!playbackAlbum || !engine) return;
    if (index < 0 || index >= playbackAlbum.sides.length) return;

    cancelStartupSequence();

    if (isPlaying) {
      engine.stop();
      isPlaying = false;
    }

    engine.stopLeadInNoise();
    isPlatterSpinning = false;
    tonearmState = "parked";
    clearManualCueState();
    resetMusicMeter();

    currentSideIndex = index;
    currentTime = 0;
    isLoading = true;
    await engine.loadSide(playbackAlbum.sides[index]);
    isLoading = false;
  }

  onMount(() => {
    void loadPersistedLibrary();
  });

  onDestroy(() => {
    cancelStartupSequence();
    engine?.destroy();
  });
</script>

<main class:desktop-overlay-shell={isDesktopApp}>
  {#if isDesktopApp}
    <div class="titlebar-drag-region" on:mousedown={onTitlebarMousedown}></div>
  {/if}
  <div class="studio" class:collapsed-layout={!libraryPanelVisible}>
    <aside class="library-panel" class:collapsed={!libraryPanelVisible}>
      {#if libraryPanelVisible}
        <div class="library-shell">
          <div class="panel-head library-marquee">
            <div class="panel-title-block">
              <div class="eyebrow">LOFYL</div>
              <h1 class="panel-title">LOFYL</h1>
            </div>

            <div class="panel-toolbar" aria-label="导入新专辑与曲库控制">
              {#if isDesktopApp}
                <button
                  class="mini-btn"
                  type="button"
                  on:click={() => void importAlbum("files", "new")}
                >
                  导入文件
                </button>
                <button
                  class="mini-btn"
                  type="button"
                  on:click={() => void importAlbum("folder", "new")}
                >
                  导入文件夹
                </button>
              {/if}

              <button
                class="toggle-library-btn"
                type="button"
                on:click={toggleLibraryPanel}
                aria-label="切换库面板"
              >
                隐藏库
              </button>
            </div>
          </div>

          {#if loadError}
            <p class="error">{loadError}</p>
          {/if}

          <div class="section focus-section">
            {#if selectedAlbum}
              <div
                class="selected-album-card"
                class:has-cover={Boolean(selectedAlbum.coverUrl)}
                style={selectedAlbum.coverUrl
                  ? `--selected-album-art: url("${selectedAlbum.coverUrl}")`
                  : undefined}
              >
                <div class="selected-album-shell">
                  <div class="selected-album-copy">
                    <div class="section-label">当前专辑</div>
                    <div class="selected-album-headline">
                      <span class="selected-album-title"
                        >{selectedAlbum.title}</span
                      >
                      <span class="selected-album-badge">当前专辑</span>
                    </div>
                    <span class="selected-album-artist"
                      >{selectedAlbum.artist || "未署名艺人"}</span
                    >
                    <div class="selected-album-stats">
                      <span
                        >{playbackAlbum?.discs ?? Math.ceil(selectedAlbum.sides.length / 2)} 张碟</span
                      >
                      <span>{playbackAlbum?.sides.length ?? selectedAlbum.sides.length} 面</span>
                      <span>{countAlbumTracks(selectedAlbum)} 首</span>
                      <span>{formatTime(getAlbumDuration(selectedAlbum))}</span>
                    </div>
                  </div>
                </div>

                <div class="selected-album-actions">
                  <button
                    class="primary-btn"
                    type="button"
                    on:click={openEditor}
                  >
                    编辑专辑
                  </button>
                </div>

                {#if playbackAlbum && currentSide}
                  <div class="sidebar-side-panel">
                    <div class="sidebar-side-head">
                      <div class="sidebar-side-kicker">
                        <span class="section-label">当前盘面</span>
                        <span class="sidebar-side-badge"
                          >Side {currentSide.label}</span
                        >
                      </div>
                      <span class="selected-album-meta">
                        {currentSide.tracks.length} 首曲目 · 总时长 {formatTime(
                          currentSide.totalDuration,
                        )}
                      </span>
                    </div>

                    <div class="sidebar-side-picker">
                      {#each playbackAlbum.sides as side, index}
                        <button
                          class="side-chip"
                          class:active={index === currentSideIndex}
                          type="button"
                          on:click={() => void switchSide(index)}
                        >
                          Side {side.label}
                        </button>
                      {/each}
                    </div>

                    <div class="sidebar-track-list">
                      <div class="sidebar-track-list-head" aria-hidden="true">
                        <span>Track</span>
                        <span>Title</span>
                        <span>Time</span>
                      </div>
                      {#each currentSide.tracks as track, index}
                        <div
                          class="sidebar-track"
                          class:playing={isCurrentTrack(
                            currentSide,
                            index,
                            currentTime,
                          )}
                        >
                          <span class="sidebar-track-num"
                            >{String(index + 1).padStart(2, "0")}</span
                          >
                          <span class="sidebar-track-title">{track.title}</span>
                          <span class="sidebar-track-duration"
                            >{formatTime(track.duration)}</span
                          >
                        </div>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <p class="helper side-helper">当前专辑还没有可播放的盘面。</p>
                {/if}
              </div>
            {:else}
              <p class="empty-state">先导入一张专辑。</p>
            {/if}
          </div>

          <div class="section catalog-section">
            <div class="catalog-head">
              <div class="section-label">专辑目录</div>
              <span class="catalog-count">{libraryAlbums.length} 张收藏</span>
            </div>
            {#if libraryAlbums.length === 0}
              <p class="empty-state">
                还没有专辑，先从本地音频文件或文件夹导入。
              </p>
            {:else}
              <div class="album-list">
                {#each libraryAlbums as item, index}
                  {@const pb = libraryAlbumToPlaybackAlbum(item)}
                  <button
                    class="album-card"
                    class:active={item.id === selectedAlbumId}
                    on:click={() => void selectAlbumById(item.id)}
                    type="button"
                  >
                    <span class="album-card-index"
                      >{String(index + 1).padStart(2, "0")}</span
                    >
                    <span class="album-card-copy">
                      <span class="album-card-title">{item.title}</span>
                      <span class="album-card-meta">
                        {pb.discs} 张碟 · {pb.sides.length} 面 · {countAlbumTracks(item)} 首
                      </span>
                    </span>
                    {#if item.id === selectedAlbumId}
                      <span class="album-card-badge">Playing Shelf</span>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <button
          class="toggle-library-btn collapsed-toggle-btn"
          type="button"
          on:click={toggleLibraryPanel}
          aria-label="切换库面板"
        >
          显示库
        </button>
      {/if}

      {#if libraryPanelVisible && selectedAlbum && isEditorOpen}
        <section class="editor-drawer" aria-label="专辑编辑器">
          <div class="arranger-head">
            <div>
              <div class="section-label">专辑编辑</div>
              <div class="drawer-title">{selectedAlbum.title}</div>
              <div class="arranger-meta">
                {playbackAlbum?.discs ?? Math.ceil(selectedAlbum.sides.length / 2)} 张碟 · {playbackAlbum?.sides.length ?? selectedAlbum.sides.length} 面 ·
                {countAlbumTracks(selectedAlbum)} 首 · {formatTime(
                  getAlbumDuration(selectedAlbum),
                )}
              </div>
            </div>

            <button
              class="ghost-btn close-btn"
              type="button"
              on:click={closeEditor}
            >
              收起
            </button>
          </div>

          <div class="title-editor">
            <input
              class="title-input"
              bind:value={albumTitleDraft}
              placeholder="专辑名称"
              on:blur={() => void saveCurrentAlbumTitle()}
            />
            <button
              class="save-btn"
              type="button"
              on:click={() => void saveCurrentAlbumTitle()}
            >
              保存标题
            </button>
          </div>

          {#if isDesktopApp}
            <div class="drawer-actions">
              <button
                class="ghost-btn"
                type="button"
                on:click={() => void importAlbum("files", "current")}
              >
                追加文件到当前专辑
              </button>
              <button
                class="ghost-btn"
                type="button"
                on:click={() => void importAlbum("folder", "current")}
              >
                追加文件夹到当前专辑
              </button>
              <button
                class="danger-btn"
                type="button"
                on:click={() => void deleteCurrentAlbum()}
              >
                删除专辑
              </button>
            </div>
          {/if}

          {#if selectedAlbum.sides.length === 0}
            <p class="empty-state">当前专辑还没有曲目，可以继续追加导入。</p>
          {:else}
            <div class="side-editor-list">
              {#each selectedAlbum.sides as sideTracks, sideIndex}
                <section class="side-editor">
                  <div class="side-editor-head">
                    <span class="side-editor-title"
                      >Side {getSideLabel(sideIndex)}</span
                    >
                    <span class="side-editor-meta">
                      {sideTracks.length} 首 · {formatTime(
                        getSideDuration(sideTracks),
                      )}
                    </span>
                  </div>

                  <div class="editor-track-list">
                    {#each sideTracks as track, trackIndex}
                      <div class="editor-track">
                        <div class="editor-track-body">
                          <span class="editor-track-title">{track.title}</span>
                          <span class="editor-track-path"
                            >{track.sourceDisplayPath}</span
                          >
                        </div>

                        <div class="editor-track-tools">
                          <button
                            type="button"
                            on:click={() =>
                              void moveTrack(sideIndex, trackIndex, "up")}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            on:click={() =>
                              void moveTrack(sideIndex, trackIndex, "down")}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            disabled={sideIndex === 0}
                            on:click={() =>
                              void moveTrack(sideIndex, trackIndex, "left")}
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            on:click={() =>
                              void moveTrack(sideIndex, trackIndex, "right")}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            class="danger-icon"
                            on:click={() =>
                              void removeTrack(sideIndex, trackIndex)}
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
      {/if}
    </aside>

    <section class="turntable-panel">
      {#if isLoading || isSavingLibrary}
        <div class="turntable-status-bar">
          {#if isLoading}
            <span class="status-pill">加载中</span>
          {/if}
          {#if isSavingLibrary}
            <span class="status-pill">已写入</span>
          {/if}
        </div>
      {/if}

      <div class="turntable-stage">
        <Turntable
          side={currentSide}
          {currentTime}
          {isPlaying}
          {isPlatterSpinning}
          {tonearmState}
          {musicMeterLevels}
          {isSpectrumEnabled}
          coverUrl={playbackAlbum?.coverUrl}
          artworkMode={discArtworkMode}
          onArtworkModeChange={(mode) => {
            discArtworkMode = mode;
          }}
          onToggleSpectrum={() => {
            isSpectrumEnabled = !isSpectrumEnabled;
          }}
          onSeek={handleSeek}
          onTogglePlay={togglePlay}
          onNeedleDragStart={() => {
            void beginManualCueSpinup();
          }}
          onNeedleDrop={(timeInSide) => {
            if (isPlaying) return;
            if (timeInSide === null) {
              cancelManualCueInteraction();
              return;
            }
            void beginPlaybackFromManualCue(timeInSide);
          }}
        />
      </div>
    </section>
  </div>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: radial-gradient(
        circle at top left,
        rgba(255, 245, 221, 0.95),
        transparent 36%
      ),
      linear-gradient(135deg, #e9dcc5 0%, #d8c4a1 45%, #c4ab82 100%);
    color: #2e1e0a;
    font-family: "Courier New", monospace;
    overflow: hidden;
  }

  main {
    width: 100vw;
    height: 100vh;
    height: 100dvh;
  }

  main.desktop-overlay-shell .library-panel {
    padding-top: 52px;
  }

  main.desktop-overlay-shell .turntable-panel {
    padding: 44px 0 0;
    gap: 0;
    border-radius: 0 10px 10px 0;
  }

  .titlebar-drag-region {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 52px;
    z-index: 9999;
  }

  .studio {
    display: grid;
    grid-template-columns: minmax(344px, 392px) minmax(0, 1fr);
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .studio.collapsed-layout {
    grid-template-columns: minmax(60px, 80px) minmax(0, 1fr);
  }

  .library-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 18px 16px 16px 12px;
    border-right: 1px solid rgba(110, 73, 30, 0.2);
    background: linear-gradient(
        180deg,
        rgba(253, 248, 238, 0.6),
        rgba(216, 192, 153, 0.22)
      ),
      linear-gradient(145deg, rgba(121, 84, 43, 0.3), rgba(81, 51, 24, 0.08)),
      linear-gradient(180deg, #cfb189 0%, #b38e64 100%);
    backdrop-filter: blur(12px);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    box-shadow:
      inset 0 1px 0 rgba(255, 247, 233, 0.32),
      inset -1px 0 0 rgba(84, 54, 22, 0.14),
      18px 0 40px rgba(83, 53, 22, 0.14);
    font-family: Georgia, "Times New Roman", serif;
  }
  .library-panel.collapsed .library-shell {
    display: none;
  }
  .library-panel.collapsed {
    background: transparent;
    border-right: none;
    backdrop-filter: none;
    align-items: center;
    justify-content: flex-start;
    padding: 12px 8px;
  }

  .toggle-library-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
  }

  .library-shell,
  .editor-drawer {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    min-height: 0;
  }

  .library-shell {
    height: 100%;
    overflow-y: auto;
    gap: 18px;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(126, 94, 47, 0.34) transparent;
  }

  .editor-drawer {
    position: absolute;
    inset: 0;
    z-index: 2;
    padding: 18px 14px 16px 12px;
    overflow-y: auto;
    background: linear-gradient(
        180deg,
        rgba(255, 251, 243, 0.96),
        rgba(235, 220, 194, 0.98)
      ),
      rgba(229, 213, 184, 0.99);
    box-shadow: 18px 0 36px rgba(84, 52, 18, 0.16);
    scrollbar-width: thin;
    scrollbar-color: rgba(126, 94, 47, 0.34) transparent;
  }

  .library-shell::-webkit-scrollbar,
  .editor-drawer::-webkit-scrollbar {
    width: 7px;
  }

  .library-shell::-webkit-scrollbar-track,
  .editor-drawer::-webkit-scrollbar-track {
    background: transparent;
  }

  .library-shell::-webkit-scrollbar-thumb,
  .editor-drawer::-webkit-scrollbar-thumb {
    background: linear-gradient(
      180deg,
      rgba(148, 111, 60, 0.34),
      rgba(104, 73, 34, 0.42)
    );
    border-radius: 999px;
    border: 1px solid rgba(255, 247, 233, 0.48);
  }

  .library-shell::-webkit-scrollbar-thumb:hover,
  .editor-drawer::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(
      180deg,
      rgba(148, 111, 60, 0.46),
      rgba(104, 73, 34, 0.56)
    );
  }

  .panel-head,
  .arranger-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }

  .panel-head {
    flex-direction: column;
    align-items: stretch;
  }

  .library-marquee {
    gap: 14px;
    padding: 16px 16px 14px;
    border-radius: 24px;
    background: linear-gradient(
      180deg,
      rgba(93, 58, 25, 0.18),
      rgba(255, 247, 233, 0.2) 24%,
      rgba(255, 245, 228, 0.78) 100%
    );
    border: 1px solid rgba(116, 78, 33, 0.16);
    box-shadow:
      inset 0 1px 0 rgba(255, 252, 246, 0.52),
      inset 0 -10px 20px rgba(153, 111, 56, 0.06),
      0 16px 30px rgba(94, 59, 23, 0.12);
  }

  .turntable-status-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .eyebrow {
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.22em;
    color: #8a6a3c;
    text-transform: uppercase;
    font-family: "Courier New", monospace;
  }

  .panel-title {
    font-size: calc(18px * var(--app-font-scale));
    line-height: 1.2;
    color: #2a1802;
  }

  .panel-title-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .panel-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    padding-top: 2px;
  }

  .status-pill {
    white-space: nowrap;
    border: 1px solid rgba(126, 94, 47, 0.28);
    border-radius: 999px;
    padding: 5px 9px;
    background: rgba(255, 250, 240, 0.62);
    color: #7c6036;
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.08em;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-label {
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #8d6b3d;
    font-family: "Courier New", monospace;
  }

  .mini-btn,
  .primary-btn,
  .ghost-btn,
  .save-btn,
  .danger-btn,
  .album-card,
  .editor-track-tools button {
    font-family: inherit;
    border: 0;
    border-radius: 10px;
    cursor: pointer;
    transition:
      transform 0.14s ease,
      background 0.14s ease,
      opacity 0.14s ease;
  }

  .mini-btn {
    min-height: 30px;
    padding: 7px 12px;
    border: 1px solid rgba(120, 84, 38, 0.18);
    background: linear-gradient(
      180deg,
      rgba(255, 250, 243, 0.96),
      rgba(244, 229, 202, 0.88)
    );
    color: #5b3a12;
    font-size: calc(10px * var(--app-font-scale));
    letter-spacing: 0.08em;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      0 6px 12px rgba(106, 69, 29, 0.08);
    font-family: "Courier New", monospace;
  }

  .toggle-library-btn {
    min-height: 30px;
    padding: 7px 12px;
    border: 1px solid rgba(120, 84, 38, 0.18);
    background: linear-gradient(
      180deg,
      rgba(255, 250, 243, 0.96),
      rgba(244, 229, 202, 0.88)
    );
    color: #5b3a12;
    font-size: calc(10px * var(--app-font-scale));
    letter-spacing: 0.08em;
    border-radius: 10px;
    cursor: pointer;
    transition:
      transform 0.14s ease,
      background 0.14s ease,
      opacity 0.14s ease;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      0 6px 12px rgba(106, 69, 29, 0.08);
    font-family: "Courier New", monospace;
  }

  .primary-btn,
  .ghost-btn {
    min-height: 34px;
    padding: 8px 14px;
    font-size: calc(10px * var(--app-font-scale));
  }

  .primary-btn {
    background: linear-gradient(180deg, #9e7242, #7d5328);
    color: #fff5e7;
    box-shadow:
      inset 0 1px 0 rgba(255, 244, 223, 0.35),
      0 10px 18px rgba(92, 55, 18, 0.16);
    font-family: "Courier New", monospace;
  }

  .ghost-btn {
    border: 1px solid rgba(133, 98, 49, 0.16);
    background: linear-gradient(
      180deg,
      rgba(255, 250, 242, 0.92),
      rgba(245, 232, 208, 0.86)
    );
    color: #553712;
    font-family: "Courier New", monospace;
  }

  .mini-btn:disabled,
  .primary-btn:disabled,
  .ghost-btn:disabled,
  .save-btn:disabled,
  .danger-btn:disabled,
  .editor-track-tools button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .mini-btn:not(:disabled):hover,
  .primary-btn:not(:disabled):hover,
  .ghost-btn:not(:disabled):hover,
  .save-btn:not(:disabled):hover,
  .danger-btn:not(:disabled):hover,
  .album-card:hover,
  .editor-track-tools button:not(:disabled):hover {
    transform: translateY(-1px);
  }

  .helper,
  .drawer-title,
  .arranger-meta,
  .empty-state {
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.6;
    color: #80613a;
  }

  .error {
    color: #af2f2f;
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.45;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 245, 241, 0.72);
    border: 1px solid rgba(175, 47, 47, 0.12);
  }

  .album-list,
  .side-editor-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  .album-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 14px 14px 13px;
    border-radius: 18px;
    background: linear-gradient(
        180deg,
        rgba(255, 252, 246, 0.94),
        rgba(243, 229, 205, 0.9)
      ),
      rgba(255, 251, 244, 0.62);
    border: 1px solid rgba(133, 98, 49, 0.12);
    color: #4c3210;
    text-align: left;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.52),
      0 10px 18px rgba(96, 59, 17, 0.06);
  }

  .album-card.active {
    background: linear-gradient(
        90deg,
        rgba(146, 105, 50, 0.2),
        rgba(255, 248, 238, 0.98) 18%
      ),
      linear-gradient(
        180deg,
        rgba(255, 252, 246, 0.98),
        rgba(241, 226, 198, 0.92)
      );
    color: #2f1c04;
    border-color: rgba(133, 98, 49, 0.14);
    box-shadow:
      inset 4px 0 0 rgba(120, 82, 31, 0.82),
      inset 0 1px 0 rgba(255, 255, 255, 0.58),
      0 14px 24px rgba(96, 59, 17, 0.1);
  }

  .album-card-index {
    align-self: flex-start;
    padding-top: 1px;
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.18em;
    color: rgba(108, 73, 31, 0.72);
    font-family: "Courier New", monospace;
  }

  .album-card-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .album-card-title {
    font-size: calc(13px * var(--app-font-scale));
    font-weight: 700;
    line-height: 1.25;
  }

  .album-card-badge,
  .selected-album-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border-radius: 999px;
    font-size: calc(8px * var(--app-font-scale));
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-family: "Courier New", monospace;
  }

  .album-card-badge {
    justify-self: flex-end;
    background: rgba(122, 81, 34, 0.08);
    border: 1px solid rgba(122, 81, 34, 0.12);
    color: #6a4315;
    white-space: nowrap;
  }

  .album-card-meta {
    font-size: calc(9px * var(--app-font-scale));
    line-height: 1.5;
    color: rgba(87, 57, 20, 0.78);
  }

  .focus-section {
    padding: 18px 17px 16px;
    border-radius: 28px;
    background: linear-gradient(
        180deg,
        rgba(255, 252, 247, 0.95),
        rgba(242, 228, 201, 0.92)
      ),
      rgba(255, 248, 235, 0.7);
    border: 1px solid rgba(133, 98, 49, 0.14);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.52),
      inset 0 -18px 24px rgba(145, 104, 47, 0.05),
      0 18px 30px rgba(118, 83, 34, 0.1);
  }

  .catalog-section {
    padding: 16px 15px 14px;
    border-radius: 24px;
    background: linear-gradient(
        180deg,
        rgba(246, 234, 211, 0.92),
        rgba(231, 210, 176, 0.9)
      ),
      rgba(239, 224, 197, 0.82);
    border: 1px solid rgba(131, 92, 41, 0.14);
    box-shadow:
      inset 0 1px 0 rgba(255, 249, 239, 0.42),
      inset 0 -12px 20px rgba(118, 83, 34, 0.04),
      0 14px 24px rgba(101, 65, 24, 0.08);
  }

  .catalog-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .catalog-count {
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.12em;
    color: rgba(96, 63, 24, 0.76);
    text-transform: uppercase;
    font-family: "Courier New", monospace;
  }

  .selected-album-card,
  .selected-album-copy,
  .selected-album-actions,
  .drawer-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .selected-album-actions,
  .drawer-actions {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .selected-album-actions {
    padding-top: 2px;
  }

  .selected-album-card {
    position: relative;
    overflow: hidden;
    padding: 18px 18px 16px;
    border-radius: 24px;
    background: linear-gradient(
        180deg,
        rgba(255, 250, 241, 0.96),
        rgba(241, 227, 198, 0.92)
      ),
      rgba(255, 248, 235, 0.82);
    border: 1px solid rgba(133, 98, 49, 0.14);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      inset 0 -14px 24px rgba(145, 104, 47, 0.05),
      0 16px 28px rgba(92, 58, 20, 0.08);
    isolation: isolate;
  }

  .selected-album-card::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    background: linear-gradient(
        180deg,
        rgba(255, 252, 247, 0.92),
        rgba(248, 240, 224, 0.84) 42%,
        rgba(239, 223, 194, 0.92)
      ),
      radial-gradient(
        circle at top right,
        rgba(255, 255, 255, 0.5),
        transparent 34%
      );
  }

  .selected-album-card.has-cover::before {
    content: "";
    position: absolute;
    inset: -10%;
    z-index: 0;
    background-image: var(--selected-album-art);
    background-size: cover;
    background-position: center;
    filter: blur(24px) saturate(0.72) brightness(1.08);
    transform: scale(1.06);
    opacity: 0.9;
  }

  .selected-album-shell,
  .selected-album-copy,
  .selected-album-actions,
  .sidebar-side-panel {
    position: relative;
    z-index: 2;
  }

  .selected-album-title,
  .drawer-title {
    font-size: calc(15px * var(--app-font-scale));
    font-weight: 700;
    color: #2f1c04;
    letter-spacing: 0.01em;
  }

  .selected-album-headline {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .selected-album-shell {
    display: block;
    align-items: start;
  }

  .selected-album-badge {
    background: rgba(122, 81, 34, 0.12);
    border: 1px solid rgba(122, 81, 34, 0.18);
    color: #6a4315;
  }

  .selected-album-artist {
    font-size: calc(11px * var(--app-font-scale));
    line-height: 1.45;
    color: rgba(86, 56, 18, 0.82);
    font-style: italic;
  }

  .selected-album-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: calc(9px * var(--app-font-scale));
    line-height: 1.5;
    color: rgba(96, 63, 24, 0.8);
    font-family: "Courier New", monospace;
  }

  .selected-album-stats span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .selected-album-stats span::before {
    content: "•";
    color: rgba(120, 82, 31, 0.44);
  }

  .selected-album-stats span:first-child::before {
    content: "";
    display: none;
  }

  .selected-album-meta {
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.55;
    color: #6d4c23;
  }

  .sidebar-side-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 14px 12px;
    border-radius: 22px;
    background: linear-gradient(
      180deg,
      rgba(247, 238, 220, 0.98),
      rgba(237, 220, 191, 0.94)
    );
    border: 1px solid rgba(133, 98, 49, 0.14);
    box-shadow:
      inset 0 1px 0 rgba(255, 251, 244, 0.6),
      inset 0 -18px 24px rgba(158, 114, 57, 0.05),
      0 12px 22px rgba(98, 63, 22, 0.08);
  }

  .sidebar-side-head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sidebar-side-kicker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .sidebar-side-badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(136, 95, 45, 0.1);
    border: 1px solid rgba(136, 95, 45, 0.14);
    color: #6c481b;
    font-size: calc(8px * var(--app-font-scale));
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-family: "Courier New", monospace;
  }

  .sidebar-side-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: baseline;
    padding-bottom: 2px;
  }

  .side-chip {
    border: 1px solid rgba(124, 86, 38, 0.12);
    border-radius: 999px;
    padding: 7px 10px 6px;
    background: rgba(255, 248, 235, 0.72);
    color: #5a3a12;
    font-size: calc(9px * var(--app-font-scale));
    cursor: pointer;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    opacity: 0.72;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.44);
    font-family: "Courier New", monospace;
  }

  .side-chip:hover {
    opacity: 0.92;
  }

  .side-chip.active {
    color: #2f1c04;
    opacity: 1;
    background: linear-gradient(
      180deg,
      rgba(154, 111, 56, 0.18),
      rgba(255, 249, 239, 0.92)
    );
    border-color: rgba(124, 86, 38, 0.18);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.54),
      0 8px 14px rgba(100, 63, 22, 0.08);
  }

  .sidebar-track-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 10px 12px 4px;
    border-radius: 16px;
    background: repeating-linear-gradient(
        180deg,
        rgba(147, 108, 55, 0.06) 0,
        rgba(147, 108, 55, 0.06) 1px,
        transparent 1px,
        transparent 34px
      ),
      linear-gradient(
        180deg,
        rgba(250, 244, 230, 0.98),
        rgba(245, 234, 211, 0.94)
      );
    border: 1px solid rgba(137, 99, 47, 0.12);
    box-shadow:
      inset 0 1px 0 rgba(255, 251, 244, 0.82),
      inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  }

  .sidebar-track-list-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    padding: 0 0 8px;
    border-bottom: 1px solid rgba(124, 86, 38, 0.18);
    font-size: calc(8px * var(--app-font-scale));
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(108, 73, 31, 0.78);
    font-family: "Courier New", monospace;
  }

  .sidebar-track {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px dotted rgba(127, 98, 57, 0.2);
  }

  .sidebar-track.playing {
    padding-inline: 4px;
    margin-inline: -4px;
    border-bottom-color: rgba(94, 63, 24, 0.34);
    background: linear-gradient(
      90deg,
      rgba(156, 114, 58, 0.12),
      rgba(255, 248, 238, 0.28),
      rgba(156, 114, 58, 0.06)
    );
    border-radius: 8px;
  }

  .sidebar-track-num,
  .sidebar-track-duration {
    font-size: calc(9px * var(--app-font-scale));
    color: #8c6d42;
    font-family: "Courier New", monospace;
  }

  .sidebar-track-title {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #4a2e0c;
    font-size: calc(11px * var(--app-font-scale));
    line-height: 1.35;
  }

  .sidebar-track.playing .sidebar-track-title {
    color: #241300;
    font-weight: 700;
  }

  .side-helper {
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(252, 244, 230, 0.68);
    border: 1px dashed rgba(136, 95, 45, 0.18);
  }

  .title-editor {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .title-input {
    width: 100%;
    border: 1px solid rgba(127, 98, 57, 0.18);
    border-radius: 10px;
    padding: 12px;
    background: rgba(255, 251, 244, 0.86);
    color: #432a08;
    font: inherit;
  }

  .save-btn {
    padding: 0 14px;
    background: #3d6b53;
    color: #eef8f0;
    font-size: calc(12px * var(--app-font-scale));
    font-family: "Courier New", monospace;
  }

  .danger-btn,
  .danger-icon {
    background: rgba(164, 58, 43, 0.12);
    color: #9d3426;
  }

  .danger-btn {
    padding: 7px 10px;
    font-size: calc(11px * var(--app-font-scale));
  }

  .close-btn {
    align-self: flex-start;
  }

  .side-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 14px;
    background: rgba(255, 250, 242, 0.78);
    border: 1px solid rgba(133, 98, 49, 0.14);
  }

  .side-editor-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .side-editor-title {
    font-size: calc(14px * var(--app-font-scale));
    font-weight: 700;
    color: #3a2405;
  }

  .side-editor-meta,
  .editor-track-path {
    font-size: calc(10px * var(--app-font-scale));
    color: #8c6d42;
  }

  .editor-track-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .editor-track {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 10px;
    border-radius: 10px;
    background: rgba(233, 221, 199, 0.46);
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
    gap: 4px;
  }

  .editor-track-tools button {
    width: 28px;
    height: 28px;
    background: rgba(255, 251, 246, 0.9);
    color: #613c12;
    font-size: calc(12px * var(--app-font-scale));
    font-family: "Courier New", monospace;
  }

  .turntable-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 18px 16px;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .turntable-stage {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  @media (max-width: 1180px) {
    .studio {
      grid-template-columns: minmax(302px, 344px) minmax(0, 1fr);
    }

    .turntable-panel {
      padding: 18px 16px 14px;
    }
  }

  @media (max-width: 920px) {
    :global(body) {
      overflow: auto;
    }

    main {
      height: auto;
      min-height: 100vh;
    }

    main.desktop-overlay-shell .library-panel {
      padding-top: 0px;
    }

    .titlebar-drag-region {
      height: 44px;
    }

    .studio {
      grid-template-columns: 1fr;
      height: auto;
    }

    .library-panel {
      border-right: 0;
      border-bottom: 1px solid rgba(112, 76, 31, 0.18);
      min-height: 320px;
    }
    .library-panel.collapsed {
      min-height: auto;
      border-bottom: none;
      background: transparent;
      backdrop-filter: none;
    }
    .studio.collapsed-layout {
      grid-template-columns: 1fr;
    }

    .editor-drawer {
      padding: 20px 18px;
    }

    .turntable-stage {
      min-height: min(62vw, 520px);
    }

    .title-editor {
      grid-template-columns: 1fr;
    }

    .arranger-head {
      flex-direction: column;
      align-items: stretch;
    }

    .turntable-status-bar {
      justify-content: flex-start;
    }

    .panel-head {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
