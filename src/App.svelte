<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Turntable from './lib/turntable/Turntable.svelte';
  import {
    isDesktopRuntime,
    pickDesktopAudioFiles,
    pickDesktopAudioFolder,
  } from './lib/audio/importAudio';
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
  } from './lib/library/model';
  import { deleteLibraryAlbum, loadLibrary, saveLibraryAlbum } from './lib/library/persistence';
  import { VinylEngine } from './lib/audio/vinylEngine';
  import type { Album, DiscArtworkMode, DiscSide, LibraryAlbum, TonearmState } from './lib/types';

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
  let loadError = '';
  let tonearmState: TonearmState = 'parked';
  let discArtworkMode: DiscArtworkMode = 'centered';
  let startSequenceToken = 0;
  let manualSpinupStartedAt: number | null = null;
  let albumTitleDraft = '';
  let titleDraftAlbumId: string | null = null;
  let isEditorOpen = false;
  let libraryPanelVisible = true;

  const isDesktopApp = isDesktopRuntime();

  const PLATTER_SPINUP_MS = 2300;
  const TONEARM_CUE_MS = 1500;
  const TONEARM_SETTLE_PAUSE_MS = 110;
  const TONEARM_DROP_MS = 700;

  $: selectedAlbum = libraryAlbums.find((album) => album.id === selectedAlbumId) ?? null;
  $: currentSide = playbackAlbum?.sides[currentSideIndex] ?? null;

  $: if ((selectedAlbum?.id ?? null) !== titleDraftAlbumId) {
    albumTitleDraft = selectedAlbum?.title ?? '';
    titleDraftAlbumId = selectedAlbum?.id ?? null;
  }

  $: if (!selectedAlbum) {
    isEditorOpen = false;
  }

  function sortAlbums(albums: LibraryAlbum[]): LibraryAlbum[] {
    return [...albums].sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    });
  }

  function replaceAlbum(updatedAlbum: LibraryAlbum) {
    const otherAlbums = libraryAlbums.filter((album) => album.id !== updatedAlbum.id);
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
    tonearmState = 'parked';
    manualSpinupStartedAt = null;
  }

  function bindEngineCallbacks(targetEngine: VinylEngine) {
    targetEngine.onTimeUpdate = (time) => {
      currentTime = time;
    };

    targetEngine.onSideEnded = () => {
      cancelStartupSequence();
      isPlaying = false;
      isPlatterSpinning = false;
      tonearmState = 'parked';
      currentTime = currentSide?.totalDuration ?? 0;
      manualSpinupStartedAt = null;
    };
  }

  async function syncSelectedAlbumToPlayer(albumId: string | null = selectedAlbumId) {
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
    loadError = '';

    try {
      libraryAlbums = sortAlbums(await loadLibrary());
      selectedAlbumId = libraryAlbums[0]?.id ?? null;
      await syncSelectedAlbumToPlayer(selectedAlbumId);
    } catch (err) {
      loadError = '加载曲库失败：' + String(err);
      console.error(err);
    } finally {
      isLoading = false;
    }
  }

  async function persistAlbum(updatedAlbum: LibraryAlbum) {
    isSavingLibrary = true;
    loadError = '';

    try {
      const savedAlbum = await saveLibraryAlbum(updatedAlbum);
      replaceAlbum(savedAlbum);
      await syncSelectedAlbumToPlayer(savedAlbum.id);
    } catch (err) {
      loadError = '保存失败：' + String(err);
      console.error(err);
    } finally {
      isSavingLibrary = false;
    }
  }

  async function importAlbum(kind: 'files' | 'folder', target: 'new' | 'current') {
    isLoading = true;
    loadError = '';

    try {
      const prepared = kind === 'files'
        ? await pickDesktopAudioFiles()
        : await pickDesktopAudioFolder();

      if (!prepared) return;

      if (target === 'new' || !selectedAlbum) {
        await persistAlbum(createLibraryAlbumFromPreparedImport(prepared));
      } else {
        await persistAlbum(appendPreparedImportToAlbum(selectedAlbum, prepared));
      }
    } catch (err) {
      loadError = '导入失败：' + String(err);
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

  async function moveTrack(sideIndex: number, trackIndex: number, direction: 'up' | 'down' | 'left' | 'right') {
    if (!selectedAlbum) return;
    await persistAlbum(moveTrackWithinAlbum(selectedAlbum, sideIndex, trackIndex, direction));
  }

  async function removeTrack(sideIndex: number, trackIndex: number) {
    if (!selectedAlbum) return;
    await persistAlbum(removeTrackFromAlbum(selectedAlbum, sideIndex, trackIndex));
  }

  async function deleteCurrentAlbum() {
    if (!selectedAlbum) return;
    if (!window.confirm(`删除专辑《${selectedAlbum.title}》？`)) return;

    isSavingLibrary = true;
    loadError = '';

    try {
      const removedAlbumId = selectedAlbum.id;
      await deleteLibraryAlbum(removedAlbumId);
      libraryAlbums = libraryAlbums.filter((album) => album.id !== removedAlbumId);
      selectedAlbumId = libraryAlbums[0]?.id ?? null;
      isEditorOpen = false;
      await syncSelectedAlbumToPlayer(selectedAlbumId);
    } catch (err) {
      loadError = '删除失败：' + String(err);
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
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function isCurrentTrack(sideRef: DiscSide | null, trackIndex: number, time: number): boolean {
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
    tonearmState = 'parked';
    clearManualCueState();
  }

  async function beginPlaybackSequence() {
    if (!engine || !currentSide) return;

    const token = ++startSequenceToken;
    clearManualCueState();
    tonearmState = 'parked';
    isPlatterSpinning = true;
    await engine.startLeadInNoise();

    await wait(PLATTER_SPINUP_MS);
    if (token !== startSequenceToken) return;

    tonearmState = 'cueing';
    await wait(TONEARM_CUE_MS);
    if (token !== startSequenceToken) return;

    await wait(TONEARM_SETTLE_PAUSE_MS);
    if (token !== startSequenceToken) return;

    tonearmState = 'dropping';
    await wait(TONEARM_DROP_MS);
    if (token !== startSequenceToken) return;

    await engine.playWithOptions(currentTime, { keepNoise: true });
    if (token !== startSequenceToken) {
      engine.stop();
      return;
    }

    isPlaying = true;
    tonearmState = 'playing';
  }

  async function beginManualCueSpinup() {
    if (!engine || !currentSide) return;
    if (isPlaying || tonearmState === 'cueing' || tonearmState === 'dropping') return;
    if (manualSpinupStartedAt !== null && isPlatterSpinning) return;

    cancelStartupSequence();
    tonearmState = 'holding';

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
    tonearmState = 'holding';

    if (!isPlatterSpinning) {
      isPlatterSpinning = true;
      manualSpinupStartedAt = performance.now();
      await engine.startLeadInNoise();
      if (token !== startSequenceToken) return;
    }

    if (manualSpinupStartedAt === null) {
      manualSpinupStartedAt = performance.now() - PLATTER_SPINUP_MS;
    }

    const remainingSpinupMs = Math.max(0, PLATTER_SPINUP_MS - (performance.now() - manualSpinupStartedAt));
    if (remainingSpinupMs > 0) {
      await wait(remainingSpinupMs);
      if (token !== startSequenceToken) return;
    }

    await wait(TONEARM_SETTLE_PAUSE_MS);
    if (token !== startSequenceToken) return;

    tonearmState = 'dropping';
    await wait(TONEARM_DROP_MS);
    if (token !== startSequenceToken) return;

    await engine.playWithOptions(timeInSide, { keepNoise: true });
    if (token !== startSequenceToken) {
      engine.stop();
      return;
    }

    clearManualCueState();
    isPlaying = true;
    tonearmState = 'playing';
  }

  async function togglePlay() {
    if (!engine || !currentSide) return;

    if (isPlaying || isPlatterSpinning || tonearmState === 'cueing' || tonearmState === 'dropping') {
      cancelStartupSequence();
      engine.pause();
      engine.stopLeadInNoise();
      isPlaying = false;
      isPlatterSpinning = false;
      tonearmState = 'parked';
      clearManualCueState();
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
    tonearmState = 'parked';
    clearManualCueState();

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

<main>
  <div class="studio" class:collapsed-layout={!libraryPanelVisible}>
    <aside class="library-panel" class:collapsed={!libraryPanelVisible}>
      {#if libraryPanelVisible}
        <div class="library-shell">
          <div class="panel-head">
            <div class="panel-title-block">
              <div class="eyebrow">MUSIC LIBRARY</div>
              <h1 class="panel-title">专辑库</h1>
              <p class="panel-note">本地唱片目录与当前盘面。</p>
            </div>

            <div class="panel-toolbar" aria-label="导入新专辑与曲库控制">
              {#if isDesktopApp}
                <button class="mini-btn" type="button" on:click={() => void importAlbum('files', 'new')}>
                  导入文件
                </button>
                <button class="mini-btn" type="button" on:click={() => void importAlbum('folder', 'new')}>
                  导入文件夹
                </button>
              {/if}

              <button class="toggle-library-btn" type="button" on:click={toggleLibraryPanel} aria-label="切换库面板">
                隐藏库
              </button>
            </div>
          </div>

          {#if loadError}
            <p class="error">{loadError}</p>
          {/if}

          <div class="section focus-section">
            {#if selectedAlbum}
              <div class="selected-album-card">
                <div class="selected-album-copy">
                  <div class="section-label">当前专辑</div>
                  <div class="selected-album-headline">
                    <span class="selected-album-title">{selectedAlbum.title}</span>
                    <span class="selected-album-badge">已选中</span>
                  </div>
                  <span class="selected-album-meta">
                    {Math.ceil(selectedAlbum.sides.length / 2)} 张碟 · {selectedAlbum.sides.length} 面 ·
                    {countAlbumTracks(selectedAlbum)} 首 · {formatTime(getAlbumDuration(selectedAlbum))}
                  </span>
                </div>

                <div class="selected-album-actions">
                  <button class="primary-btn" type="button" on:click={openEditor}>
                    编辑专辑
                  </button>
                </div>

                {#if playbackAlbum && currentSide}
                  <div class="sidebar-side-panel">
                    <div class="sidebar-side-head">
                      <span class="section-label">当前盘面</span>
                      <span class="selected-album-meta">
                        Side {currentSide.label} · {currentSide.tracks.length} 首 · {formatTime(currentSide.totalDuration)}
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
                      {#each currentSide.tracks as track, index}
                        <div class="sidebar-track" class:playing={isCurrentTrack(currentSide, index, currentTime)}>
                          <span class="sidebar-track-num">{String(index + 1).padStart(2, '0')}</span>
                          <span class="sidebar-track-title">{track.title}</span>
                          <span class="sidebar-track-duration">{formatTime(track.duration)}</span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <p class="helper">当前专辑还没有可播放的盘面。</p>
                {/if}
              </div>
            {:else}
              <p class="empty-state">先导入一张专辑，左侧保持曲库导航，编辑器按需打开。</p>
            {/if}
          </div>

          <div class="section">
            <div class="section-label">专辑列表</div>
            {#if libraryAlbums.length === 0}
              <p class="empty-state">还没有专辑，先从本地音频文件或文件夹导入。</p>
            {:else}
              <div class="album-list">
                {#each libraryAlbums as item}
                  <button
                    class="album-card"
                    class:active={item.id === selectedAlbumId}
                    on:click={() => void selectAlbumById(item.id)}
                    type="button"
                  >
                    <span class="album-card-title">{item.title}</span>
                    {#if item.id === selectedAlbumId}
                      <span class="album-card-badge">已选中</span>
                    {/if}
                    <span class="album-card-meta">
                      {Math.ceil(item.sides.length / 2)} 张碟 · {item.sides.length} 面 · {countAlbumTracks(item)} 首
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <button class="toggle-library-btn collapsed-toggle-btn" type="button" on:click={toggleLibraryPanel} aria-label="切换库面板">
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
                {Math.ceil(selectedAlbum.sides.length / 2)} 张碟 · {selectedAlbum.sides.length} 面 ·
                {countAlbumTracks(selectedAlbum)} 首 · {formatTime(getAlbumDuration(selectedAlbum))}
              </div>
            </div>

            <button class="ghost-btn close-btn" type="button" on:click={closeEditor}>
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
            <button class="save-btn" type="button" on:click={() => void saveCurrentAlbumTitle()}>
              保存标题
            </button>
          </div>

          {#if isDesktopApp}
            <div class="drawer-actions">
              <button class="ghost-btn" type="button" on:click={() => void importAlbum('files', 'current')}>
                追加文件到当前专辑
              </button>
              <button class="ghost-btn" type="button" on:click={() => void importAlbum('folder', 'current')}>
                追加文件夹到当前专辑
              </button>
              <button class="danger-btn" type="button" on:click={() => void deleteCurrentAlbum()}>
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
                    <span class="side-editor-title">Side {getSideLabel(sideIndex)}</span>
                    <span class="side-editor-meta">
                      {sideTracks.length} 首 · {formatTime(getSideDuration(sideTracks))}
                    </span>
                  </div>

                  <div class="editor-track-list">
                    {#each sideTracks as track, trackIndex}
                      <div class="editor-track">
                        <div class="editor-track-body">
                          <span class="editor-track-title">{track.title}</span>
                          <span class="editor-track-path">{track.sourceDisplayPath}</span>
                        </div>

                        <div class="editor-track-tools">
                          <button type="button" on:click={() => void moveTrack(sideIndex, trackIndex, 'up')}>
                            ↑
                          </button>
                          <button type="button" on:click={() => void moveTrack(sideIndex, trackIndex, 'down')}>
                            ↓
                          </button>
                          <button
                            type="button"
                            disabled={sideIndex === 0}
                            on:click={() => void moveTrack(sideIndex, trackIndex, 'left')}
                          >
                            ←
                          </button>
                          <button type="button" on:click={() => void moveTrack(sideIndex, trackIndex, 'right')}>
                            →
                          </button>
                          <button type="button" class="danger-icon" on:click={() => void removeTrack(sideIndex, trackIndex)}>
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
      <div class="turntable-head">
        <div class="turntable-heading">
          <span class="eyebrow">TURNTABLE</span>
          {#if selectedAlbum}
            <h2>{selectedAlbum.title}</h2>
          {/if}
        </div>

        <div class="turntable-head-right">
          {#if isLoading}
            <span class="status-pill">加载中</span>
          {/if}
          {#if isSavingLibrary}
            <span class="status-pill">已写入</span>
          {/if}
        </div>
      </div>

      <div class="turntable-stage">
        <Turntable
          side={currentSide}
          {currentTime}
          {isPlaying}
          {isPlatterSpinning}
          {tonearmState}
          coverUrl={playbackAlbum?.coverUrl}
          artworkMode={discArtworkMode}
          onArtworkModeChange={(mode) => { discArtworkMode = mode; }}
          onSeek={handleSeek}
          onTogglePlay={togglePlay}
          onNeedleDragStart={() => { void beginManualCueSpinup(); }}
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
    background:
      radial-gradient(circle at top left, rgba(255, 245, 221, 0.95), transparent 36%),
      linear-gradient(135deg, #e9dcc5 0%, #d8c4a1 45%, #c4ab82 100%);
    color: #2e1e0a;
    font-family: 'Courier New', monospace;
    overflow: hidden;
  }

  main {
    width: 100vw;
    height: 100vh;
    height: 100dvh;
  }

  .studio {
    display: grid;
    grid-template-columns: minmax(282px, 324px) minmax(0, 1fr);
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
    padding: 16px 14px 14px 10px;
    border-right: 1px solid rgba(112, 76, 31, 0.18);
    background:
      linear-gradient(180deg, rgba(255, 251, 243, 0.72), rgba(232, 217, 190, 0.86)),
      rgba(229, 213, 184, 0.95);
    backdrop-filter: blur(12px);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
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
    padding-right: 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(126, 94, 47, 0.34) transparent;
  }

  .editor-drawer {
    position: absolute;
    inset: 0;
    z-index: 2;
    padding: 18px 14px 16px 12px;
    overflow-y: auto;
    background:
      linear-gradient(180deg, rgba(255, 251, 243, 0.96), rgba(235, 220, 194, 0.98)),
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
    background: linear-gradient(180deg, rgba(148, 111, 60, 0.34), rgba(104, 73, 34, 0.42));
    border-radius: 999px;
    border: 1px solid rgba(255, 247, 233, 0.48);
  }

  .library-shell::-webkit-scrollbar-thumb:hover,
  .editor-drawer::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, rgba(148, 111, 60, 0.46), rgba(104, 73, 34, 0.56));
  }

  .panel-head,
  .arranger-head,
  .turntable-head {
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

  .turntable-head {
    align-items: center;
    justify-content: space-between;
  }

  .turntable-head-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .eyebrow {
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.22em;
    color: #8a6a3c;
    text-transform: uppercase;
  }

  .panel-title,
  .turntable-heading h2 {
    font-size: calc(18px * var(--app-font-scale));
    line-height: 1.2;
    color: #2a1802;
  }

  .panel-title-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .panel-note {
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.45;
    color: rgba(88, 60, 25, 0.72);
  }

  .panel-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    padding-top: 4px;
  }

  .turntable-heading {
    flex: 0 1 auto;
    min-width: 0;
  }

  .turntable-heading h2 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    gap: 10px;
  }

  .section-label {
    font-size: calc(9px * var(--app-font-scale));
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #8d6b3d;
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
    transition: transform 0.14s ease, background 0.14s ease, opacity 0.14s ease;
  }

  .mini-btn {
    min-height: 26px;
    padding: 6px 10px;
    border: 1px solid rgba(120, 84, 38, 0.18);
    background: rgba(255, 249, 240, 0.9);
    color: #5b3a12;
    font-size: calc(10px * var(--app-font-scale));
    letter-spacing: 0.04em;
  }

  .toggle-library-btn {
    min-height: 26px;
    padding: 6px 10px;
    border: 1px solid rgba(120, 84, 38, 0.18);
    background: rgba(255, 249, 240, 0.9);
    color: #5b3a12;
    font-size: calc(10px * var(--app-font-scale));
    letter-spacing: 0.04em;
    border-radius: 10px;
    cursor: pointer;
    transition: transform 0.14s ease, background 0.14s ease, opacity 0.14s ease;
  }

  .primary-btn,
  .ghost-btn {
    min-height: 28px;
    padding: 6px 10px;
    font-size: calc(10px * var(--app-font-scale));
  }

  .primary-btn {
    background: #8b5f34;
    color: #fff4e6;
  }

  .ghost-btn {
    border: 1px solid rgba(133, 98, 49, 0.16);
    background: rgba(255, 250, 242, 0.82);
    color: #553712;
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
    line-height: 1.45;
    color: #80613a;
  }

  .error {
    color: #af2f2f;
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.45;
  }

  .album-list,
  .side-editor-list {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }

  .album-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    padding: 10px 11px;
    background: rgba(255, 251, 244, 0.62);
    border: 1px solid rgba(133, 98, 49, 0.12);
    color: #4c3210;
    text-align: left;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.34);
  }

  .album-card.active {
    background:
      linear-gradient(90deg, rgba(146, 105, 50, 0.13), rgba(255, 248, 238, 0.96) 26%),
      rgba(255, 250, 242, 0.9);
    color: #2f1c04;
    border-color: rgba(133, 98, 49, 0.14);
    box-shadow:
      inset 3px 0 0 rgba(120, 82, 31, 0.82),
      0 8px 18px rgba(96, 59, 17, 0.08);
  }

  .album-card-title {
    font-size: calc(12px * var(--app-font-scale));
    font-weight: 700;
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
  }

  .album-card-badge {
    background: rgba(122, 81, 34, 0.08);
    border: 1px solid rgba(122, 81, 34, 0.12);
    color: #6a4315;
  }

  .album-card-meta {
    font-size: calc(9px * var(--app-font-scale));
    opacity: 0.8;
  }

  .focus-section {
    padding: 14px 13px 12px;
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 251, 244, 0.92), rgba(246, 235, 214, 0.88)),
      rgba(255, 248, 235, 0.7);
    border: 1px solid rgba(133, 98, 49, 0.1);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.45),
      0 10px 22px rgba(118, 83, 34, 0.08);
  }

  .selected-album-card,
  .selected-album-copy,
  .selected-album-actions,
  .drawer-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
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

  .selected-album-title,
  .drawer-title {
    font-size: calc(14px * var(--app-font-scale));
    font-weight: 700;
    color: #2f1c04;
  }

  .selected-album-headline {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .selected-album-badge {
    background: rgba(122, 81, 34, 0.12);
    border: 1px solid rgba(122, 81, 34, 0.18);
    color: #6a4315;
  }

  .selected-album-meta {
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.4;
    color: #80613a;
  }

  .sidebar-side-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid rgba(133, 98, 49, 0.12);
  }

  .sidebar-side-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sidebar-side-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
  }

  .side-chip {
    border: 0;
    border-radius: 0;
    padding: 0 0 2px;
    background: transparent;
    color: #5a3a12;
    font: inherit;
    font-size: calc(9px * var(--app-font-scale));
    cursor: pointer;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    opacity: 0.56;
    box-shadow: inset 0 -1px 0 transparent;
  }

  .side-chip:hover {
    opacity: 0.84;
  }

  .side-chip.active {
    color: #2f1c04;
    opacity: 1;
    box-shadow: inset 0 -1px 0 rgba(92, 61, 23, 0.45);
  }

  .sidebar-track-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding-top: 2px;
  }

  .sidebar-track {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 7px;
    align-items: center;
    padding: 7px 0;
    border-bottom: 1px dotted rgba(127, 98, 57, 0.24);
  }

  .sidebar-track.playing {
    border-bottom-color: rgba(94, 63, 24, 0.34);
  }

  .sidebar-track-num,
  .sidebar-track-duration {
    font-size: calc(9px * var(--app-font-scale));
    color: #8c6d42;
  }

  .sidebar-track-title {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #4a2e0c;
    font-size: calc(10px * var(--app-font-scale));
    line-height: 1.3;
  }

  .sidebar-track.playing .sidebar-track-title {
    color: #241300;
    font-weight: 700;
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
      grid-template-columns: minmax(262px, 304px) minmax(0, 1fr);
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

    .turntable-head,
    .arranger-head {
      flex-direction: column;
      align-items: stretch;
    }

    .turntable-head-right {
      justify-content: flex-start;
    }

    .panel-head {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
