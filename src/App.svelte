<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { quintOut } from "svelte/easing";
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
    countAlbumTracks,
    getAlbumDuration,
  } from "./lib/library/model";
  import {
    deleteLibraryAlbum,
    getRecentlyPlayed,
    loadLibrary,
    recordAlbumPlay,
    saveLibraryAlbum,
    toggleFavoriteAlbum,
  } from "./lib/library/persistence";
  import AlbumWorkshop from "./lib/library/AlbumWorkshop.svelte";
  import Stage from "./lib/cabinet/Stage.svelte";
  import Cabinet from "./lib/cabinet/Cabinet.svelte";
  import Console from "./lib/cabinet/Console.svelte";
  import CabinetShelf from "./lib/cabinet/CabinetShelf.svelte";
  import CategoryManager from "./lib/cabinet/CategoryManager.svelte";
  import { setAlbumCategories } from "./lib/library/model";
  import { VinylEngine } from "./lib/audio/vinylEngine";
  import type {
    Album,
    DiscArtworkMode,
    DiscSide,
    LibraryAlbum,
    TonearmState,
  } from "./lib/types";

  let libraryAlbums: LibraryAlbum[] = [];
  let recentAlbumIds: string[] = [];

  $: favoriteAlbumIds = new Set(libraryAlbums.filter((a) => a.isFavorite).map((a) => a.id));

  async function toggleFavorite(albumId: string) {
    const nextFav = await toggleFavoriteAlbum(albumId);
    libraryAlbums = libraryAlbums.map((a) =>
      a.id === albumId ? { ...a, isFavorite: nextFav } : a,
    );
  }

  let selectedAlbumId: string | null = null;
  let playbackAlbum: Album | null = null;
  let engine: VinylEngine | null = null;
  let currentSideIndex = 0;
  let currentTime = 0;
  let isPlaying = false;
  let isPlatterSpinning = false;
  let platterBrakeRate = 1;
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
  let pendingDeleteAlbumId: string | null = null;
  let pendingDeleteAlbumTitle = "";
  let activeView: "player" | "workshop" = "player";
  let workshopMode: "home" | "import" | "edit" = "home";
  let workshopAlbumId: string | null = null;
  let categoryManagerOpen = false;

  // ── 分类相关 ──────────────────────────────────────────────────
  $: availableCategories = [
    ...new Set(libraryAlbums.flatMap((a) => a.categories ?? [])),
  ].sort((a, b) => a.localeCompare(b, 'zh'));

  async function handleCategoriesChange(albumId: string, categories: string[]) {
    const album = libraryAlbums.find((a) => a.id === albumId);
    if (!album) return;
    await persistAlbum(setAlbumCategories(album, categories), {
      selectForWorkshop: albumId === workshopAlbumId,
    });
  }

  async function handleRenameCategory(oldName: string, newName: string) {
    const affected = libraryAlbums.filter((a) => (a.categories ?? []).includes(oldName));
    for (const album of affected) {
      const updated = setAlbumCategories(album, [
        ...(album.categories ?? []).filter((c) => c !== oldName),
        newName,
      ]);
      await persistAlbum(updated);
    }
  }

  async function handleDeleteCategory(name: string) {
    const affected = libraryAlbums.filter((a) => (a.categories ?? []).includes(name));
    for (const album of affected) {
      await persistAlbum(setAlbumCategories(album, (album.categories ?? []).filter((c) => c !== name)));
    }
  }

  async function handleRemoveAlbumFromCategory(albumId: string, category: string) {
    const album = libraryAlbums.find((a) => a.id === albumId);
    if (!album) return;
    await persistAlbum(setAlbumCategories(album, (album.categories ?? []).filter((c) => c !== category)));
  }

  const VOLUME_STORAGE_KEY = "lofi-vinyl:volume";
  function loadStoredVolume(): number {
    try {
      const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (raw === null) return 0.8;
      const v = Number(raw);
      if (!Number.isFinite(v)) return 0.8;
      return Math.max(0, Math.min(1, v));
    } catch {
      return 0.8;
    }
  }
  let volume = loadStoredVolume();
  function handleVolumeChange(v: number) {
    volume = v;
    engine?.setOutputGain(v);
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(v));
    } catch {}
  }

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
  $: workshopAlbum =
    libraryAlbums.find((album) => album.id === workshopAlbumId) ??
    (workshopMode === "edit" ? selectedAlbum : null);
  $: currentSide = playbackAlbum?.sides[currentSideIndex] ?? null;
  $: isTransportActive =
    isPlaying ||
    isPlatterSpinning ||
    tonearmState === "cueing" ||
    tonearmState === "dropping" ||
    tonearmState === "holding";

  $: if ((workshopAlbum?.id ?? null) !== titleDraftAlbumId) {
    albumTitleDraft = workshopAlbum?.title ?? "";
    titleDraftAlbumId = workshopAlbum?.id ?? null;
  }

  $: if ((workshopAlbum?.id ?? null) !== pendingDeleteAlbumId) {
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

  function replaceAlbum(
    updatedAlbum: LibraryAlbum,
    options: { selectForPlayback?: boolean; selectForWorkshop?: boolean } = {},
  ) {
    const otherAlbums = libraryAlbums.filter(
      (album) => album.id !== updatedAlbum.id,
    );
    libraryAlbums = sortAlbums([updatedAlbum, ...otherAlbums]);
    if (options.selectForPlayback) {
      selectedAlbumId = updatedAlbum.id;
    }
    if (options.selectForWorkshop) {
      workshopAlbumId = updatedAlbum.id;
    }
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
    platterBrakeRate = 1;
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
    engine.setOutputGain(volume);
    bindEngineCallbacks(engine);
    await engine.loadSide(playbackAlbum.sides[0]);
  }

  async function loadPersistedLibrary() {
    if (!isDesktopApp) return;

    isLoading = true;
    loadError = "";

    try {
      [libraryAlbums, recentAlbumIds] = await Promise.all([
        loadLibrary().then(sortAlbums),
        getRecentlyPlayed(),
      ]);
      selectedAlbumId = libraryAlbums[0]?.id ?? null;
      await syncSelectedAlbumToPlayer(selectedAlbumId);
    } catch (err) {
      loadError = "加载曲库失败：" + String(err);
      console.error(err);
    } finally {
      isLoading = false;
    }
  }

  async function persistAlbum(
    updatedAlbum: LibraryAlbum,
    options: { selectForPlayback?: boolean; selectForWorkshop?: boolean } = {},
  ) {
    isSavingLibrary = true;
    loadError = "";

    try {
      const shouldSyncPlayback =
        options.selectForPlayback === true || updatedAlbum.id === selectedAlbumId;
      const savedAlbum = await saveLibraryAlbum(updatedAlbum);
      replaceAlbum(savedAlbum, options);
      if (shouldSyncPlayback) {
        await syncSelectedAlbumToPlayer(savedAlbum.id);
      }
      return savedAlbum;
    } catch (err) {
      loadError = "保存失败：" + String(err);
      console.error(err);
      return null;
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

      if (target === "new" || !workshopAlbum) {
        const savedAlbum = await persistAlbum(
          createLibraryAlbumFromPreparedImport(prepared),
          { selectForPlayback: true, selectForWorkshop: true },
        );
        if (savedAlbum) {
          workshopMode = "edit";
        }
      } else {
        await persistAlbum(
          appendPreparedImportToAlbum(workshopAlbum, prepared),
          { selectForWorkshop: true },
        );
        workshopMode = "edit";
      }
    } catch (err) {
      loadError = "导入失败：" + String(err);
      console.error(err);
    } finally {
      isLoading = false;
    }
  }

  async function saveCurrentAlbumTitle() {
    if (!workshopAlbum) return;

    const trimmedTitle = albumTitleDraft.trim();
    if (!trimmedTitle || trimmedTitle === workshopAlbum.title) {
      albumTitleDraft = workshopAlbum.title;
      return;
    }

    await persistAlbum(renameLibraryAlbum(workshopAlbum, trimmedTitle), {
      selectForWorkshop: true,
    });
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

  async function playAlbumById(albumId: string) {
    if (isSwitchingSide || isTransportActive) return;
    if (selectedAlbumId !== albumId) {
      await selectAlbumById(albumId);
    }
    if (!engine || !currentSide || isTransportActive) return;
    await beginPlaybackSequence();
    void recordAlbumPlay(albumId).then(() => {
      recentAlbumIds = [albumId, ...recentAlbumIds.filter((id) => id !== albumId)];
    });
  }

  async function moveTrack(
    sideIndex: number,
    trackIndex: number,
    direction: "up" | "down" | "left" | "right",
  ) {
    if (!workshopAlbum) return;
    await persistAlbum(
      moveTrackWithinAlbum(workshopAlbum, sideIndex, trackIndex, direction),
      { selectForWorkshop: true },
    );
  }

  async function removeTrack(sideIndex: number, trackIndex: number) {
    if (!workshopAlbum) return;
    await persistAlbum(
      removeTrackFromAlbum(workshopAlbum, sideIndex, trackIndex),
      { selectForWorkshop: true },
    );
  }

  function requestDeleteCurrentAlbum() {
    if (!workshopAlbum) return;
    pendingDeleteAlbumId = workshopAlbum.id;
    pendingDeleteAlbumTitle = workshopAlbum.title;
  }

  function cancelDeleteCurrentAlbum() {
    pendingDeleteAlbumId = null;
    pendingDeleteAlbumTitle = "";
  }

  async function deleteCurrentAlbum() {
    if (!workshopAlbum) return;
    if (pendingDeleteAlbumId !== workshopAlbum.id) return;

    isSavingLibrary = true;
    loadError = "";

    try {
      const removedAlbumId = workshopAlbum.id;
      await deleteLibraryAlbum(removedAlbumId);
      libraryAlbums = libraryAlbums.filter(
        (album) => album.id !== removedAlbumId,
      );
      if (selectedAlbumId === removedAlbumId) {
        selectedAlbumId = libraryAlbums[0]?.id ?? null;
        await syncSelectedAlbumToPlayer(selectedAlbumId);
      }
      workshopAlbumId = libraryAlbums[0]?.id ?? null;
      workshopMode = "home";
      cancelDeleteCurrentAlbum();
    } catch (err) {
      loadError = "删除失败：" + String(err);
      console.error(err);
    } finally {
      isSavingLibrary = false;
    }
  }

  function openWorkshop(
    mode: "home" | "import" | "edit" = "home",
    albumId: string | null = selectedAlbumId,
  ) {
    workshopMode = mode;
    workshopAlbumId = mode === "edit" ? albumId : null;
    activeView = "workshop";
  }

  function closeWorkshop() {
    activeView = "player";
  }

  function selectWorkshopAlbum(albumId: string) {
    workshopAlbumId = albumId;
    workshopMode = "edit";
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (categoryManagerOpen) { categoryManagerOpen = false; return; }
    if (activeView === "workshop") { closeWorkshop(); return; }
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
    const album = workshopAlbum;
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
      await persistAlbum(options.onSave(album, imageUrl), {
        selectForWorkshop: true,
      });
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
    if (!workshopAlbum) return;
    await persistAlbum(setLibraryAlbumCover(workshopAlbum), {
      selectForWorkshop: true,
    });
  }

  async function handleCustomDiscArtSelected(event: Event) {
    await handleCustomImageSelected(event, {
      onSave: (album, imageUrl) => setLibraryAlbumDiscArt(album, imageUrl),
      invalidTypeMessage: "盘面图导入失败：请选择图片文件",
      failedMessage: "盘面图导入失败：",
    });
  }

  async function clearCustomDiscArt() {
    if (!workshopAlbum) return;
    await persistAlbum(setLibraryAlbumDiscArt(workshopAlbum), {
      selectForWorkshop: true,
    });
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
    platterBrakeRate = 1;
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
      platterBrakeRate = 1;
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

  function handlePlatterBrakeRateChange(rate: number) {
    platterBrakeRate = Math.max(0, Math.min(1, rate));
    engine?.setPlatterBrakeRate(platterBrakeRate);
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

<svelte:window on:keydown={handleGlobalKeydown} />
<main class:desktop-overlay-shell={isDesktopApp}>
  {#if isDesktopApp}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="titlebar-drag-region" on:mousedown={onTitlebarMousedown}></div>
  {/if}

  <Stage>
    <Cabinet>
      <!-- ========== 左上：唱盘 ========== -->
      <div slot="turntable" class="turntable-host">
        <Turntable
          chromeless={true}
          side={currentSide}
          {currentTime}
          {isPlaying}
          {isPlatterSpinning}
          {platterBrakeRate}
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
          onPlatterBrakeRateChange={handlePlatterBrakeRateChange}
        />
        <div class="turntable-art-toggle" role="group" aria-label="盘面图显示模式">
          <button
            class:active={discArtworkMode === "overlay"}
            type="button"
            on:click={() => {
              discArtworkMode = "overlay";
            }}
          >DISC</button>
          <button
            class:active={discArtworkMode === "centered"}
            type="button"
            on:click={() => {
              discArtworkMode = "centered";
            }}
          >LABEL</button>
        </div>
      </div>

      <!-- ========== 左下：控制台（VOLUME + Spectrum + 副控件） ========== -->
      <div slot="console" class="console-host">
        <Console
          {volume}
          {musicMeterLevels}
          {isSpectrumEnabled}
          {isTransportActive}
          onVolumeChange={handleVolumeChange}
          onToggleSpectrum={() => {
            isSpectrumEnabled = !isSpectrumEnabled;
          }}
          onTogglePlay={togglePlay}
        />
      </div>

      <!-- ========== 右上：唱片架 ========== -->
      <div slot="shelf" class="shelf-host">
        <CabinetShelf
          albums={libraryAlbums}
          {selectedAlbumId}
          deckAlbumId={playbackAlbum?.id ?? null}
          {isTransportActive}
          {favoriteAlbumIds}
          {recentAlbumIds}
          onSelect={(albumId) => selectAlbumById(albumId)}
          onPlayAlbum={(albumId) => playAlbumById(albumId)}
          onOpenWorkshop={() => openWorkshop()}
        />
      </div>

      <!-- ========== 右下：信息 + 曲目 ========== -->
      <div slot="info" class="info-host">
        {#if selectedAlbum && playbackAlbum && currentSide}
          <div class="paper liner-stack">
            <section class="liner-panel album-card" aria-label="专辑信息">
              <div class="album-card-top">
                <div class="mini-cover">
                  {#if selectedAlbum.coverUrl}
                    <img src={selectedAlbum.coverUrl} alt="" />
                  {:else}
                    <span>{selectedAlbum.title.trim()[0] ?? "L"}</span>
                  {/if}
                </div>
                <div class="meta-column">
                  <div class="meta">
                    <div class="title" title={selectedAlbum.title}>{selectedAlbum.title}</div>
                    <div class="artist">{selectedAlbum.artist || "未署名艺人"}</div>
                    <div class="tag-row">
                      <div class="tag-row-left">
                        {#if (selectedAlbum.categories ?? []).length > 0}
                          <span class="genre-badge">{selectedAlbum.categories[0]}</span>
                        {/if}
                      </div>
                      <button
                        class="fav-star"
                        class:active={favoriteAlbumIds.has(selectedAlbum.id)}
                        type="button"
                        on:click={() => toggleFavorite(selectedAlbum.id)}
                        aria-pressed={favoriteAlbumIds.has(selectedAlbum.id)}
                        aria-label={favoriteAlbumIds.has(selectedAlbum.id) ? "取消收藏" : "收藏"}
                        title={favoriteAlbumIds.has(selectedAlbum.id) ? "取消收藏" : "收藏"}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <polygon points="12 2.6 14.9 9.1 22 9.9 16.7 14.7 18.2 21.5 12 17.9 5.8 21.5 7.3 14.7 2 9.9 9.1 9.1" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class="stat-stack" aria-label="专辑统计">
                    <div class="album-stat">
                      <span class="stat-label">曲目数量</span>
                      <span class="stat-value">{countAlbumTracks(selectedAlbum)} 首</span>
                    </div>
                    <div class="album-stat">
                      <span class="stat-label">唱片面数</span>
                      <span class="stat-value">{playbackAlbum.sides.length} 面</span>
                    </div>
                    <div class="album-stat">
                      <span class="stat-label">发行时间</span>
                      <span class="stat-value">—</span>
                    </div>
                    <div class="album-stat">
                      <span class="stat-label">总时长</span>
                      <span class="stat-value">{formatTime(getAlbumDuration(selectedAlbum))}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="liner-panel tracklist-paper" aria-label="曲目列表">
              <div class="tl-head">
                <span>曲目列表</span>
                <div class="tl-controls">
                  <div class="print-side-picker" aria-label="切换盘面">
                    {#each playbackAlbum.sides as side, index}
                      <button
                        class="print-side-link"
                        class:active={index === currentSideIndex}
                        type="button"
                        disabled={isSwitchingSide || index === currentSideIndex}
                        on:click={() => void switchSide(index)}
                        aria-current={index === currentSideIndex ? "true" : undefined}
                      >
                        {side.label}
                      </button>
                    {/each}
                  </div>
                  <span class="tl-status">{isPlaying ? "▶ 播放中" : "■ 已暂停"}</span>
                </div>
              </div>
              <div class="tracklist-scroll">
                <div class="current-side-row">
                  <span>{currentSide.label} 面</span>
                  <span>{currentSide.tracks.length} 首 · {formatTime(currentSide.totalDuration)}</span>
                </div>
                {#each currentSide.tracks as track, index}
                  <div
                    class="track-row"
                    class:playing={isCurrentTrack(currentSide, index, currentTime)}
                    aria-current={isCurrentTrack(currentSide, index, currentTime) ? "true" : undefined}
                  >
                    <span class="track-led" aria-hidden="true"></span>
                    <span class="track-num">{String(index + 1).padStart(2, "0")}</span>
                    <span class="track-title">{track.title}</span>
                    <span class="track-time">{formatTime(track.duration)}</span>
                  </div>
                {/each}
              </div>
            </section>

          </div>
        {:else}
          <div class="paper liner-stack liner-empty">
            <p class="helper">请选择一张专辑。</p>
          </div>
        {/if}
      </div>

    </Cabinet>
  </Stage>

  <!-- Workshop Modal -->
  {#if activeView === "workshop"}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="ws-backdrop"
      transition:fade={{ duration: 220 }}
      on:click={closeWorkshop}
      on:keydown={(e) => e.key === 'Escape' && closeWorkshop()}
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="管理专辑"
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="ws-panel"
        transition:fly={{ y: 40, duration: 320, easing: quintOut }}
        on:click|stopPropagation
      >
        <button class="ws-close-btn" type="button" on:click={closeWorkshop} aria-label="关闭">✕</button>
        <AlbumWorkshop
          album={workshopAlbum}
          albums={libraryAlbums}
          mode={workshopMode}
          editingAlbumId={workshopAlbum?.id ?? null}
          bind:albumTitleDraft
          {isDesktopApp}
          isBusy={isLoading || isSavingLibrary}
          {loadError}
          {pendingDeleteAlbumId}
          {pendingDeleteAlbumTitle}
          onModeChange={(mode) => {
            workshopMode = mode;
            if (mode === "edit" && !workshopAlbumId) {
              workshopAlbumId = selectedAlbumId ?? libraryAlbums[0]?.id ?? null;
            }
            if (mode !== "edit") {
              workshopAlbumId = null;
            }
          }}
          onSelectAlbum={selectWorkshopAlbum}
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
          {availableCategories}
          onManageCategories={() => (categoryManagerOpen = true)}
          onCategoriesChange={(cats) => {
            if (workshopAlbum?.id) void handleCategoriesChange(workshopAlbum.id, cats);
          }}
        />
      </div>
    </div>
  {/if}

  {#if categoryManagerOpen}
    <CategoryManager
      albums={libraryAlbums}
      onClose={() => (categoryManagerOpen = false)}
      onRenameCategory={(old, next) => void handleRenameCategory(old, next)}
      onDeleteCategory={(name) => void handleDeleteCategory(name)}
      onRemoveAlbumFromCategory={(id, cat) => void handleRemoveAlbumFromCategory(id, cat)}
    />
  {/if}

  {#if isLoading || isSavingLibrary}
    <div class="status-bar">
      {#if isLoading}
        <span class="status-pill">加载中</span>
      {/if}
      {#if isSavingLibrary}
        <span class="status-pill">已写入</span>
      {/if}
    </div>
  {/if}

  {#if loadError}
    <div class="error-toast">{loadError}</div>
  {/if}
</main>

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: radial-gradient(
      ellipse at 50% 40%,
      #2a1c10 0%,
      #0e0805 80%
    );
    color: #2a1e10;
    font-family:
      "Inter", "Noto Serif SC", Georgia, "Times New Roman", serif;
    overflow: hidden;
    height: 100vh;
    height: 100dvh;
  }

  main {
    position: relative;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  main.desktop-overlay-shell {
    padding-top: 28px; /* 让出标题栏拖拽区 */
  }

  .titlebar-drag-region {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 28px;
    z-index: 9999;
  }

  /* Workshop panel 内：让 AlbumWorkshop 撑满并正确滚动 */
  :global(.ws-panel .ws) {
    width: 100%;
    min-height: 0;
  }
  :global(.ws-panel .ws-scroll) {
    padding-inline: 36px;
    padding-bottom: 36px;
  }

  /* ── 唱盘 slot 内部 ── */
  .turntable-host {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10px;
    overflow: visible;
  }
  .turntable-host :global(.turntable-wrap) {
    align-items: flex-start;
  }
  .turntable-art-toggle {
    position: absolute;
    left: 22px;
    bottom: 10px;
    z-index: 4;
    display: flex;
    gap: 2px;
    padding: 4px;
    border: 1px solid rgba(34, 18, 6, 0.48);
    border-top-color: rgba(255, 235, 185, 0.18);
    border-radius: 6px;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(255, 230, 190, 0.08), transparent 70%),
      linear-gradient(180deg, rgba(34, 27, 19, 0.96), rgba(12, 9, 7, 0.94));
    box-shadow:
      inset 0 1px 2px rgba(255, 235, 185, 0.08),
      inset 0 -2px 5px rgba(0, 0, 0, 0.56),
      0 3px 9px rgba(0, 0, 0, 0.32);
  }
  .turntable-art-toggle button {
    min-width: 72px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: #7a5c34;
    cursor: pointer;
    font-family: "JetBrains Mono", monospace;
    font-size: 13px;
    letter-spacing: 0.15em;
    padding: 6px 10px;
  }
  .turntable-art-toggle button.active {
    background: linear-gradient(180deg, #3a2a10, #2a1e0a);
    color: #f0b44b;
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.72),
      0 0 6px rgba(240, 180, 75, 0.22);
  }

  /* ── 控制台 host ── */
  .console-host {
    height: 100%;
    min-height: 0;
  }

  /* ── 唱片架 ── */
  .shelf-host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  /* ── Info 纸卡 ── */
  .info-host {
    display: flex;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }
  .paper {
    position: relative;
    border-radius: 8px;
    padding: 18px 20px;
    background: linear-gradient(180deg, #f5e8cf 0%, #e9d7b1 100%);
    box-shadow:
      0 6px 14px rgba(0, 0, 0, 0.3),
      inset 0 0 0 1px rgba(180, 140, 90, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.5);
    font-family: "Noto Serif SC", "Cormorant Garamond", serif;
    color: #2a1e10;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    min-height: 0;
  }
  .paper::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 8px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.4  0 0 0 0 0.25  0 0 0 0.12 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    mix-blend-mode: multiply;
    opacity: 0.6;
    pointer-events: none;
  }
  .paper > * {
    position: relative;
    z-index: 1;
  }
  .info-host > .paper {
    width: 100%;
    height: 100%;
  }
  .liner-stack {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0;
    min-height: 0;
    padding: 0;
  }
  .liner-stack .liner-panel + .liner-panel {
    border-top: 1px dashed rgba(90, 58, 31, 0.28);
  }
  .liner-panel {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    padding: 18px 22px;
  }
  .liner-empty {
    display: grid;
    grid-template-columns: 1fr;
    place-items: start;
    padding: 18px 20px;
  }
  .liner-empty::after {
    display: none;
  }
  .album-card {
    gap: 0;
    justify-content: flex-start;
  }
  .album-card-top {
    display: grid;
    grid-template-columns: minmax(0, 240px) minmax(0, 1fr);
    align-items: start;
    gap: 24px;
    min-width: 0;
    min-height: 0;
  }
  .mini-cover {
    display: grid;
    place-items: center;
    align-self: start;
    justify-self: start;
    flex: 0 0 auto;
    width: min(100%, 240px);
    height: auto;
    max-height: 240px;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 3px;
    background: linear-gradient(145deg, #e4d8bc, #c2a36f);
    box-shadow:
      0 7px 14px rgba(0, 0, 0, 0.34),
      inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
  .mini-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .mini-cover span {
    color: rgba(80, 52, 18, 0.36);
    font-family: "Cormorant Garamond", serif;
    font-size: clamp(56px, 8vw, 92px);
    font-weight: 600;
  }
  .meta-column {
    display: grid;
    align-content: start;
    gap: 16px;
    min-width: 0;
    min-height: 0;
  }
  .meta {
    display: grid;
    gap: 6px;
    min-width: 0;
    text-align: left;
  }
  .meta .title {
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 38px;
    font-weight: 500;
    line-height: 1.05;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
  .meta .artist {
    font-size: 20px;
    color: #5a4326;
    margin: 0;
  }
  .tag-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 6px;
    min-width: 0;
  }
  .tag-row-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .genre-badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 12px;
    border-radius: 999px;
    background: rgba(201, 100, 45, 0.14);
    box-shadow: inset 0 0 0 1px rgba(201, 100, 45, 0.32);
    color: #8a4216;
    font-family: "Noto Serif SC", serif;
    font-size: 13px;
    letter-spacing: 0.06em;
  }
  .fav-star {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 0;
    padding: 0;
    border-radius: 50%;
    background: transparent;
    color: #8a6a3c;
    cursor: pointer;
    transition: color 160ms ease, filter 160ms ease, transform 100ms ease;
  }
  .fav-star svg {
    width: 22px;
    height: 22px;
    fill: transparent;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
    transition: fill 160ms ease, stroke 160ms ease, filter 160ms ease;
  }
  .fav-star:hover {
    color: #c9642d;
  }
  .fav-star:active {
    transform: scale(0.94);
  }
  .fav-star.active {
    color: #e0a137;
  }
  .fav-star.active svg {
    fill: #f0b44b;
    stroke: #b87a21;
    filter: drop-shadow(0 0 4px rgba(240, 180, 75, 0.55));
  }
  .stat-stack {
    display: grid;
    gap: 0;
    width: 100%;
    min-width: 0;
  }
  .album-stat {
    display: grid;
    grid-template-columns: 5.5em minmax(0, 1fr);
    align-items: baseline;
    gap: 16px;
    min-width: 0;
    padding: 8px 0;
    border-bottom: 1px dashed rgba(90, 58, 31, 0.22);
  }
  .album-stat:last-child {
    border-bottom: 0;
  }
  .stat-label {
    color: #8a6a3c;
    font-family: "Noto Serif SC", serif;
    font-size: 13px;
    letter-spacing: 0.1em;
    white-space: nowrap;
  }
  .stat-value {
    color: #2a1e10;
    font-family: "JetBrains Mono", "Courier New", monospace;
    font-size: 15px;
    font-weight: 600;
    text-align: right;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tracklist-paper {
    gap: 8px;
    padding-top: 24px;
    min-height: 0;
    overflow: hidden;
  }
  .tl-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: "Noto Serif SC", serif;
    font-size: 24px;
    font-weight: 600;
    padding-bottom: 12px;
    border-bottom: 1px dashed rgba(90, 58, 31, 0.28);
  }
  .tl-controls {
    display: flex;
    align-items: baseline;
    gap: 18px;
    min-width: 0;
  }
  .print-side-picker {
    display: flex;
    align-items: baseline;
    gap: 14px;
    color: #8a6a3c;
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 23px;
    letter-spacing: 0.08em;
  }
  .print-side-link {
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-style: italic;
    letter-spacing: inherit;
  }
  .print-side-link:hover:not(:disabled) {
    color: #c9642d;
  }
  .print-side-link.active {
    color: #2a1e10;
    font-weight: 700;
    font-style: normal;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 4px;
  }
  .print-side-link:disabled {
    cursor: default;
  }
  .tl-status {
    font-family: "JetBrains Mono", monospace;
    font-size: 14px;
    font-weight: 400;
    color: #8a6a3c;
    letter-spacing: 0.06em;
  }
  .tracklist-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 0;
    padding-right: 4px;
  }
  .current-side-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 16px 0 10px;
    color: #8a6a3c;
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 21px;
    font-style: italic;
    letter-spacing: 0.1em;
  }
  .current-side-row span:last-child {
    font-family: "JetBrains Mono", monospace;
    font-size: 14px;
    font-style: normal;
    letter-spacing: 0.04em;
  }
  .track-row {
    display: grid;
    grid-template-columns: 10px 40px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: baseline;
    width: 100%;
    border: 0;
    padding: 7px 6px;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 27px;
    text-align: left;
    transition: background 0.5s ease;
  }
  .track-row.playing {
    background: rgba(201, 100, 45, 0.08);
  }
  .track-row.playing .track-num,
  .track-row.playing .track-title {
    color: #c9642d;
    font-weight: 600;
  }
  .track-led {
    align-self: center;
    justify-self: center;
    width: 3px;
    height: 6px;
    border-radius: 2px;
    background: rgba(78, 62, 35, 0.28);
    box-shadow:
      inset 0 0 2px rgba(0, 0, 0, 0.7),
      0 0 0 rgba(240, 180, 75, 0);
    transform: translateY(1px);
    transition:
      width 0.16s ease-out,
      height 0.16s ease-out,
      background 0.22s ease-out,
      box-shadow 0.9s ease-out,
      opacity 0.9s ease-out;
  }
  .track-row.playing .track-led {
    width: 5px;
    height: 9px;
    background: radial-gradient(circle at 38% 32%, #fff4b6 0%, #f5c64e 42%, #d66f27 100%);
    box-shadow:
      inset 0 0 1px rgba(255, 252, 219, 0.95),
      0 0 0 1px rgba(115, 61, 19, 0.22),
      0 0 7px rgba(240, 180, 75, 0.98),
      0 0 18px rgba(240, 180, 75, 0.58),
      0 0 30px rgba(214, 111, 39, 0.24);
  }
  .track-num {
    color: #5a4326;
    font-family: "JetBrains Mono", monospace;
    font-size: 16px;
    text-align: right;
  }
  .track-title {
    color: #2a1e10;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-bottom: 2px;
    border-bottom: 1px dotted rgba(90, 58, 31, 0.38);
  }
  .track-time {
    color: #5a4326;
    font-family: "JetBrains Mono", monospace;
    font-size: 16px;
    padding-bottom: 2px;
    border-bottom: 1px dotted rgba(90, 58, 31, 0.38);
  }
  .liner-empty .helper {
    color: #5a4326;
    font-size: 18px;
  }

  /* ── Action bar ── */
  .action-bar {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    padding: 14px 22px 16px;
    border-top: 1px dashed rgba(90, 58, 31, 0.28);
  }
  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 40px;
    padding: 0 18px;
    border: 0;
    border-radius: 6px;
    background: linear-gradient(180deg, #3a2a16 0%, #1f140a 100%);
    color: #f2e3c1;
    font-family: "Noto Serif SC", serif;
    font-size: 14px;
    letter-spacing: 0.08em;
    cursor: pointer;
    box-shadow:
      inset 0 1px 0 rgba(255, 230, 185, 0.18),
      inset 0 -1px 0 rgba(0, 0, 0, 0.4),
      0 2px 4px rgba(0, 0, 0, 0.25);
    transition: filter 0.15s ease, transform 0.1s ease;
  }
  .action-btn:hover {
    filter: brightness(1.1);
  }
  .action-btn:active {
    transform: translateY(1px);
  }
  .action-btn--primary {
    flex: 1;
    background: linear-gradient(180deg, #5a3a18 0%, #2e1b08 100%);
    color: #ffe6b3;
  }
  .action-btn--ghost {
    background: linear-gradient(180deg, #4a3420 0%, #251808 100%);
  }
  .action-btn--ghost .heart {
    color: #e36b3a;
  }
  .action-btn--icon {
    width: 40px;
    padding: 0;
    font-size: 18px;
    letter-spacing: 0;
  }

  /* ── Workshop Modal ── */
  .ws-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(8, 4, 1, 0.78);
    backdrop-filter: blur(8px);
    display: grid;
    place-items: center;
    padding: 24px 20px;
    /* 让 backdrop 可聚焦（支持键盘关闭） */
    outline: none;
  }

  .ws-panel {
    position: relative;
    width: 100%;
    max-width: 980px;
    max-height: calc(100vh - 48px);
    max-height: calc(100dvh - 48px);
    background:
      radial-gradient(ellipse at 50% 0%, rgba(255, 230, 190, 0.06) 0%, transparent 55%),
      linear-gradient(180deg, #fdf7e8 0%, #f5ead0 100%);
    border-radius: 20px;
    box-shadow:
      0 60px 120px -20px rgba(0, 0, 0, 0.7),
      0 0 0 1px rgba(90, 58, 31, 0.2),
      inset 0 1px 0 rgba(255, 245, 220, 0.8);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* 右上角独立关闭按钮 */
  .ws-close-btn {
    position: absolute;
    top: 16px;
    right: 18px;
    z-index: 2;
    background: rgba(255, 240, 210, 0.7);
    border: 1px solid rgba(90, 58, 31, 0.18);
    border-radius: 50%;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    color: #8a6432;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .ws-close-btn:hover {
    background: rgba(201, 100, 45, 0.15);
    color: #c9642d;
  }

  /* ── 状态 / 错误 ── */
  .status-bar {
    position: fixed;
    top: 34px;
    right: 16px;
    display: flex;
    gap: 8px;
    z-index: 1000;
  }
  .status-pill {
    background: rgba(10, 6, 3, 0.8);
    color: #f2e8d6;
    border: 1px solid rgba(201, 154, 91, 0.4);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    letter-spacing: 0.2em;
  }
  .error-toast {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    background: rgba(143, 47, 34, 0.92);
    color: #fff8e6;
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 1000;
    max-width: 80vw;
  }
</style>
