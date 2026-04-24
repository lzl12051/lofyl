<script lang="ts">
  import type { LibraryAlbum } from "../types";

  export let albums: LibraryAlbum[] = [];
  export let frontAlbum: LibraryAlbum | null = null;
  export let selectedAlbumId: string | null = null;
  export let isPending = false;
  export let isAll = false;
  export let label = "";
  export let onFocusAlbum: (album: LibraryAlbum) => void = () => {};
  export let onChooseAlbum: (album: LibraryAlbum) => void = () => {};
  export let onOpenWorkshop: () => void = () => {};

  const CONTENT_STAGGER_MS = 35;

  function splitTitle(title: string): string[] {
    const words = title.trim().split(/\s+/).filter(Boolean);
    return words.length > 0 ? words.slice(0, 4) : ["UNTITLED"];
  }

  function getMonogram(title: string) {
    return (title.trim()[0] ?? "L").toUpperCase();
  }
</script>

<div class="floor">
  {#if albums.length > 0 && frontAlbum}
    <div class="albums-row">
      {#each albums as album, index (album.id)}
        {@const isFront = album.id === frontAlbum.id}
        {@const titleWords = splitTitle(album.title)}
        <button
          class="album"
          class:front={isFront}
          class:side={!isFront}
          class:front--selected={isFront && album.id === selectedAlbumId}
          class:side--selected={!isFront && album.id === selectedAlbumId}
          type="button"
          title={album.title}
          aria-label={isFront ? `选择专辑 ${album.title}` : `预览专辑 ${album.title}`}
          style="--album-delay:{120 + index * CONTENT_STAGGER_MS}ms;"
          on:mouseenter={() => onFocusAlbum(album)}
          on:focus={() => onFocusAlbum(album)}
          on:click={() => onChooseAlbum(album)}
        >
          {#if isFront}
            {#if album.coverUrl}
              <span class="cover-img" style="background-image:url({album.coverUrl})" aria-hidden="true"></span>
            {:else}
              <span class="cover-mono" aria-hidden="true">{getMonogram(album.title)}</span>
            {/if}
            <span class="cover-overlay" aria-hidden="true"></span>
            <span class="cover-title" aria-hidden="true">
              {#each titleWords as word}
                <span>{word.toUpperCase()}</span>
              {/each}
            </span>
            <span class="stereo-badge" aria-hidden="true">
              <span>{album.sides.length}</span>
              <span>SIDES<br />LP</span>
            </span>
          {:else}
            {#if album.coverUrl}
              <span class="spine-art" style="background-image:url({album.coverUrl})" aria-hidden="true"></span>
            {:else}
              <span class="spine-mono" aria-hidden="true">{getMonogram(album.title)}</span>
            {/if}
            <span class="spine-shade" aria-hidden="true"></span>
            <span class="spine-txt">{album.title}</span>
          {/if}
        </button>
      {/each}
    </div>
  {:else}
    <div class="empty-drawer">
      {#if isPending}
        <p class="hint-strong">这是一个新分类</p>
        <p class="hint-weak">去 Workshop 里给专辑贴上「{label}」标签</p>
      {:else if isAll}
        <p class="hint-strong">柜子是空的</p>
        <p class="hint-weak">点底座按钮管理专辑</p>
      {:else}
        <p class="hint-weak">这个分类暂时没有专辑</p>
      {/if}
      <button class="empty-cta" type="button" on:click={onOpenWorkshop}>
        管理专辑
      </button>
    </div>
  {/if}
  <div class="inner-lip" aria-hidden="true"></div>
</div>

<style>
  .floor {
    position: relative;
    height: 232px;
    border-radius: 4px;
    background:
      radial-gradient(ellipse at 88% 22%, rgba(199, 154, 91, 0.12), transparent 20%),
      linear-gradient(180deg, #3d2611 0%, #291708 55%, #2f1d0e 100%);
    box-shadow:
      inset 0 3px 6px rgba(0, 0, 0, 0.7),
      inset 0 -1px 0 rgba(255, 230, 190, 0.08),
      inset 0 0 0 1px rgba(0, 0, 0, 0.7);
    overflow: hidden;
  }

  .floor::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 4px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.25  0 0 0 0 0.14  0 0 0 0 0.06  0 0 0 0.32 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    background-size: 200px 200px;
    mix-blend-mode: multiply;
    opacity: 0.55;
    pointer-events: none;
  }

  .floor::after {
    content: "";
    position: absolute;
    right: 18px;
    top: 28px;
    width: 18px;
    height: 46px;
    border-top: 3px solid rgba(199, 154, 91, 0.22);
    border-right: 3px solid rgba(199, 154, 91, 0.2);
    border-radius: 0 12px 0 0;
    opacity: 0.9;
    pointer-events: none;
  }

  .inner-lip {
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: 2px;
    height: 6px;
    border-radius: 1.5px;
    background: linear-gradient(180deg, #2a1808, #52341a);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.8);
    pointer-events: none;
    z-index: 3;
  }

  .albums-row {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-end;
    height: 100%;
    padding: 18px 22px 18px;
    gap: 3px;
    overflow-x: auto;
    overflow-y: hidden;
    justify-content: center;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
    scrollbar-color: rgba(199, 154, 91, 0.55) transparent;
  }

  .albums-row:has(.album:nth-child(n + 8)) {
    justify-content: flex-start;
  }

  .albums-row::-webkit-scrollbar {
    height: 4px;
  }

  .albums-row::-webkit-scrollbar-track {
    background: rgba(199, 154, 91, 0.12);
    border-radius: 999px;
  }

  .albums-row::-webkit-scrollbar-thumb {
    background: rgba(199, 154, 91, 0.55);
    border-radius: 999px;
  }

  .album {
    position: relative;
    flex-shrink: 0;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
    scroll-snap-align: center;
    opacity: 0;
    animation: album-enter 220ms cubic-bezier(0.22, 0.8, 0.24, 1) forwards;
    animation-delay: var(--album-delay);
    transition:
      width 0.3s cubic-bezier(0.22, 0.8, 0.24, 1),
      margin 0.3s cubic-bezier(0.22, 0.8, 0.24, 1),
      transform 0.24s ease,
      box-shadow 0.24s ease;
  }

  @keyframes album-enter {
    from {
      opacity: 0;
      translate: 0 18px;
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }

  .album.side {
    width: 22px;
    height: 170px;
    overflow: hidden;
    border-radius: 2px;
    background: #120d09;
    box-shadow:
      2px 0 3px rgba(0, 0, 0, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      inset -1px 0 0 rgba(0, 0, 0, 0.5);
    transform: perspective(500px) rotateX(2deg) rotateZ(-1deg);
  }

  .album.side:hover {
    transform: perspective(500px) rotateX(2deg) rotateZ(-1deg) translateY(-6px);
  }

  .album.side:focus-visible {
    outline: 2px solid rgba(240, 180, 75, 0.75);
    outline-offset: 2px;
  }

  .album.side.side--selected::after {
    content: "";
    position: absolute;
    top: 6px;
    left: 50%;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #f0b44b;
    box-shadow: 0 0 5px rgba(240, 180, 75, 0.7);
    transform: translateX(-50%);
    z-index: 4;
  }

  .spine-art {
    position: absolute;
    inset: 0;
    background-position: center;
    background-size: cover;
    filter: brightness(0.82) saturate(1.05);
  }

  .spine-mono {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: linear-gradient(160deg, #7d5730, #2a1a0b);
    color: rgba(240, 220, 180, 0.72);
    font-family: "Cormorant Garamond", serif;
    font-size: 14px;
  }

  .spine-shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.54), transparent 34%, rgba(0, 0, 0, 0.5)),
      linear-gradient(180deg, rgba(0, 0, 0, 0.34), transparent 24%, transparent 72%, rgba(0, 0, 0, 0.42));
    pointer-events: none;
  }

  .spine-txt {
    position: absolute;
    top: 10px;
    left: 50%;
    bottom: 10px;
    z-index: 2;
    display: block;
    max-height: calc(100% - 20px);
    overflow: hidden;
    color: rgba(240, 220, 180, 0.85);
    font-family: "Cormorant Garamond", serif;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.14em;
    line-height: 1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8), 0 0 6px rgba(0, 0, 0, 0.6);
    text-transform: uppercase;
    white-space: normal;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    transform: translateX(-50%);
  }

  .album.front {
    width: 174px;
    height: 174px;
    flex-shrink: 0;
    margin: 0 18px;
    overflow: hidden;
    border-radius: 2px;
    box-shadow:
      0 14px 22px -4px rgba(0, 0, 0, 0.74),
      0 0 0 1px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    transform: translate(12px, -4px) scale(1.015);
  }

  .album.front.front--selected {
    box-shadow:
      0 15px 26px -4px rgba(0, 0, 0, 0.76),
      0 0 0 2px rgba(231, 181, 96, 0.7),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .cover-img,
  .cover-mono,
  .cover-overlay {
    position: absolute;
    inset: 0;
    border-radius: 2px;
  }

  .cover-img {
    background-position: center;
    background-size: cover;
  }

  .cover-mono {
    display: grid;
    place-items: center;
    background: linear-gradient(145deg, #e4b36e, #5f3216);
    color: rgba(255, 240, 210, 0.56);
    font-family: "Cormorant Garamond", serif;
    font-size: 52px;
  }

  .cover-overlay {
    background:
      radial-gradient(circle at 78% 18%, rgba(0, 0, 0, 0.16), transparent 32%),
      linear-gradient(180deg, rgba(0, 0, 0, 0.08), transparent 42%),
      linear-gradient(0deg, rgba(0, 0, 0, 0.52), transparent 48%);
  }

  .cover-title {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 10px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-height: 45%;
    overflow: hidden;
    padding: 7px 8px 6px;
    border-left: 2px solid rgba(245, 232, 207, 0.75);
    border-radius: 2px;
    background:
      linear-gradient(90deg, rgba(12, 9, 6, 0.7), rgba(12, 9, 6, 0.4)),
      rgba(245, 232, 207, 0.1);
    color: #fff4d6;
    font-family: "Cormorant Garamond", serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.1em;
    line-height: 1.15;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.86), 0 0 10px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
  }

  .stereo-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(121, 80, 34, 0.35);
    border-radius: 50%;
    background:
      radial-gradient(circle at 38% 30%, rgba(255, 249, 226, 0.98), rgba(231, 203, 150, 0.94) 58%, rgba(194, 142, 77, 0.94)),
      #ead2a0;
    box-shadow:
      0 3px 6px rgba(0, 0, 0, 0.34),
      inset 0 1px 0 rgba(255, 255, 255, 0.68),
      inset 0 -2px 4px rgba(120, 72, 22, 0.2);
    color: #5a3414;
    font-family: "Cormorant Garamond", serif;
    font-size: 6.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.1;
    text-align: center;
    text-shadow: 0 1px 0 rgba(255, 248, 220, 0.6);
    transform: rotate(8deg);
  }

  .empty-drawer {
    position: relative;
    z-index: 2;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 6px;
    height: 100%;
    padding: 0 24px;
    color: rgba(242, 232, 214, 0.78);
    text-align: center;
  }

  .hint-strong {
    margin: 0;
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: rgba(242, 232, 214, 0.92);
  }

  .hint-weak {
    margin: 0;
    font-family: "Noto Serif SC", serif;
    font-size: 12px;
    opacity: 0.78;
  }

  .empty-cta {
    margin-top: 8px;
    padding: 5px 14px;
    border: 1px solid rgba(242, 232, 214, 0.32);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.18);
    color: #f2e8d6;
    font-family: "Noto Serif SC", serif;
    font-size: 12px;
    letter-spacing: 0.06em;
    cursor: pointer;
  }

  .empty-cta:hover {
    background: rgba(0, 0, 0, 0.3);
  }

  @media (prefers-reduced-motion: reduce) {
    .album {
      animation-duration: 50ms !important;
      animation-delay: 0ms !important;
      transition-duration: 50ms !important;
    }
  }
</style>
