import type { Track, Album, DiscSide } from '../types';

// 标准 LP 单面最大时长（秒）。超过会影响音质，这里定 23 分钟。
export const MAX_SIDE_DURATION = 23 * 60;

const SIDE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * 将超长的单曲（时长 > maxSideDuration）展开为多个虚拟分段，
 * 每段带有 startOffset / endOffset，指向源文件中的时间范围。
 * 若曲目时长在限制内，直接原样返回。
 */
export function expandLongTrack(track: Track, maxSideDuration: number): Track[] {
  if (track.duration <= maxSideDuration) return [track];

  const totalParts = Math.ceil(track.duration / maxSideDuration);
  const segments: Track[] = [];

  for (let i = 0; i < totalParts; i++) {
    const startOffset = i * maxSideDuration;
    const endOffset = Math.min((i + 1) * maxSideDuration, track.duration);
    segments.push({
      ...track,
      id: `${track.id}-seg${i + 1}`,
      duration: endOffset - startOffset,
      startOffset,
      endOffset,
    });
  }

  return segments;
}

/**
 * 将曲目列表按时长分配到碟面（仅在曲目边界处切面）。
 * 超长单曲不会在此处展开——展开逻辑由调用方在需要时处理。
 * 每张碟有两面（正反），所以碟片数 = ceil(面数 / 2)。
 */
export function splitTracksIntoSides(
  tracks: Track[],
  maxSideDuration: number = MAX_SIDE_DURATION
): DiscSide[] {
  const sides: DiscSide[] = [];
  let currentSideTracks: Track[] = [];
  let currentSideDuration = 0;

  for (const track of tracks) {
    const willExceed = currentSideDuration + track.duration > maxSideDuration;

    if (willExceed && currentSideTracks.length > 0) {
      // 当前面已满，封存并开新面
      sides.push(buildSide(sides.length, currentSideTracks, currentSideDuration));
      currentSideTracks = [];
      currentSideDuration = 0;
    }

    currentSideTracks.push(track);
    currentSideDuration += track.duration;
  }

  // 最后一面
  if (currentSideTracks.length > 0) {
    sides.push(buildSide(sides.length, currentSideTracks, currentSideDuration));
  }

  return sides;
}

function buildSide(sideIndex: number, tracks: Track[], totalDuration: number): DiscSide {
  return {
    label: SIDE_LABELS[sideIndex] ?? String(sideIndex + 1),
    discIndex: Math.floor(sideIndex / 2),
    sideIndex,
    tracks,
    totalDuration,
  };
}

export function buildAlbum(
  id: string,
  title: string,
  artist: string,
  tracks: Track[],
  coverUrl?: string,
  discArtUrl?: string
): Album {
  const sides = splitTracksIntoSides(tracks);
  return {
    id,
    title,
    artist,
    coverUrl,
    discArtUrl,
    sides,
    discs: Math.ceil(sides.length / 2),
  };
}

export function buildAlbumFromSides(
  id: string,
  title: string,
  artist: string,
  sideTracks: Track[][],
  coverUrl?: string,
  discArtUrl?: string
): Album {
  const sides = sideTracks
    .filter((tracks) => tracks.length > 0)
    .map((tracks, sideIndex) =>
      buildSide(
        sideIndex,
        tracks,
        tracks.reduce((sum, track) => sum + track.duration, 0)
      )
    );

  return {
    id,
    title,
    artist,
    coverUrl,
    discArtUrl,
    sides,
    discs: Math.ceil(sides.length / 2),
  };
}

/**
 * 给定一个面内的播放时间（秒），返回是第几首曲目以及曲目内的偏移时间。
 */
export function resolveTrackAtTime(
  side: DiscSide,
  timeInSide: number
): { trackIndex: number; offsetInTrack: number } | null {
  let accumulated = 0;
  for (let i = 0; i < side.tracks.length; i++) {
    const track = side.tracks[i];
    if (timeInSide <= accumulated + track.duration) {
      return {
        trackIndex: i,
        offsetInTrack: timeInSide - accumulated,
      };
    }
    accumulated += track.duration;
  }
  return null; // 超出这面时长
}
