<script lang="ts">
  import type { LibraryAlbum } from "../types";
  import { countAlbumTracks, getAlbumDuration } from "../library/model";
  import { getFallbackCoverAccent, resolveCoverAccent } from "./coverAccent";

  export let album: LibraryAlbum;
  export let isFocused = false;
  export let isSelected = false;
  export let isPlaying = false;
  export let isTransportActive = false;
  export let tabIndex = -1;
  export let onFocusAlbum: () => void = () => {};
  export let onSelect: () => void = () => {};
  export let onPlay: () => void = () => {};

  function seed(value: string): number {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function getSpineStyle(targetAlbum: LibraryAlbum): string {
    const base = `${targetAlbum.title}-${targetAlbum.artist}`;
    const hue = Math.round(18 + seed(base) * 205);
    const sat = Math.round(18 + seed(`${base}:sat`) * 24);
    const light = Math.round(18 + seed(`${base}:light`) * 18);
    const width = Math.round(39 + seed(`${base}:width`) * 13);
    const tilt = (seed(`${base}:tilt`) - 0.5) * 2.8;
    return [
      `--spine-hue:${hue}`,
      `--spine-sat:${sat}%`,
      `--spine-light:${light}%`,
      `--closed-width:${width}px`,
      `--spine-tilt:${tilt.toFixed(2)}deg`,
      `--spine-accent-rgb:${coverAccentRgb}`,
      targetAlbum.coverUrl ? `--spine-cover:url("${escapeCssUrl(targetAlbum.coverUrl)}")` : "",
    ].join(";");
  }

  function escapeCssUrl(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function getMonogram(title: string): string {
    return (title.trim()[0] ?? "L").toUpperCase();
  }

  function formatTime(seconds: number): string {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }

  function handleClick() {
    onSelect();
  }

  function handleDblClick(event: MouseEvent) {
    event.preventDefault();
    onPlay();
  }

  $: trackCount = countAlbumTracks(album);
  $: sideCount = album.sides.length;
  $: discCount = Math.max(1, Math.ceil(sideCount / 2));
  $: duration = formatTime(getAlbumDuration(album));
  $: fallbackAccentRgb = getFallbackCoverAccent(album);
  let coverAccentRgb = fallbackAccentRgb;
  let accentToken = 0;

  $: {
    const token = ++accentToken;
    const coverUrl = album.coverUrl;
    coverAccentRgb = fallbackAccentRgb;
    if (coverUrl) {
      void resolveCoverAccent(coverUrl).then((accent) => {
        if (token === accentToken && accent) {
          coverAccentRgb = accent;
        }
      });
    }
  }

  $: visualState = isPlaying
    ? "playing"
    : isSelected
      ? "selected"
      : isFocused
        ? "focus"
        : "idle";
  $: isPulled = visualState === "focus" || visualState === "selected";
  $: spineStyle = getSpineStyle(album);
</script>

<button
  class="shelf-album"
  class:pulled={isPulled}
  class:selected-state={visualState === "selected"}
  class:focus-state={visualState === "focus"}
  class:playing-state={visualState === "playing"}
  class:transport-active={isPlaying && isTransportActive}
  type="button"
  style={spineStyle}
  data-album-id={album.id}
  data-state={visualState}
  tabindex={tabIndex}
  aria-label="{album.title}，{album.artist || '未署名艺人'}"
  aria-current={isSelected ? "true" : undefined}
  on:mouseenter={onFocusAlbum}
  on:focus={onFocusAlbum}
  on:click={handleClick}
  on:dblclick={handleDblClick}
>
  <span class="slot-shadow" aria-hidden="true"></span>

  <span class="spine" aria-hidden={isPulled ? "true" : undefined}>
    <span class="spine-ridge spine-ridge--left"></span>
    <span class="spine-title">{album.title}</span>
    <span class="spine-artist">{album.artist || "UNKNOWN"}</span>
    <span class="spine-ridge spine-ridge--right"></span>
  </span>

  <span class="preview" aria-hidden={!isPulled}>
    <span class="cover-shell">
      {#if album.coverUrl}
        <img src={album.coverUrl} alt="" draggable="false" />
      {:else}
        <span class="cover-mono">{getMonogram(album.title)}</span>
      {/if}
      <span class="cover-gloss"></span>
    </span>
    <span class="preview-meta">
      <strong class:scrolling-title={album.title.length > 18}>
        {#if album.title.length > 18}
          <span class="title-marquee">
            <span>{album.title}</span>
            <span aria-hidden="true">{album.title}</span>
          </span>
        {:else}
          <span class="title-single">{album.title}</span>
        {/if}
      </strong>
      <span>{album.artist || "未署名艺人"}</span>
      <small class="preview-stats">
        <span>{discCount} 张碟</span>
        <span>{sideCount} 面</span>
        <span>{trackCount} 首</span>
        <span>{duration}</span>
      </small>
    </span>
  </span>

  <span class="playing-slot" aria-hidden={!isPlaying}>
    <span class="slot-void"></span>
    <span class="slot-plate">ON PLATTER</span>
    <span class="slot-title">{album.title}</span>
    <span class="slot-led"></span>
  </span>
</button>

<style>
  .shelf-album {
    position: relative;
    flex: 0 0 auto;
    display: block;
    width: var(--closed-width, 30px);
    height: 100%;
    border: 0;
    padding: 0;
    overflow: visible;
    background: transparent;
    cursor: pointer;
    transform: translateY(0) rotate(var(--spine-tilt, 0deg));
    transform-origin: center bottom;
    transition:
      width 250ms ease-out,
      transform 240ms ease-out,
      filter 140ms ease,
      opacity 140ms ease;
    scroll-snap-align: center;
  }

  .shelf-album.pulled {
    width: 286px;
    transform: translateY(-8px) rotate(0deg);
    z-index: 20;
  }

  .shelf-album.selected-state {
    width: 286px;
    transform: translateY(-8px) rotate(0deg);
    z-index: 28;
  }

  .shelf-album.playing-state {
    width: 60px;
    transform: translateY(0) rotate(0deg);
    z-index: 18;
  }

  .slot-shadow {
    position: absolute;
    left: 3px;
    right: 3px;
    bottom: -4px;
    height: 12px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.42);
    filter: blur(4px);
    opacity: 0.55;
    pointer-events: none;
  }

  .spine {
    position: absolute;
    left: 0;
    bottom: 0;
    width: var(--closed-width, 30px);
    height: 95%;
    overflow: hidden;
    border-radius: 2px;
    background:
      linear-gradient(
        90deg,
        rgba(0, 0, 0, 0.58) 0%,
        transparent 20%,
        rgba(255, 242, 206, 0.08) 48%,
        rgba(0, 0, 0, 0.56) 100%
      ),
      linear-gradient(
        180deg,
        rgba(0, 0, 0, 0.32) 0%,
        rgba(0, 0, 0, 0.08) 28%,
        rgba(0, 0, 0, 0.14) 62%,
        rgba(0, 0, 0, 0.56) 100%
      ),
      var(--spine-cover,
      linear-gradient(
        180deg,
        hsl(var(--spine-hue) var(--spine-sat) calc(var(--spine-light) + 9%)) 0%,
        hsl(var(--spine-hue) var(--spine-sat) var(--spine-light)) 52%,
        hsl(var(--spine-hue) var(--spine-sat) calc(var(--spine-light) - 8%)) 100%
      ));
    background-position: center;
    background-size: auto, auto, cover;
    box-shadow:
      2px 0 3px rgba(0, 0, 0, 0.48),
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      inset -1px 0 0 rgba(0, 0, 0, 0.52),
      inset 1px 0 0 rgba(255, 230, 185, 0.08);
    transition:
      opacity 140ms ease,
      transform 220ms ease-out,
      box-shadow 160ms ease;
  }

  .shelf-album.pulled .spine {
    opacity: 0;
    transform: translateX(-9px) scaleX(0.7);
    box-shadow:
      2px 0 5px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.13),
      inset -1px 0 0 rgba(0, 0, 0, 0.52);
  }

  .shelf-album.playing-state .spine,
  .shelf-album.playing-state .preview {
    opacity: 0;
    pointer-events: none;
  }

  .spine::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      repeating-linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.035) 0,
        rgba(255, 255, 255, 0.035) 1px,
        transparent 1px,
        transparent 6px
      ),
      radial-gradient(ellipse at 50% 10%, rgba(255, 235, 185, 0.16), transparent 36%);
    mix-blend-mode: screen;
    opacity: 0.7;
    pointer-events: none;
  }

  .spine-ridge {
    position: absolute;
    top: 7px;
    bottom: 7px;
    width: 1px;
    background: rgba(255, 230, 185, 0.12);
  }

  .spine-ridge--left {
    left: 5px;
  }

  .spine-ridge--right {
    right: 5px;
    background: rgba(0, 0, 0, 0.34);
  }

  .spine-title {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 2;
    display: grid;
    place-items: center;
    width: max-content;
    max-width: calc(var(--closed-width, 30px) + 14px);
    height: min(188px, calc(100% - 86px));
    max-height: 188px;
    transform: translate(-50%, -50%);
    writing-mode: vertical-rl;
    text-orientation: mixed;
    color: rgba(255, 247, 224, 0.96);
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.15em;
    line-height: 1.06;
    overflow: hidden;
    padding: 10px 4px;
    border-radius: 999px;
    text-transform: uppercase;
    text-align: center;
    text-shadow:
      0 1px 2px rgba(0, 0, 0, 0.92),
      0 0 5px rgba(0, 0, 0, 0.72),
      0 0 10px rgba(var(--spine-accent-rgb), 0.38);
  }

  .spine-title::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: -12px -7px;
    border-radius: 999px;
    background:
      linear-gradient(
        180deg,
        rgba(var(--spine-accent-rgb), 0.62) 0%,
        rgba(var(--spine-accent-rgb), 0.34) 44%,
        rgba(var(--spine-accent-rgb), 0.12) 72%,
        transparent 100%
      );
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      0 0 0 1px rgba(255, 244, 214, 0.08);
    opacity: 0.78;
  }

  .spine-artist {
    position: absolute;
    left: 50%;
    bottom: 12px;
    max-height: 48px;
    transform: translateX(-50%);
    writing-mode: vertical-rl;
    color: rgba(226, 190, 126, 0.58);
    font-family: "JetBrains Mono", "Courier New", monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    line-height: 1;
    overflow: hidden;
    text-transform: uppercase;
  }

	  .preview {
	    position: absolute;
	    left: 0;
	    bottom: 0;
	    --preview-pad: 14px;
	    display: flex;
	    flex-direction: column;
	    width: 286px;
	    height: 95%;
    overflow: hidden;
    border-radius: 4px;
    border: 1px solid rgba(42, 24, 8, 0.72);
    background:
      linear-gradient(180deg, #1f1c17 0%, #11100d 100%);
    box-shadow:
      0 16px 24px -8px rgba(0, 0, 0, 0.72),
      0 0 0 1px rgba(234, 181, 88, 0),
      inset 0 1px 0 rgba(255, 240, 210, 0.08);
    opacity: 0;
    pointer-events: none;
    transform: translateX(-18px);
    transform-origin: left bottom;
    transition:
      opacity 140ms ease,
      transform 260ms ease-out,
      box-shadow 180ms ease,
      border-color 180ms ease;
  }

  .shelf-album.pulled .preview {
    opacity: 1;
    transform: translateX(0);
  }

  .shelf-album.focus-state .preview {
    box-shadow:
      0 17px 28px -8px rgba(0, 0, 0, 0.78),
      0 0 0 1px rgba(226, 170, 76, 0.34),
      inset 0 1px 0 rgba(255, 240, 210, 0.1);
  }

  .shelf-album.selected-state .preview {
    border-color: rgba(226, 170, 76, 0.72);
    box-shadow:
      0 20px 32px -8px rgba(0, 0, 0, 0.82),
      0 0 0 2px rgba(226, 170, 76, 0.5),
      0 0 18px rgba(226, 170, 76, 0.18),
      inset 0 1px 0 rgba(255, 240, 210, 0.1);
  }

	  .cover-shell {
	    position: relative;
	    display: block;
	    flex: 0 0 auto;
	    align-self: center;
	    width: calc(100% - var(--preview-pad) * 2);
	    height: auto;
	    aspect-ratio: 1;
	    margin: var(--preview-pad) var(--preview-pad) 0;
	    overflow: hidden;
    border-radius: 2px;
    background: linear-gradient(145deg, #dbc59a, #765022);
    box-shadow:
      0 3px 6px rgba(0, 0, 0, 0.42),
      inset 0 0 0 1px rgba(255, 244, 214, 0.14);
  }

  .cover-shell img,
  .cover-mono {
    display: block;
    width: 100%;
    height: 100%;
  }

  .cover-shell img {
    object-fit: cover;
    user-select: none;
  }

  .cover-mono {
    display: grid;
    place-items: center;
    color: rgba(255, 239, 204, 0.5);
    font-family: "Cormorant Garamond", serif;
    font-size: 78px;
    font-weight: 700;
  }

  .cover-gloss {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(140deg, rgba(255, 255, 255, 0.2), transparent 38%),
      linear-gradient(0deg, rgba(0, 0, 0, 0.28), transparent 46%);
    pointer-events: none;
  }

  .preview-meta {
    display: grid;
    flex: 1 1 auto;
    grid-template-rows: 30px 22px minmax(12px, 1fr) auto;
    gap: 5px;
    min-height: 0;
    margin-top: var(--preview-pad);
    padding: 14px 14px 7px;
    border-top: 1px dashed rgba(226, 170, 76, 0.32);
    background:
      linear-gradient(180deg, rgba(14, 12, 10, 0.92), rgba(8, 7, 6, 0.98));
    color: #f2e8d6;
    text-align: left;
  }

  .preview-meta strong,
  .preview-meta > span,
  .preview-meta small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preview-meta strong {
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 26px;
    font-weight: 600;
    line-height: 1.02;
    white-space: nowrap;
  }

  .title-single {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .scrolling-title {
    position: relative;
    display: block;
  }

  .title-marquee {
    display: inline-flex;
    gap: 34px;
    min-width: max-content;
    animation: preview-title-marquee 9s linear infinite;
    will-change: transform;
  }

  .title-marquee span {
    flex: 0 0 auto;
  }

  @keyframes preview-title-marquee {
    0%,
    18% {
      transform: translateX(0);
    }
    88%,
    100% {
      transform: translateX(calc(-50% - 17px));
    }
  }

  .preview-meta > span {
    color: rgba(242, 232, 214, 0.78);
    font-family: "Noto Serif SC", serif;
    font-size: 18px;
    line-height: 1.1;
    white-space: nowrap;
  }

  .preview-meta small {
    color: rgba(226, 190, 126, 0.66);
    font-family: "JetBrains Mono", "Courier New", monospace;
    font-size: 14px;
    letter-spacing: 0.04em;
  }

	  .preview-stats {
	    align-self: end;
	    display: flex;
	    align-items: baseline;
	    gap: 8px;
	    width: 100%;
	    line-height: 1.1;
	    white-space: nowrap;
	  }

	  .preview-stats span {
	    flex: 0 1 auto;
	    min-width: max-content;
	  }

	  .preview-stats span:not(:last-child)::after {
	    content: "·";
	    margin-left: 8px;
	    color: rgba(226, 190, 126, 0.42);
	  }

	  .preview-stats span:last-child {
	    margin-left: auto;
	  }

  .playing-slot {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 60px;
    height: 95%;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 2px;
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 140ms ease,
      box-shadow 240ms ease;
  }

  .shelf-album.playing-state .playing-slot {
    opacity: 1;
  }

  .slot-void {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background:
      linear-gradient(90deg, rgba(0, 0, 0, 0.82), rgba(29, 18, 8, 0.98) 48%, rgba(0, 0, 0, 0.78)),
      repeating-linear-gradient(
        180deg,
        rgba(255, 227, 168, 0.03) 0,
        rgba(255, 227, 168, 0.03) 1px,
        transparent 1px,
        transparent 9px
      );
    box-shadow:
      inset 0 0 12px rgba(0, 0, 0, 0.9),
      inset 0 0 0 1px rgba(226, 170, 76, 0.18);
  }

  .slot-plate {
    position: absolute;
    top: 13px;
    left: 50%;
    z-index: 2;
    transform: translateX(-50%);
    writing-mode: vertical-rl;
    color: rgba(231, 181, 96, 0.82);
    font-family: "JetBrains Mono", "Courier New", monospace;
    font-size: 7px;
    letter-spacing: 0.12em;
    text-shadow: 0 0 6px rgba(231, 181, 96, 0.22);
  }

  .slot-title {
    position: absolute;
    left: 50%;
    bottom: 34px;
    z-index: 2;
    max-height: 94px;
    transform: translateX(-50%);
    writing-mode: vertical-rl;
    color: rgba(242, 232, 214, 0.52);
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 11px;
    letter-spacing: 0.13em;
    line-height: 1;
    overflow: hidden;
    text-transform: uppercase;
  }

  .slot-led {
    position: absolute;
    left: 50%;
    bottom: 15px;
    z-index: 3;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transform: translateX(-50%);
    background: #5e3c16;
    box-shadow:
      inset 0 0 2px rgba(0, 0, 0, 0.9),
      0 0 0 rgba(240, 180, 75, 0);
  }

  .shelf-album.transport-active .slot-led {
    background: radial-gradient(circle at 35% 30%, #fff0a8 0%, #f0b44b 48%, #b45e18 100%);
    box-shadow:
      inset 0 0 1px rgba(255, 250, 218, 0.95),
      0 0 7px rgba(240, 180, 75, 0.88),
      0 0 18px rgba(214, 111, 39, 0.42);
  }

  .shelf-album:focus-visible {
    outline: none;
  }

  .shelf-album:focus-visible .spine,
  .shelf-album:focus-visible .preview,
  .shelf-album:focus-visible .playing-slot {
    box-shadow:
      0 0 0 2px rgba(240, 180, 75, 0.72),
      0 10px 22px rgba(0, 0, 0, 0.55);
  }

  @media (prefers-reduced-motion: reduce) {
    .shelf-album,
    .spine,
    .preview,
    .playing-slot {
      transition-duration: 50ms !important;
    }
  }
</style>
