import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { buildAlbumFromSides, MAX_SIDE_DURATION, splitTracksIntoSides } from '../audio/albumSplitter';
import type { PreparedImport } from '../audio/importAudio';
import type { Album, LibraryAlbum, Track } from '../types';

function cloneTrack(track: Track): Track {
  return { ...track };
}

function inferAlbumArtistFromTracks(tracks: Track[]): string {
  const artists = [...new Set(tracks.map((track) => track.artist.trim()).filter(Boolean))];
  if (artists.length === 0) {
    return '';
  }
  if (artists.length === 1) {
    return artists[0];
  }
  return 'Various Artists';
}

function hydrateTrack(track: Track): Track {
  const nextTrack = cloneTrack(track);

  if (nextTrack.sourcePath) {
    nextTrack.id = nextTrack.sourcePath;
    if (isTauri()) {
      nextTrack.url = convertFileSrc(nextTrack.sourcePath);
    }
  }

  return nextTrack;
}

function cloneSides(sides: Track[][]): Track[][] {
  return sides.map((side) => side.map(cloneTrack));
}

function removeEmptySides(album: LibraryAlbum): LibraryAlbum {
  return {
    ...album,
    sides: album.sides.filter((side) => side.length > 0),
  };
}

export function countAlbumTracks(album: LibraryAlbum): number {
  return album.sides.reduce((sum, side) => sum + side.length, 0);
}

export function getAlbumDuration(album: LibraryAlbum): number {
  return album.sides.reduce(
    (sum, side) => sum + side.reduce((sideSum, track) => sideSum + track.duration, 0),
    0
  );
}

export function getSideDuration(side: Track[]): number {
  return side.reduce((sum, track) => sum + track.duration, 0);
}

export function createLibraryAlbumFromPreparedImport(
  prepared: PreparedImport,
  albumId = crypto.randomUUID()
): LibraryAlbum {
  const hydratedTracks = prepared.tracks.map(hydrateTrack);
  const sides = splitTracksIntoSides(hydratedTracks).map((side) => side.tracks.map(cloneTrack));
  const now = Date.now();

  return {
    id: albumId,
    title: prepared.albumTitle,
    artist: prepared.albumArtist ?? inferAlbumArtistFromTracks(hydratedTracks),
    coverUrl: prepared.coverUrl,
    sides,
    createdAt: now,
    updatedAt: now,
  };
}

export function appendPreparedImportToAlbum(album: LibraryAlbum, prepared: PreparedImport): LibraryAlbum {
  const nextAlbum: LibraryAlbum = {
    ...album,
    coverUrl: album.coverUrl ?? prepared.coverUrl,
    sides: cloneSides(album.sides),
    updatedAt: Date.now(),
  };
  const knownPaths = new Set(
    nextAlbum.sides.flatMap((side) => side.map((track) => track.sourcePath).filter(Boolean))
  );

  const incomingTracks = prepared.tracks
    .map(hydrateTrack)
    .filter((track) => !track.sourcePath || !knownPaths.has(track.sourcePath));

  if (incomingTracks.length === 0) {
    return nextAlbum;
  }

  if (nextAlbum.sides.length === 0) {
    nextAlbum.sides.push([]);
  }

  let currentSide = nextAlbum.sides[nextAlbum.sides.length - 1];
  let currentDuration = getSideDuration(currentSide);

  for (const track of incomingTracks) {
    if (currentDuration + track.duration > MAX_SIDE_DURATION && currentSide.length > 0) {
      currentSide = [];
      nextAlbum.sides.push(currentSide);
      currentDuration = 0;
    }

    currentSide.push(cloneTrack(track));
    currentDuration += track.duration;
  }

  const compactAlbum = removeEmptySides(nextAlbum);
  return {
    ...compactAlbum,
    artist: inferAlbumArtistFromTracks(compactAlbum.sides.flat()),
  };
}

export function moveTrackWithinAlbum(
  album: LibraryAlbum,
  sideIndex: number,
  trackIndex: number,
  direction: 'up' | 'down' | 'left' | 'right'
): LibraryAlbum {
  const sides = cloneSides(album.sides);
  const currentSide = sides[sideIndex];
  if (!currentSide || !currentSide[trackIndex]) {
    return album;
  }

  if (direction === 'up' && trackIndex > 0) {
    [currentSide[trackIndex - 1], currentSide[trackIndex]] = [currentSide[trackIndex], currentSide[trackIndex - 1]];
  } else if (direction === 'down' && trackIndex < currentSide.length - 1) {
    [currentSide[trackIndex + 1], currentSide[trackIndex]] = [currentSide[trackIndex], currentSide[trackIndex + 1]];
  } else if (direction === 'left' && sideIndex > 0) {
    const [track] = currentSide.splice(trackIndex, 1);
    sides[sideIndex - 1].push(track);
  } else if (direction === 'right') {
    const [track] = currentSide.splice(trackIndex, 1);
    if (!sides[sideIndex + 1]) {
      sides.push([]);
    }
    sides[sideIndex + 1].unshift(track);
  } else {
    return album;
  }

  return removeEmptySides({
    ...album,
    sides,
    updatedAt: Date.now(),
  });
}

export function removeTrackFromAlbum(album: LibraryAlbum, sideIndex: number, trackIndex: number): LibraryAlbum {
  const sides = cloneSides(album.sides);
  if (!sides[sideIndex] || !sides[sideIndex][trackIndex]) {
    return album;
  }

  sides[sideIndex].splice(trackIndex, 1);

  return removeEmptySides({
    ...album,
    sides,
    updatedAt: Date.now(),
  });
}

export function renameLibraryAlbum(album: LibraryAlbum, title: string): LibraryAlbum {
  return {
    ...album,
    title: title.trim() || '未命名专辑',
    updatedAt: Date.now(),
  };
}

export function libraryAlbumToPlaybackAlbum(album: LibraryAlbum): Album {
  return buildAlbumFromSides(
    album.id,
    album.title,
    album.artist,
    album.sides.map((side) => side.map(hydrateTrack)),
    album.coverUrl
  );
}

export function hydrateLibraryAlbum(album: LibraryAlbum): LibraryAlbum {
  const hydratedSides = album.sides.map((side) => side.map(hydrateTrack));
  return {
    ...album,
    artist: album.artist.trim() || inferAlbumArtistFromTracks(hydratedSides.flat()),
    sides: hydratedSides,
  };
}

export function serializeLibraryAlbum(album: LibraryAlbum): LibraryAlbum {
  return {
    ...album,
    sides: album.sides.map((side) =>
      side
        .filter((track) => Boolean(track.sourcePath))
        .map((track) => ({
          id: track.sourcePath!,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          sourcePath: track.sourcePath,
          sourceDisplayPath: track.sourceDisplayPath ?? track.sourcePath,
        }))
    ),
  };
}
