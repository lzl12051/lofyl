import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { extractEmbeddedCover } from './coverArt';
import type { Track } from '../types';

const AUDIO_FILE_PATTERN = /\.(mp3|flac|ogg|m4a|aac|wav)$/i;

interface AudioSourceEntry {
  path: string;
  displayPath: string;
  title?: string;
  artist?: string;
  trackNumber?: number;
  discNumber?: number;
  coverUrl?: string;
}

interface AudioImportSelection {
  albumTitle?: string | null;
  entries: AudioSourceEntry[];
}

export interface PreparedImport {
  albumTitle: string;
  albumArtist?: string;
  coverUrl?: string;
  tracks: Track[];
}

function isSupportedAudioFile(name: string, mimeType = ''): boolean {
  return mimeType.startsWith('audio/') || AUDIO_FILE_PATTERN.test(name);
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function stripTrackNumberPrefix(name: string): string {
  return name.replace(/^[\d\s.\-_]+/, '').trim() || name;
}

function getBaseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function compareOptionalNumber(left?: number, right?: number): number {
  if (left != null && right != null) {
    return left - right;
  }
  if (left != null) {
    return -1;
  }
  if (right != null) {
    return 1;
  }
  return 0;
}

function compareTrackOrder(left: Track, right: Track): number {
  const discOrder = compareOptionalNumber(left.discNumber, right.discNumber);
  if (discOrder !== 0) {
    return discOrder;
  }

  const trackOrder = compareOptionalNumber(left.trackNumber, right.trackNumber);
  if (trackOrder !== 0) {
    return trackOrder;
  }

  const leftPath = left.sourceDisplayPath ?? left.file?.name ?? left.title;
  const rightPath = right.sourceDisplayPath ?? right.file?.name ?? right.title;
  return leftPath.localeCompare(rightPath, undefined, { numeric: true, sensitivity: 'base' });
}

async function decodeDuration(ctx: AudioContext, data: ArrayBuffer): Promise<number> {
  try {
    const buffer = await ctx.decodeAudioData(data.slice(0));
    return buffer.duration;
  } catch {
    return 180;
  }
}

async function buildPreparedImport(
  sources: Array<{
    idBase: string;
    name: string;
    title?: string;
    artist?: string;
    trackNumber?: number;
    discNumber?: number;
    coverUrl?: string;
    displayPath?: string;
    mimeType?: string;
    file?: File;
    loadArrayBuffer: () => Promise<ArrayBuffer>;
    url: string;
  }>,
  albumTitle: string
): Promise<PreparedImport> {
  if (sources.length === 0) {
    throw new Error('没有找到支持的音频文件');
  }

  const ctx = new AudioContext();
  const tracks: Track[] = [];
  let coverUrl: string | undefined;

  try {
    for (const [index, source] of sources.entries()) {
      const arrayBuffer = await source.loadArrayBuffer();

      if (!coverUrl) {
        coverUrl = source.coverUrl ?? extractEmbeddedCover(arrayBuffer.slice(0), source.mimeType);
      }

      tracks.push({
        id: `track-${index}-${source.idBase}`,
        title: source.title ?? stripTrackNumberPrefix(stripExtension(source.name)),
        artist: source.artist?.trim() ?? '',
        trackNumber: source.trackNumber,
        discNumber: source.discNumber,
        duration: await decodeDuration(ctx, arrayBuffer),
        file: source.file,
        sourcePath: source.file ? undefined : source.idBase,
        sourceDisplayPath: source.displayPath,
        url: source.url,
      });
    }
  } finally {
    await ctx.close();
  }

  tracks.sort(compareTrackOrder);

  return {
    albumTitle,
    albumArtist: inferAlbumArtist(tracks),
    coverUrl,
    tracks,
  };
}

function inferAlbumArtist(tracks: Track[]): string | undefined {
  const artists = [...new Set(tracks.map((track) => track.artist.trim()).filter(Boolean))];
  if (artists.length === 0) {
    return undefined;
  }
  if (artists.length === 1) {
    return artists[0];
  }
  return 'Various Artists';
}

export async function prepareBrowserImport(files: File[]): Promise<PreparedImport> {
  const audioFiles = files.filter((file) => isSupportedAudioFile(file.name, file.type));
  if (audioFiles.length === 0) {
    throw new Error('没有找到支持的音频文件');
  }

  const anyFile = audioFiles[0] as File & { webkitRelativePath?: string };
  const folderName = anyFile.webkitRelativePath?.split('/')[0];

  return buildPreparedImport(
    audioFiles.map((file) => ({
      idBase: file.name,
      name: file.name,
      displayPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      mimeType: file.type,
      file,
      loadArrayBuffer: () => file.arrayBuffer(),
      url: URL.createObjectURL(file),
    })),
    folderName || '未命名专辑'
  );
}

async function prepareDesktopImport(command: 'pick_audio_files' | 'pick_audio_folder'): Promise<PreparedImport | null> {
  if (!isTauri()) {
    throw new Error('当前不是桌面环境');
  }

  const selection = await invoke<AudioImportSelection | null>(command);
  if (!selection || selection.entries.length === 0) {
    return null;
  }

  return buildPreparedImport(
    selection.entries
      .filter((entry) => isSupportedAudioFile(entry.path))
      .map((entry) => {
        const name = getBaseName(entry.path);
        const assetUrl = convertFileSrc(entry.path);

        return {
          idBase: entry.path,
          name,
          displayPath: entry.displayPath,
          title: entry.title,
          artist: entry.artist,
          trackNumber: entry.trackNumber,
          discNumber: entry.discNumber,
          coverUrl: entry.coverUrl,
          mimeType: '',
          loadArrayBuffer: async () => {
            const response = await fetch(assetUrl);
            if (!response.ok) {
              throw new Error(`无法读取文件：${entry.path}`);
            }
            return response.arrayBuffer();
          },
          url: assetUrl,
        };
      }),
    selection.albumTitle || '未命名专辑'
  );
}

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export function pickDesktopAudioFiles(): Promise<PreparedImport | null> {
  return prepareDesktopImport('pick_audio_files');
}

export function pickDesktopAudioFolder(): Promise<PreparedImport | null> {
  return prepareDesktopImport('pick_audio_folder');
}
