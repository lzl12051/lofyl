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
