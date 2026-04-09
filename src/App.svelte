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
    createLibraryAlbumFromPreparedImport,
    libraryAlbumToPlaybackAlbum,
    moveTrackWithinAlbum,
    removeTrackFromAlbum,
    renameLibraryAlbum,
    setLibraryAlbumCover,
    setLibraryAlbumDiscArt,
  } from "./lib/library/model";
  import {
    deleteLibraryAlbum,
    loadLibrary,
    saveLibraryAlbum,
  } from "./lib/library/persistence";
  import AlbumWorkshop from "./lib/library/AlbumWorkshop.svelte";
  import SidebarCrate from "./lib/library/SidebarCrate.svelte";
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
  let libraryPanelVisible = true;
  let pendingDeleteAlbumId: string | null = null;
  let pendingDeleteAlbumTitle = "";
  let activeView: "player" | "workshop" = "player";

  // ── 唱机切换动画状态 ──────────────────────────────────────────
  let turntableSwapAnim: 'idle' | 'swap' | 'flip' = 'idle';
  let turntableSwapFromCover: string | undefined = undefined;
  let turntableSwapToCover: string | undefined = undefined;
  let turntableSwapFromDiscArt: string | undefined = undefined;
  let turntableSwapToDiscArt: string | undefined = undefined;
  let turntableSwapFromSideLabel: string | undefined = undefined;
  let turntableSwapToSideLabel: string | undefined = undefined;
  let swapAnimTimer: ReturnType<typeof setTimeout> | null = null;
  let isSwitchingSide = false;

  const isDesktopApp = isDesktopRuntime();

  function onTitlebarMousedown(e: MouseEvent) {
    if (e.buttons === 1) {
      getCurrentWindow().startDragging();
    }
  }

  const PLATTER_SPINUP_MS = 2300;
  const TRANSPORT_STOP_MS = 1200;
  const TONEARM_CUE_MS = 1500;
  const TONEARM_SETTLE_PAUSE_MS = 110;
  const TONEARM_DROP_MS = 700;
  const TURNTABLE_SWAP_MS = 3000;
  const TURNTABLE_FLIP_MS = 1600;

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

  $: if ((selectedAlbum?.id ?? null) !== pendingDeleteAlbumId) {
    pendingDeleteAlbumId = null;
    pendingDeleteAlbumTitle = "";
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

  function triggerTurntableAnim(
    kind: 'swap' | 'flip',
    options: {
      fromCoverUrl?: string;
      toCoverUrl?: string;
      fromDiscArtUrl?: string;
      toDiscArtUrl?: string;
      fromSideLabel?: string;
      toSideLabel?: string;
    } = {},
  ) {
    if (swapAnimTimer) clearTimeout(swapAnimTimer);
    turntableSwapFromCover = options.fromCoverUrl;
    turntableSwapToCover = options.toCoverUrl;
    turntableSwapFromDiscArt = options.fromDiscArtUrl;
    turntableSwapToDiscArt = options.toDiscArtUrl;
    turntableSwapFromSideLabel = options.fromSideLabel;
    turntableSwapToSideLabel = options.toSideLabel;
    turntableSwapAnim = kind;
    const duration = kind === 'swap' ? TURNTABLE_SWAP_MS : TURNTABLE_FLIP_MS;
    swapAnimTimer = setTimeout(() => {
      turntableSwapAnim = 'idle';
      turntableSwapFromCover = undefined;
      turntableSwapToCover = undefined;
      turntableSwapFromDiscArt = undefined;
      turntableSwapToDiscArt = undefined;
      turntableSwapFromSideLabel = undefined;
      turntableSwapToSideLabel = undefined;
    }, duration);
  }

  async function stopTransportForTransition() {
    const wasPlaying = isPlaying;
    const wasActive = isPlaying || isPlatterSpinning || tonearmState !== "parked";

    cancelStartupSequence();
    if (isPlaying) {
      engine?.stop();
      isPlaying = false;
    }
    engine?.stopLeadInNoise();
    isPlatterSpinning = false;
    tonearmState = "parked";
    clearManualCueState();
    resetMusicMeter();

    if (wasActive) {
      await wait(TRANSPORT_STOP_MS);
    }

    return { wasPlaying, wasActive };
  }

  async function selectAlbumById(albumId: string) {
    if (selectedAlbumId === albumId) return;
    const previousAlbum = selectedAlbum;
    const targetAlbum = getAlbumById(albumId);
    const targetPlaybackAlbum = targetAlbum
      ? libraryAlbumToPlaybackAlbum(targetAlbum)
      : null;

    await stopTransportForTransition();

    triggerTurntableAnim('swap', {
      fromCoverUrl: previousAlbum?.coverUrl,
      toCoverUrl: targetAlbum?.coverUrl,
      fromDiscArtUrl: playbackAlbum?.discArtUrl,
      toDiscArtUrl: targetPlaybackAlbum?.discArtUrl,
      fromSideLabel: currentSide?.label,
      toSideLabel: targetPlaybackAlbum?.sides[0]?.label,
    });
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

  function requestDeleteCurrentAlbum() {
    if (!selectedAlbum) return;
    pendingDeleteAlbumId = selectedAlbum.id;
    pendingDeleteAlbumTitle = selectedAlbum.title;
  }

  function cancelDeleteCurrentAlbum() {
    pendingDeleteAlbumId = null;
    pendingDeleteAlbumTitle = "";
  }

  async function deleteCurrentAlbum() {
    if (!selectedAlbum) return;
    if (pendingDeleteAlbumId !== selectedAlbum.id) return;

    isSavingLibrary = true;
    loadError = "";

    try {
      const removedAlbumId = selectedAlbum.id;
      await deleteLibraryAlbum(removedAlbumId);
      libraryAlbums = libraryAlbums.filter(
        (album) => album.id !== removedAlbumId,
      );
      selectedAlbumId = libraryAlbums[0]?.id ?? null;
      cancelDeleteCurrentAlbum();
      await syncSelectedAlbumToPlayer(selectedAlbumId);
    } catch (err) {
      loadError = "删除失败：" + String(err);
      console.error(err);
    } finally {
      isSavingLibrary = false;
    }
  }

  function openWorkshop() {
    activeView = "workshop";
  }

  function closeWorkshop() {
    activeView = "player";
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string" && result.startsWith("data:")) {
          resolve(result);
          return;
        }
        reject(new Error("无法读取图片数据"));
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error("读取图片失败"));
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleCustomImageSelected(
    event: Event,
    options: {
      onSave: (album: LibraryAlbum, imageUrl: string) => LibraryAlbum;
      invalidTypeMessage: string;
      failedMessage: string;
    },
  ) {
    const album = selectedAlbum;
    if (!album) return;

    const input = event.currentTarget as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      loadError = options.invalidTypeMessage;
      if (input) input.value = "";
      return;
    }

    try {
      const imageUrl = await readFileAsDataUrl(file);
      await persistAlbum(options.onSave(album, imageUrl));
    } catch (err) {
      loadError = options.failedMessage + String(err);
      console.error(err);
    } finally {
      if (input) input.value = "";
    }
  }

  async function handleCustomCoverSelected(event: Event) {
    await handleCustomImageSelected(event, {
      onSave: (album, imageUrl) => setLibraryAlbumCover(album, imageUrl),
      invalidTypeMessage: "封面导入失败：请选择图片文件",
      failedMessage: "封面导入失败：",
    });
  }

  async function clearCustomCover() {
    if (!selectedAlbum) return;
    await persistAlbum(setLibraryAlbumCover(selectedAlbum));
  }

  async function handleCustomDiscArtSelected(event: Event) {
    await handleCustomImageSelected(event, {
      onSave: (album, imageUrl) => setLibraryAlbumDiscArt(album, imageUrl),
      invalidTypeMessage: "盘面图导入失败：请选择图片文件",
      failedMessage: "盘面图导入失败：",
    });
  }

  async function clearCustomDiscArt() {
    if (!selectedAlbum) return;
    await persistAlbum(setLibraryAlbumDiscArt(selectedAlbum));
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
    if (isSwitchingSide) return;
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
    if (isSwitchingSide) return;
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
    if (isSwitchingSide) return;
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
    if (isSwitchingSide) return;
    if (!engine || !currentSide) return;
    currentTime = timeInSide;
    if (isPlaying) {
      await engine.playWithOptions(timeInSide, { keepNoise: true });
    }
  }

  async function switchSide(index: number) {
    if (!playbackAlbum || !engine || isSwitchingSide) return;
    if (index < 0 || index >= playbackAlbum.sides.length) return;
    if (index === currentSideIndex) return;

    const currentSideRef = playbackAlbum.sides[currentSideIndex];
    const targetSideRef = playbackAlbum.sides[index];
    const currentDiscIdx = currentSideRef?.discIndex ?? -1;
    const targetDiscIdx  = targetSideRef?.discIndex ?? -2;
    const isSameDisc = currentDiscIdx === targetDiscIdx;
    const animKind: 'swap' | 'flip' = isSameDisc ? 'flip' : 'swap';
    const animDuration = animKind === "flip" ? TURNTABLE_FLIP_MS : TURNTABLE_SWAP_MS;

    isSwitchingSide = true;
    isLoading = true;

    try {
      const { wasPlaying } = await stopTransportForTransition();

      triggerTurntableAnim(animKind, {
        fromCoverUrl: selectedAlbum?.coverUrl,
        toCoverUrl: selectedAlbum?.coverUrl,
        fromDiscArtUrl: playbackAlbum?.discArtUrl,
        toDiscArtUrl: playbackAlbum?.discArtUrl,
        fromSideLabel: currentSideRef?.label,
        toSideLabel: targetSideRef?.label,
      });

      await Promise.all([
        engine.loadSide(targetSideRef),
        wait(animDuration),
      ]);

      currentSideIndex = index;
      currentTime = 0;

      if (wasPlaying) {
        await beginPlaybackSequence();
      }
    } finally {
      isLoading = false;
      isSwitchingSide = false;
    }
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
  <div
    class="studio"
    class:collapsed-layout={!libraryPanelVisible}
  >
    <aside class="library-panel" class:collapsed={!libraryPanelVisible}>
      {#if libraryPanelVisible}
        <div class="library-shell">
          <div class="panel-head library-marquee">
            <div class="panel-title-block">
              <div class="eyebrow">LOFI VINYL LIBRARY</div>
              <h1 class="panel-title">LOFYL</h1>
            </div>

            <div class="panel-toolbar" aria-label="曲库控制">
              <button
                class="text-action"
                type="button"
                on:click={openWorkshop}
              >
                制作专辑
              </button>

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

          {#if activeView === "player" && loadError}
            <p class="error">{loadError}</p>
          {/if}

          <section class="section sidebar-crate-section">
            {#if libraryAlbums.length === 0}
              <p class="empty-state">先打开“制作专辑”，导入一张专辑。</p>
            {:else}
              <SidebarCrate
                albums={libraryAlbums}
                {selectedAlbumId}
                onSelect={(albumId) => void selectAlbumById(albumId)}
              />
            {/if}
          </section>

          {#if selectedAlbum}
            <section class="section library-section now-playing-section">
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
                        disabled={isSwitchingSide}
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
                        class:playing={isCurrentTrack(currentSide, index, currentTime)}
                      >
                        <span class="sidebar-track-num">{String(index + 1).padStart(2, "0")}</span>
                        <span class="sidebar-track-title">{track.title}</span>
                        <span class="sidebar-track-duration">{formatTime(track.duration)}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {:else}
                <p class="helper side-helper">当前专辑还没有可播放的盘面。</p>
              {/if}
            </section>
          {/if}
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
    </aside>

    <section class="main-panel" class:workshop-mode={activeView === "workshop"}>
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

      {#if activeView === "workshop"}
        <AlbumWorkshop
          album={selectedAlbum}
          {playbackAlbum}
          bind:albumTitleDraft
          {isDesktopApp}
          isBusy={isLoading || isSavingLibrary}
          {loadError}
          {pendingDeleteAlbumId}
          {pendingDeleteAlbumTitle}
          onBack={closeWorkshop}
          onSaveTitle={() => void saveCurrentAlbumTitle()}
          onImport={(kind, target) => void importAlbum(kind, target)}
          onRequestDelete={requestDeleteCurrentAlbum}
          onCancelDelete={cancelDeleteCurrentAlbum}
          onDelete={() => void deleteCurrentAlbum()}
          onMoveTrack={(sideIndex, trackIndex, direction) =>
            void moveTrack(sideIndex, trackIndex, direction)}
          onRemoveTrack={(sideIndex, trackIndex) =>
            void removeTrack(sideIndex, trackIndex)}
          onCoverSelected={(event) => void handleCustomCoverSelected(event)}
          onClearCover={() => void clearCustomCover()}
          onDiscArtSelected={(event) => void handleCustomDiscArtSelected(event)}
          onClearDiscArt={() => void clearCustomDiscArt()}
        />
      {:else}
        <div class="turntable-stage">
          <Turntable
            side={currentSide}
            {currentTime}
            {isPlaying}
            {isPlatterSpinning}
            {tonearmState}
            {musicMeterLevels}
            {isSpectrumEnabled}
            discArtworkUrl={playbackAlbum?.discArtUrl}
            artworkMode={discArtworkMode}
            swapAnim={turntableSwapAnim}
            swapFromCoverUrl={turntableSwapFromCover}
            swapToCoverUrl={turntableSwapToCover}
            swapFromDiscArtworkUrl={turntableSwapFromDiscArt}
            swapToDiscArtworkUrl={turntableSwapToDiscArt}
            swapFromSideLabel={turntableSwapFromSideLabel}
            swapToSideLabel={turntableSwapToSideLabel}
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
      {/if}
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

  main.desktop-overlay-shell .main-panel {
    padding: 44px 0 0;
    gap: 0;
    border-radius: 0 10px 10px 0;
  }

  main.desktop-overlay-shell .turntable-status-bar {
    top: 10px;
    right: 18px;
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

  .library-shell {
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

  .library-shell::-webkit-scrollbar {
    width: 7px;
  }

  .library-shell::-webkit-scrollbar-track {
    background: transparent;
  }

  .library-shell::-webkit-scrollbar-thumb {
    background: rgba(112, 79, 37, 0.24);
    border-radius: 999px;
    border: 1px solid rgba(255, 247, 233, 0.36);
  }

  .library-shell::-webkit-scrollbar-thumb:hover {
    background: rgba(112, 79, 37, 0.38);
  }

  .panel-head {
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
    position: absolute;
    top: 18px;
    right: 18px;
    z-index: 3;
    pointer-events: none;
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


  .helper,
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

  .sidebar-crate-section {
    padding-top: 0;
    border-top: none;
  }


  .side-helper {
    padding: 6px 0 0;
    border-top: 1px solid rgba(108, 76, 36, 0.14);
  }

  .main-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 18px 16px;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    transition:
      filter 0.24s ease,
      transform 0.24s ease,
      opacity 0.24s ease;
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

    .main-panel {
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

    .turntable-stage {
      min-height: min(62vw, 520px);
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
