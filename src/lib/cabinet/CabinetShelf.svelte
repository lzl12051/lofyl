<script lang="ts">
  import { tick } from "svelte";
  import type { LibraryAlbum } from "../types";
  import ShelfAlbumItem from "./ShelfAlbumItem.svelte";

  interface FilterOption {
    id: string;
    label: string;
    count: number;
  }

  export let albums: LibraryAlbum[] = [];
  export let selectedAlbumId: string | null = null;
  export let deckAlbumId: string | null = null;
  export let isTransportActive = false;
  export let favoriteAlbumIds: Set<string> = new Set();
  export let recentAlbumIds: string[] = [];
  export let onSelect: (albumId: string) => void | Promise<void> = () => {};
  export let onPlayAlbum: (albumId: string) => void | Promise<void> = () => {};
  export let onOpenWorkshop: () => void = () => {};

  const ALL_ID = "__all__";
  const FAVORITES_ID = "__favorites__";
  const RECENT_ID = "__recent__";

  let shelfViewportEl: HTMLDivElement | null = null;
  let shelfTrackEl: HTMLDivElement | null = null;
  let focusedAlbumId: string | null = null;
  let activeFilterId = ALL_ID;
  let pendingSelectAlbumId: string | null = null;
  let pendingSelectPromise: Promise<void> | null = null;

  function setFilter(optionId: string) {
    activeFilterId = optionId;
    focusedAlbumId = selectedAlbumId ?? deckAlbumId ?? null;
    void tick().then(() => scrollAlbumIntoView(focusedAlbumId));
  }

  function getAlbumElement(albumId: string | null): HTMLElement | null {
    if (!albumId || !shelfTrackEl) return null;
    return (
      Array.from(shelfTrackEl.querySelectorAll<HTMLElement>("[data-album-id]"))
        .find((element) => element.dataset.albumId === albumId) ?? null
    );
  }

  function scrollAlbumIntoView(albumId: string | null) {
    getAlbumElement(albumId)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }

  async function moveFocus(delta: number) {
    if (visibleAlbums.length === 0) return;
    const currentId = focusedAlbumId ?? selectedAlbumId ?? deckAlbumId;
    const currentIndex = visibleAlbums.findIndex((album) => album.id === currentId);
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.max(0, Math.min(visibleAlbums.length - 1, baseIndex + delta));
    const nextId = visibleAlbums[nextIndex]?.id ?? null;
    if (!nextId || nextId === focusedAlbumId) return;
    focusedAlbumId = nextId;
    await tick();
    getAlbumElement(nextId)?.focus({ preventScroll: true });
    scrollAlbumIntoView(nextId);
  }

  function rememberSelect(albumId: string, result: void | Promise<void>) {
    if (!result || typeof result.then !== "function") {
      pendingSelectAlbumId = null;
      pendingSelectPromise = null;
      return;
    }

    pendingSelectAlbumId = albumId;
    pendingSelectPromise = result.finally(() => {
      if (pendingSelectAlbumId === albumId) {
        pendingSelectAlbumId = null;
        pendingSelectPromise = null;
      }
    });
  }

  function chooseAlbum(albumId: string) {
    focusedAlbumId = albumId;
    rememberSelect(albumId, onSelect(albumId));
    scrollAlbumIntoView(albumId);
  }

  async function playAlbum(albumId: string) {
    focusedAlbumId = albumId;
    if (pendingSelectAlbumId === albumId && pendingSelectPromise) {
      await pendingSelectPromise;
    }
    await onPlayAlbum(albumId);
    scrollAlbumIntoView(albumId);
  }

  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        void moveFocus(1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        void moveFocus(-1);
        return;
      case "Home":
        event.preventDefault();
        if (visibleAlbums[0]) {
          focusedAlbumId = visibleAlbums[0].id;
          void tick().then(() => {
            getAlbumElement(focusedAlbumId)?.focus({ preventScroll: true });
            scrollAlbumIntoView(focusedAlbumId);
          });
        }
        return;
      case "End":
        event.preventDefault();
        if (visibleAlbums[visibleAlbums.length - 1]) {
          focusedAlbumId = visibleAlbums[visibleAlbums.length - 1].id;
          void tick().then(() => {
            getAlbumElement(focusedAlbumId)?.focus({ preventScroll: true });
            scrollAlbumIntoView(focusedAlbumId);
          });
        }
        return;
      case "Enter": {
        const targetId = focusedAlbumId ?? selectedAlbumId ?? deckAlbumId;
        if (!targetId) return;
        event.preventDefault();
        if (targetId === selectedAlbumId || targetId === deckAlbumId) {
          void playAlbum(targetId);
        } else {
          chooseAlbum(targetId);
        }
        return;
      }
      case "Escape":
        event.preventDefault();
        focusedAlbumId = null;
        void tick().then(() => scrollAlbumIntoView(selectedAlbumId ?? deckAlbumId));
        return;
      default:
        return;
    }
  }

  function handleWheel(event: WheelEvent) {
    if (!shelfViewportEl) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    shelfViewportEl.scrollLeft += event.deltaY;
  }

  $: userCategories = [
    ...new Set(albums.flatMap((album) => album.categories ?? [])),
  ].sort((a, b) => a.localeCompare(b, "zh"));

  $: categoryOptions = userCategories.map((name) => ({
    id: name,
    label: name,
    count: albums.filter((album) => (album.categories ?? []).includes(name)).length,
  }));

  $: filterOptions = [
    { id: ALL_ID, label: "全部", count: albums.length },
    { id: FAVORITES_ID, label: "收藏", count: albums.filter((a) => favoriteAlbumIds.has(a.id)).length },
    { id: RECENT_ID, label: "最近播放", count: recentAlbumIds.filter((id) => albums.some((a) => a.id === id)).length },
    ...categoryOptions,
  ] satisfies FilterOption[];

  $: if (!filterOptions.some((option) => option.id === activeFilterId)) {
    activeFilterId = ALL_ID;
  }

  $: visibleAlbums = (() => {
    if (activeFilterId === ALL_ID) return [...albums];
    if (activeFilterId === FAVORITES_ID) {
      return albums.filter((album) => favoriteAlbumIds.has(album.id));
    }
    if (activeFilterId === RECENT_ID) {
      const byId = new Map(albums.map((a) => [a.id, a]));
      return recentAlbumIds.map((id) => byId.get(id)).filter((a): a is LibraryAlbum => !!a);
    }
    return albums.filter((album) =>
      (album.categories ?? []).includes(activeFilterId),
    );
  })();

  $: visibleAlbumIds = new Set(visibleAlbums.map((album) => album.id));

  $: if (
    focusedAlbumId &&
    (!visibleAlbumIds.has(focusedAlbumId) || visibleAlbums.length === 0)
  ) {
    focusedAlbumId =
      (selectedAlbumId && visibleAlbumIds.has(selectedAlbumId)
        ? selectedAlbumId
        : deckAlbumId && visibleAlbumIds.has(deckAlbumId)
          ? deckAlbumId
          : visibleAlbums[0]?.id) ?? null;
  }

  $: rovingAlbumId =
    focusedAlbumId ??
    (selectedAlbumId && visibleAlbumIds.has(selectedAlbumId) ? selectedAlbumId : null) ??
    (deckAlbumId && visibleAlbumIds.has(deckAlbumId) ? deckAlbumId : null) ??
    visibleAlbums[0]?.id ??
    null;

  function openLibraryManager() {
    onOpenWorkshop();
  }
