import { invoke, isTauri } from '@tauri-apps/api/core';
import type { LibraryAlbum } from '../types';
import { hydrateLibraryAlbum, serializeLibraryAlbum } from './model';

export async function loadLibrary(): Promise<LibraryAlbum[]> {
  if (!isTauri()) return [];

  const albums = await invoke<LibraryAlbum[]>('load_library');
  return albums.map(hydrateLibraryAlbum);
}

export async function saveLibraryAlbum(album: LibraryAlbum): Promise<LibraryAlbum> {
  if (!isTauri()) {
    return album;
  }

  const savedAlbum = await invoke<LibraryAlbum>('save_album', {
    album: serializeLibraryAlbum(album),
  });

  return hydrateLibraryAlbum(savedAlbum);
}

export async function deleteLibraryAlbum(albumId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('delete_album', { albumId });
}

export async function toggleFavoriteAlbum(albumId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('toggle_favorite', { albumId });
}

export async function recordAlbumPlay(albumId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('record_play', { albumId });
}

export async function getRecentlyPlayed(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('get_recently_played');
}
