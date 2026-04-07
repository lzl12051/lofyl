import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { extractEmbeddedCover } from './coverArt';
import type { Track } from '../types';

const AUDIO_FILE_PATTERN = /\.(mp3|flac|ogg|m4a|aac|wav)$/i;

interface AudioSourceEntry {
  path: string;
  displayPath: string;
  title?: string;
}

interface AudioImportSelection {
  albumTitle?: string | null;
  entries: AudioSourceEntry[];
}

export interface PreparedImport {
  albumTitle: string;
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
        coverUrl = extractEmbeddedCover(arrayBuffer.slice(0), source.mimeType);
      }

      tracks.push({
        id: `track-${index}-${source.idBase}`,
        title: source.title ?? stripTrackNumberPrefix(stripExtension(source.name)),
        artist: '',
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

  tracks.sort((a, b) => {
    const left = a.sourceDisplayPath ?? a.file?.name ?? a.title;
    const right = b.sourceDisplayPath ?? b.file?.name ?? b.title;
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    albumTitle,
    coverUrl,
    tracks,
  };
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