</script>

<section class="cabinet-mode" aria-label="专辑架 Cabinet Mode">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="shelf-viewport"
    bind:this={shelfViewportEl}
    role="group"
    on:keydown={handleKeydown}
    on:wheel={handleWheel}
    aria-label="唱片列表"
  >
    <div class="shelf-back" aria-hidden="true"></div>
    <div class="shelf-scroll" bind:this={shelfViewportEl}>
      <div class="shelf-track" bind:this={shelfTrackEl}>
        {#if visibleAlbums.length === 0}
          <div class="empty-shelf">
            {#if activeFilterId === FAVORITES_ID}
              <p>还没有收藏的专辑</p>
            {:else if activeFilterId === RECENT_ID}
              <p>暂无最近播放记录</p>
            {:else}
              <p>这里还没有唱片</p>
              <button type="button" on:click={onOpenWorkshop}>管理专辑</button>
            {/if}
          </div>
        {:else}
          {#each visibleAlbums as album (album.id)}
            <ShelfAlbumItem
              {album}
              isFocused={album.id === focusedAlbumId}
              isSelected={album.id === selectedAlbumId}
              isPlaying={album.id === deckAlbumId}
              {isTransportActive}
              tabIndex={album.id === rovingAlbumId ? 0 : -1}
              onFocusAlbum={() => {
                focusedAlbumId = album.id;
              }}
              onSelect={() => chooseAlbum(album.id)}
              onPlay={() => void playAlbum(album.id)}
            />
          {/each}
        {/if}
      </div>
    </div>
    <div class="shelf-lip" aria-hidden="true"></div>
    <div class="shelf-side shelf-side--left" aria-hidden="true"></div>
    <div class="shelf-side shelf-side--right" aria-hidden="true"></div>
  </div>

  <footer class="filter-bar" aria-label="索引筛选">
    <button
      class="library-action"
      type="button"
      on:click={openLibraryManager}
      title="管理曲库"
      aria-label="管理曲库"
    >
      <span class="library-icon" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
    </button>
    <div class="filter-strip">
      {#each filterOptions as option (option.id)}
        <button
          class:active={activeFilterId === option.id}
          type="button"
          on:click={() => setFilter(option.id)}
          aria-pressed={activeFilterId === option.id}
        >
          <span>{option.label}</span>
          <small>{option.count}</small>
        </button>
      {/each}
    </div>
  </footer>
</section>

<style>
  .cabinet-mode {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr) 50px;
    gap: 8px;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 10px 12px 11px;
    overflow: hidden;
    border-radius: 14px;
    background:
      linear-gradient(180deg, rgba(133, 87, 43, 0.98) 0%, rgba(83, 51, 21, 0.98) 100%),
      repeating-linear-gradient(
        90deg,
        rgba(38, 18, 5, 0.16) 0,
        rgba(38, 18, 5, 0.16) 1px,
        transparent 1px,
        transparent 8px
      );
    box-shadow:
      inset 0 1px 0 rgba(255, 232, 190, 0.24),
      inset 0 0 0 1px rgba(38, 18, 5, 0.6),
      0 14px 26px -12px rgba(0, 0, 0, 0.62);
  }

  .cabinet-mode::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='420' height='420'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.22  0 0 0 0 0.12  0 0 0 0 0.04  0 0 0 0.28 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    background-size: 220px 220px;
    mix-blend-mode: multiply;
    opacity: 0.65;
    pointer-events: none;
  }

  .shelf-viewport,
  .filter-bar {
    position: relative;
    z-index: 1;
  }

  .library-action,
  .filter-strip button,
  .empty-shelf button {
    font: inherit;
    cursor: pointer;
  }

  .shelf-viewport {
    min-height: 0;
    overflow: hidden;
    border-radius: 8px;
    outline: none;
    background:
      radial-gradient(ellipse at 50% 6%, rgba(224, 170, 86, 0.16), transparent 38%),
      linear-gradient(180deg, #21150a 0%, #110b06 54%, #2b190b 100%);
    box-shadow:
      inset 0 5px 11px rgba(0, 0, 0, 0.86),
      inset 0 -1px 0 rgba(255, 224, 160, 0.08),
      inset 0 0 0 1px rgba(0, 0, 0, 0.74);
  }

  .shelf-viewport:focus-visible {
    box-shadow:
      inset 0 5px 11px rgba(0, 0, 0, 0.86),
      inset 0 -1px 0 rgba(255, 224, 160, 0.08),
      inset 0 0 0 1px rgba(0, 0, 0, 0.74),
      0 0 0 2px rgba(240, 180, 75, 0.45);
  }

  .shelf-back {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background:
      repeating-linear-gradient(
        90deg,
        rgba(154, 101, 44, 0.07) 0,
        rgba(154, 101, 44, 0.07) 1px,
        transparent 1px,
        transparent 18px
      ),
      linear-gradient(90deg, rgba(0, 0, 0, 0.36), transparent 8%, transparent 92%, rgba(0, 0, 0, 0.36));
    pointer-events: none;
  }

  .shelf-scroll {
    position: absolute;
    inset: 0 18px 0 18px;
    z-index: 2;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(199, 154, 91, 0.58) rgba(255, 235, 190, 0.08);
  }

  .shelf-scroll::-webkit-scrollbar {
    height: 6px;
  }

  .shelf-scroll::-webkit-scrollbar-track {
    background: rgba(255, 235, 190, 0.08);
  }

  .shelf-scroll::-webkit-scrollbar-thumb {
    background: rgba(199, 154, 91, 0.58);
    border-radius: 999px;
  }

  .shelf-track {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    min-width: max-content;
    height: 100%;
    padding: 2px 14px 10px;
  }

  .shelf-lip {
    position: absolute;
    left: 18px;
    right: 18px;
    bottom: 7px;
    z-index: 4;
    display: block;
    height: 9px;
    border-radius: 2px;
    background:
      linear-gradient(180deg, #5a3518 0%, #2a1607 100%);
    box-shadow:
      inset 0 1px 1px rgba(255, 222, 160, 0.16),
      inset 0 -2px 3px rgba(0, 0, 0, 0.76),
      0 -1px 3px rgba(0, 0, 0, 0.38);
    pointer-events: none;
  }

  .shelf-side {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 5;
    display: block;
    width: 18px;
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.42), transparent 76%),
      linear-gradient(180deg, rgba(82, 51, 23, 0.9), rgba(28, 16, 7, 0.98));
    pointer-events: none;
  }

  .shelf-side--left {
    left: 0;
  }

  .shelf-side--right {
    right: 0;
    transform: scaleX(-1);
  }

  .empty-shelf {
    align-self: stretch;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 10px;
    width: min(760px, calc(100vw - 80px));
    min-width: 520px;
    color: rgba(242, 232, 214, 0.78);
    text-align: center;
  }

  .empty-shelf p {
    margin: 0;
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 17px;
    letter-spacing: 0.08em;
  }

  .empty-shelf button {
    border: 1px solid rgba(224, 184, 112, 0.44);
    border-radius: 4px;
    padding: 6px 15px;
    background: rgba(0, 0, 0, 0.26);
    color: #f2e8d6;
    font-family: "Noto Serif SC", serif;
    font-size: 12px;
    letter-spacing: 0.08em;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 5px 6px;
    border-radius: 4px 4px 9px 9px;
    background:
      linear-gradient(180deg, rgba(33, 22, 12, 0.62), rgba(17, 11, 6, 0.5));
    box-shadow:
      inset 0 1px 0 rgba(255, 232, 190, 0.08),
      inset 0 -1px 0 rgba(0, 0, 0, 0.48);
  }

  .library-action {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 3px;
    background:
      linear-gradient(180deg, #d9aa69 0%, #8f612b 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 240, 210, 0.42),
      inset 0 -1px 0 rgba(62, 35, 11, 0.42),
      0 1px 2px rgba(0, 0, 0, 0.45);
  }

  .library-icon {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 4px);
    gap: 3px;
    align-items: end;
    height: 18px;
  }

  .library-icon span {
    display: block;
    width: 4px;
    height: 18px;
    border-radius: 1px;
    background:
      linear-gradient(180deg, #38220e 0%, #1b1006 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 224, 160, 0.22),
      1px 0 0 rgba(255, 232, 180, 0.12);
  }

  .library-icon span:nth-child(2) {
    height: 15px;
  }

  .library-icon span:nth-child(3) {
    height: 17px;
  }

  .filter-strip {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow-x: auto;
    padding: 0;
    scrollbar-width: none;
  }

  .filter-strip::-webkit-scrollbar {
    display: none;
  }

  .filter-strip button {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 64px;
    height: 38px;
    border: 0;
    border-radius: 3px;
    padding: 0 14px;
    background:
      linear-gradient(180deg, #6d4620 0%, #38200e 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 232, 190, 0.14),
      inset 0 -1px 0 rgba(0, 0, 0, 0.38),
      0 1px 2px rgba(0, 0, 0, 0.32);
    color: rgba(238, 213, 168, 0.76);
    font-family: "Noto Serif SC", serif;
    font-size: 14px;
    letter-spacing: 0.08em;
    line-height: 1;
    transition:
      background 180ms ease,
      color 140ms ease,
      box-shadow 180ms ease;
  }

  .filter-strip button.active {
    color: #2d1b0a;
    background:
      linear-gradient(180deg, #e5bc77 0%, #aa7432 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 244, 218, 0.52),
      inset 0 -1px 0 rgba(70, 40, 13, 0.34),
      0 0 0 1px rgba(35, 20, 7, 0.45),
      0 1px 3px rgba(0, 0, 0, 0.36);
  }

  .filter-strip small {
    color: currentColor;
    font-family: "JetBrains Mono", "Courier New", monospace;
    font-size: 11px;
    letter-spacing: 0.04em;
    line-height: 1;
    opacity: 0.72;
  }

  button:hover {
    filter: brightness(1.05);
  }

  button:focus-visible {
    outline: 2px solid rgba(240, 180, 75, 0.74);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .filter-strip button {
      transition-duration: 50ms !important;
    }
  }
</style>
