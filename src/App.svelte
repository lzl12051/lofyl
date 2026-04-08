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
    targetEngine.setSpectrumBandCount(MUSIC_METER_BANDS);
    targetEngine.onTimeUpdate = (time) => {
      currentTime = time;
    };
    targetEngine.onSpectrumUpdate = (levels) => {
      musicMeterLevels = levels;
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

  async function saveCurrentAlbumTitleAndClose() {
    await saveCurrentAlbumTitle();
    closeEditor();
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
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="titlebar-drag-region" on:mousedown={onTitlebarMousedown}></div>
  {/if}
  <div class="studio" class:collapsed-layout={!libraryPanelVisible}>
    <aside class="library-panel" class:collapsed={!libraryPanelVisible}>
      {#if libraryPanelVisible}
        <div class="library-shell">
          <div class="panel-head library-marquee">
            <div class="panel-title-block">
              <div class="eyebrow">LOFI VINYL LIBRARY</div>
              <h1 class="panel-title">LOFYL</h1>
            </div>

            <div class="panel-toolbar" aria-label="导入新专辑与曲库控制">
              {#if isDesktopApp}
                <button
                  class="text-action"
                  type="button"
                  on:click={() => void importAlbum("files", "new")}
                >
                  导入文件
                </button>
                <button
                  class="text-action"
                  type="button"
                  on:click={() => void importAlbum("folder", "new")}
                >
                  导入文件夹
                </button>
              {/if}

              {#if selectedAlbum}
                <button class="text-action" type="button" on:click={openEditor}>
                  编辑
                </button>
              {/if}

              <button
                class="toggle-library-btn"
                type="button"
                on:click={toggleLibraryPanel}
                aria-label="切换库面板"
              >
                收起
              </button>
            </div>
          </div>

          {#if loadError}
            <p class="error">{loadError}</p>
          {/if}

          <section class="section library-section now-playing-section">
            {#if selectedAlbum}
              <div class="section-head">
                <span class="section-label">当前专辑</span>
              </div>

              <div class="selected-album-sheet">
                {#if selectedAlbum.coverUrl}
                  <img
                    class="selected-album-cover"
                    src={selectedAlbum.coverUrl}
                    alt={`${selectedAlbum.title} 封面`}
                  />
                {/if}

                <div class="selected-album-copy">
                  <div class="selected-album-title">{selectedAlbum.title}</div>
                  <div class="selected-album-artist">
                    {selectedAlbum.artist || "未署名艺人"}
                  </div>
                  <div class="selected-album-stats">
                    <span
                      >{playbackAlbum?.discs ?? Math.ceil(selectedAlbum.sides.length / 2)} 张碟</span
                    >
                    <span>{playbackAlbum?.sides.length ?? selectedAlbum.sides.length} 面</span>
                    <span>{countAlbumTracks(selectedAlbum)} 首</span>
                    <span>{formatTime(getAlbumDuration(selectedAlbum))}</span>
                  </div>

                  <div class="selected-album-actions">
                    <button class="text-action" type="button" on:click={openEditor}>
                      编辑专辑
                    </button>
                    {#if isDesktopApp}
                      <button
                        class="text-action"
                        type="button"
                        on:click={() => void importAlbum("files", "current")}
                      >
                        追加文件
                      </button>
                    {/if}
                  </div>
                </div>
              </div>

              {#if playbackAlbum && currentSide}
                <div class="side-sheet">
                  <div class="side-sheet-head">
                    <div class="section-label">当前盘面</div>
                    <div class="selected-album-meta">
                      Side {currentSide.label} · {currentSide.tracks.length} 首 ·
                      {formatTime(currentSide.totalDuration)}
                    </div>
                  </div>

                  <div class="sidebar-side-picker" aria-label="切换盘面">
                    {#each playbackAlbum.sides as side, index}
                      <button
                        class="side-link"
                        class:active={index === currentSideIndex}
                        type="button"
                        on:click={() => void switchSide(index)}
                        aria-current={index === currentSideIndex ? "true" : undefined}
                      >
                        {side.label}
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
            {:else}
              <p class="empty-state">先导入一张专辑。</p>
            {/if}
          </section>

          <section class="section library-section catalog-section">
            <div class="section-head catalog-head">
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
                    <span class="album-card-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span class="album-card-copy">
                      <span class="album-card-title">{item.title}</span>
                      <span class="album-card-meta">
                        {pb.discs} 张碟 · {pb.sides.length} 面 · {countAlbumTracks(item)} 首
                      </span>
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </section>
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
            <div class="drawer-title-block">
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
              class="text-action close-btn"
              type="button"
              on:click={closeEditor}
            >
              收起
            </button>
          </div>

          <div class="title-editor">
            <label class="title-editor-label" for="album-title-input">
              标题
            </label>
            <div class="title-editor-field">
              <input
                id="album-title-input"
                class="title-input"
                bind:value={albumTitleDraft}
                placeholder="专辑名称"
                on:blur={() => void saveCurrentAlbumTitle()}
              />
              <button
                class="save-btn"
                type="button"
                on:click={() => void saveCurrentAlbumTitleAndClose()}
              >
                保存
              </button>
            </div>
          </div>

          {#if isDesktopApp}
            <div class="drawer-actions">
              <button
                class="text-action"
                type="button"
                on:click={() => void importAlbum("files", "current")}
              >
                追加文件到当前专辑
              </button>
              <button
                class="text-action"
                type="button"
                on:click={() => void importAlbum("folder", "current")}
              >
                追加文件夹到当前专辑
              </button>
              <button
                class="text-action danger-btn"
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
                            class="editor-track-tool"
                            type="button"
                            on:click={() =>
                              void moveTrack(sideIndex, trackIndex, "up")}
                          >
                            ↑
                          </button>
                          <button
                            class="editor-track-tool"
                            type="button"
                            on:click={() =>
                              void moveTrack(sideIndex, trackIndex, "down")}
                          >
                            ↓
                          </button>
                          <button
                            class="editor-track-tool"
                            type="button"
                            disabled={sideIndex === 0}
                            on:click={() =>
                              void moveTrack(sideIndex, trackIndex, "left")}
                          >
                            ←
                          </button>
                          <button
                            class="editor-track-tool"
                            type="button"
                            on:click={() =>
                              void moveTrack(sideIndex, trackIndex, "right")}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            class="editor-track-tool danger-icon"
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
        rgba(255, 245, 221, 0.82),
        transparent 34%
      ),
      linear-gradient(135deg, #ece2cf 0%, #dbc8a8 46%, #c6ae86 100%);
    color: #2e1e0a;
    font-family: Georgia, "Times New Roman", serif;
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

  main.desktop-overlay-shell .editor-drawer {
    padding-top: 72px;
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
    grid-template-columns: minmax(288px, 320px) minmax(0, 1fr);
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
    padding: 20px 14px 14px 12px;
    border-right: 1px solid rgba(99, 68, 30, 0.18);
    background:
      linear-gradient(180deg, rgba(253, 249, 241, 0.94), rgba(239, 226, 201, 0.92)),
      repeating-linear-gradient(
        180deg,
        rgba(132, 95, 43, 0.03) 0,
        rgba(132, 95, 43, 0.03) 1px,
        transparent 1px,
        transparent 32px
      );
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    box-shadow:
      inset -1px 0 0 rgba(85, 57, 24, 0.12),
      12px 0 28px rgba(83, 53, 22, 0.08);
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
    gap: 18px;
    min-width: 0;
    min-height: 0;
  }

  .library-shell {
    height: 100%;
    overflow-y: auto;
    gap: 18px;
    padding-right: 8px;
    scrollbar-width: thin;
    scrollbar-color: rgba(126, 94, 47, 0.28) transparent;
  }

  .editor-drawer {
    position: absolute;
    inset: 0;
    z-index: 2;
    padding: 22px 16px 18px 14px;
    overflow-y: auto;
    background:
      linear-gradient(180deg, rgba(253, 249, 241, 0.98), rgba(242, 229, 204, 0.99)),
      repeating-linear-gradient(
        180deg,
        rgba(132, 95, 43, 0.03) 0,
        rgba(132, 95, 43, 0.03) 1px,
        transparent 1px,
        transparent 30px
      );
    box-shadow: 12px 0 28px rgba(84, 52, 18, 0.12);
    scrollbar-width: thin;
    scrollbar-color: rgba(126, 94, 47, 0.28) transparent;
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
    background: rgba(112, 79, 37, 0.24);
    border-radius: 999px;
    border: 1px solid rgba(255, 247, 233, 0.36);
  }

  .library-shell::-webkit-scrollbar-thumb:hover,
  .editor-drawer::-webkit-scrollbar-thumb:hover {
    background: rgba(112, 79, 37, 0.38);
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
    gap: 8px;
    padding: 0 0 16px;
    border-bottom: 1px solid rgba(108, 76, 36, 0.24);
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
    letter-spacing: 0.24em;
    color: #86663a;
    text-transform: uppercase;
    font-family: "Courier New", monospace;
  }

  .panel-title {
    font-size: calc(16px * var(--app-font-scale));
    line-height: 1.1;
    color: #241507;
    font-weight: 700;
  }

  .panel-title-block {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .panel-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    padding-top: 2px;
  }

  .status-pill {
    white-space: nowrap;
    border: 1px solid rgba(126, 94, 47, 0.22);
    border-radius: 999px;
    padding: 5px 9px;
    background: rgba(255, 250, 240, 0.52);
    color: #71562e;
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.08em;
    font-family: "Courier New", monospace;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-label {
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #846337;
    font-family: "Courier New", monospace;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .text-action,
  .toggle-library-btn {
    border: 0;
    padding: 0;
    background: transparent;
    color: #5b3a12;
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      color 0.14s ease,
      opacity 0.14s ease;
    font-family: "Courier New", monospace;
    text-decoration: none;
  }

  .text-action:hover,
  .toggle-library-btn:hover {
    color: #2b1905;
  }

  .text-action:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .toggle-library-btn {
    margin-left: auto;
  }

  .collapsed-toggle-btn {
    writing-mode: vertical-rl;
    letter-spacing: 0.18em;
    margin-left: 0;
    padding-top: 8px;
  }

  .library-section {
    padding-top: 14px;
    border-top: 1px solid rgba(108, 76, 36, 0.18);
  }

  .now-playing-section {
    padding-top: 0;
    border-top: none;
  }

  .helper,
  .drawer-title,
  .arranger-meta,
  .empty-state {
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.6;
    color: #7d5f36;
  }

  .error {
    color: #9e3225;
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.55;
    padding: 10px 0 0;
  }

  .selected-album-sheet {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px;
    align-items: start;
  }

  .selected-album-cover {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border: 1px solid rgba(98, 69, 31, 0.12);
    filter: saturate(0.82) contrast(0.94);
    box-shadow: 0 4px 14px rgba(89, 56, 22, 0.08);
  }

  .selected-album-copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .selected-album-title,
  .drawer-title {
    font-size: calc(15px * var(--app-font-scale));
    font-weight: 700;
    color: #2c1905;
    letter-spacing: 0.01em;
    line-height: 1.2;
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
    gap: 8px 10px;
    font-size: calc(9px * var(--app-font-scale));
    line-height: 1.6;
    color: rgba(95, 62, 23, 0.8);
    font-family: "Courier New", monospace;
  }

  .selected-album-stats span::after {
    content: "/";
    margin-left: 10px;
    color: rgba(109, 75, 34, 0.38);
  }

  .selected-album-stats span:last-child::after {
    display: none;
  }

  .selected-album-actions,
  .drawer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }

  .selected-album-actions {
    padding-top: 6px;
  }

  .selected-album-meta {
    font-size: calc(9px * var(--app-font-scale));
    line-height: 1.5;
    color: #6f4f26;
    font-family: "Courier New", monospace;
  }

  .side-sheet {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 14px;
    border-top: 1px solid rgba(108, 76, 36, 0.14);
  }

  .side-sheet-head {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .sidebar-side-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    padding: 2px 0 6px;
  }

  .side-link {
    border: 0;
    padding: 0 0 2px;
    background: transparent;
    color: rgba(92, 60, 23, 0.56);
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-family: "Courier New", monospace;
    cursor: pointer;
    border-bottom: 1px solid transparent;
    transition:
      color 0.14s ease,
      border-color 0.14s ease;
  }

  .side-link:hover {
    color: #553712;
  }

  .side-link.active {
    color: #2b1702;
    border-color: rgba(92, 60, 23, 0.72);
  }

  .sidebar-track-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid rgba(110, 79, 39, 0.2);
    border-bottom: 1px solid rgba(110, 79, 39, 0.16);
  }

  .sidebar-track-list-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    padding: 7px 0 8px;
    border-bottom: 1px solid rgba(124, 86, 38, 0.18);
    font-size: calc(8px * var(--app-font-scale));
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(108, 73, 31, 0.78);
    font-family: "Courier New", monospace;
  }

  .sidebar-track {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 9px 0;
    border-bottom: 1px dotted rgba(127, 98, 57, 0.22);
    position: relative;
  }

  .sidebar-track.playing {
    border-bottom-color: rgba(94, 63, 24, 0.34);
  }

  .sidebar-track.playing::before {
    content: "";
    position: absolute;
    left: -10px;
    top: 7px;
    bottom: 7px;
    width: 2px;
    background: rgba(95, 61, 20, 0.72);
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

  .album-list,
  .side-editor-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
  }

  .catalog-head {
    align-items: baseline;
  }

  .catalog-count {
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.12em;
    color: rgba(96, 63, 24, 0.76);
    text-transform: uppercase;
    font-family: "Courier New", monospace;
  }

  .album-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    padding: 10px 0 11px 12px;
    border: 0;
    border-top: 1px solid rgba(108, 76, 36, 0.16);
    background: transparent;
    color: #4c3210;
    text-align: left;
    cursor: pointer;
    transition: color 0.14s ease;
    position: relative;
  }

  .album-card:first-child {
    border-top: 1px solid rgba(108, 76, 36, 0.2);
  }

  .album-card:hover {
    color: #2b1905;
  }

  .album-card.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 9px;
    bottom: 9px;
    width: 2px;
    background: rgba(96, 63, 24, 0.76);
  }

  .album-card-index {
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
    font-size: calc(11px * var(--app-font-scale));
    font-weight: 700;
    line-height: 1.25;
  }

  .album-card.active .album-card-title {
    color: #2a1703;
  }

  .album-card-meta {
    font-size: calc(9px * var(--app-font-scale));
    line-height: 1.5;
    color: rgba(87, 57, 20, 0.76);
  }

  .side-helper {
    padding: 6px 0 0;
    border-top: 1px solid rgba(108, 76, 36, 0.14);
  }

  .title-editor {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px 14px;
    align-items: start;
    padding: 6px 0 14px;
    border-bottom: 1px solid rgba(108, 76, 36, 0.16);
  }

  .title-editor-label {
    padding-top: 10px;
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #846337;
    font-family: "Courier New", monospace;
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
    padding: 8px 0 7px;
    background: transparent;
    color: #432a08;
    font: inherit;
  }

  .title-input:focus {
    outline: none;
    border-bottom-color: rgba(93, 63, 26, 0.6);
  }

  .save-btn {
    border: 0;
    padding: 8px 0 7px;
    background: transparent;
    color: #3c5e49;
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-family: "Courier New", monospace;
    cursor: pointer;
  }

  .danger-btn,
  .danger-icon {
    color: #933122;
  }

  .close-btn {
    align-self: flex-start;
  }

  .drawer-title-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .drawer-actions {
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(108, 76, 36, 0.16);
  }

  .side-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 0 0;
    border-top: 1px solid rgba(108, 76, 36, 0.16);
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
    gap: 0;
    min-width: 0;
  }

  .editor-track {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
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
    border: 0;
    padding: 0;
    background: transparent;
    color: #613c12;
    font-size: calc(11px * var(--app-font-scale));
    font-family: "Courier New", monospace;
    cursor: pointer;
    transition: color 0.14s ease;
  }

  .editor-track-tool:hover {
    color: #2b1702;
  }

  .editor-track-tool:disabled {
    opacity: 0.34;
    cursor: default;
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
      grid-template-columns: minmax(272px, 300px) minmax(0, 1fr);
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

    main.desktop-overlay-shell .editor-drawer {
      padding-top: 20px;
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
      gap: 8px;
    }

    .title-editor-field {
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

    .selected-album-sheet {
      grid-template-columns: 1fr;
    }
  }
</style>
