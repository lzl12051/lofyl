use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "ogg", "m4a", "aac", "wav"];
const LIBRARY_DB_FILE: &str = "library.sqlite3";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSourceEntry {
  path: String,
  display_path: String,
  title: String,
  artist: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioImportSelection {
  album_title: Option<String>,
  entries: Vec<AudioSourceEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibraryTrack {
  id: String,
  title: String,
  artist: String,
  duration: f64,
  source_path: String,
  source_display_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LibraryAlbum {
  id: String,
  title: String,
  artist: String,
  cover_url: Option<String>,
  sides: Vec<Vec<LibraryTrack>>,
  created_at: i64,
  updated_at: i64,
}

fn now_millis() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as i64)
    .unwrap_or(0)
}

fn is_supported_audio_path(path: &Path) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| AUDIO_EXTENSIONS.iter().any(|allowed| allowed.eq_ignore_ascii_case(ext)))
    .unwrap_or(false)
}

fn path_to_string(path: &Path) -> String {
  path.to_string_lossy().into_owned()
}

fn display_name_for_path(path: &Path) -> String {
  path
    .file_name()
    .and_then(|value| value.to_str())
    .map(ToOwned::to_owned)
    .unwrap_or_else(|| path_to_string(path))
}

fn strip_extension(name: &str) -> String {
  match name.rsplit_once('.') {
    Some((stem, _)) if !stem.is_empty() => stem.to_owned(),
    _ => name.to_owned(),
  }
}

fn strip_track_number_prefix(name: &str) -> String {
  let trimmed = name.trim_start_matches(|ch: char| {
    ch.is_ascii_digit() || ch.is_whitespace() || matches!(ch, '.' | '-' | '_')
  });

  if trimmed.is_empty() {
    name.trim().to_owned()
  } else {
    trimmed.trim().to_owned()
  }
}

fn fallback_track_title(path: &Path) -> String {
  strip_track_number_prefix(&strip_extension(&display_name_for_path(path)))
}

fn normalize_metadata_text(raw: &str) -> Option<String> {
  let trimmed = raw.trim();
  if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("(null)") || trimmed.eq_ignore_ascii_case("null") {
    return None;
  }

  Some(trimmed.trim_matches('"').to_owned())
}

fn normalize_metadata_list(raw: &str) -> Option<String> {
  let trimmed = raw.trim();
  if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("(null)") || trimmed.eq_ignore_ascii_case("null") {
    return None;
  }

  if trimmed.starts_with('(') && trimmed.ends_with(')') {
    let values = trimmed
      .lines()
      .map(str::trim)
      .filter(|line| !line.is_empty() && *line != "(" && *line != ")")
      .map(|line| line.trim_end_matches(',').trim().trim_matches('"'))
      .filter(|line| !line.is_empty())
      .map(ToOwned::to_owned)
      .collect::<Vec<_>>();

    if values.is_empty() {
      return None;
    }

    return Some(values.join(", "));
  }

  normalize_metadata_text(trimmed)
}

#[cfg(target_os = "macos")]
fn read_mdls_value(path: &Path, key: &str) -> Option<String> {
  let output = Command::new("mdls")
    .args(["-name", key, "-raw"])
    .arg(path)
    .output()
    .ok()?;

  if !output.status.success() {
    return None;
  }

  Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "macos")]
fn read_metadata_title(path: &Path) -> Option<String> {
  normalize_metadata_text(&read_mdls_value(path, "kMDItemTitle")?)
}

#[cfg(target_os = "macos")]
fn read_metadata_artist(path: &Path) -> Option<String> {
  normalize_metadata_list(&read_mdls_value(path, "kMDItemAuthors")?)
}

#[cfg(not(target_os = "macos"))]
fn read_metadata_title(_path: &Path) -> Option<String> {
  None
}

#[cfg(not(target_os = "macos"))]
fn read_metadata_artist(_path: &Path) -> Option<String> {
  None
}

fn resolve_track_metadata_for_path(path: &Path) -> (String, String) {
  (
    read_metadata_title(path).unwrap_or_else(|| fallback_track_title(path)),
    read_metadata_artist(path).unwrap_or_default(),
  )
}

fn load_track_title(source_path: &str, stored_title: &str) -> String {
  let path = Path::new(source_path);
  if path.exists() {
    return resolve_track_metadata_for_path(path).0;
  }

  if stored_title.trim().is_empty() {
    fallback_track_title(path)
  } else {
    stored_title.to_owned()
  }
}

fn load_track_artist(source_path: &str, stored_artist: &str) -> String {
  let path = Path::new(source_path);
  if path.exists() {
    let metadata_artist = resolve_track_metadata_for_path(path).1;
    if !metadata_artist.trim().is_empty() {
      return metadata_artist;
    }
  }

  stored_artist.to_owned()
}

fn collect_audio_entries(dir: &Path, root: &Path, entries: &mut Vec<AudioSourceEntry>) -> Result<(), String> {
  let read_dir = fs::read_dir(dir).map_err(|err| format!("无法读取目录 {}: {err}", path_to_string(dir)))?;

  for item in read_dir {
    let item = item.map_err(|err| format!("读取目录项失败: {err}"))?;
    let file_type = item
      .file_type()
      .map_err(|err| format!("无法读取文件类型 {}: {err}", path_to_string(&item.path())))?;

    if file_type.is_symlink() {
      continue;
    }

    let path = item.path();
    if file_type.is_dir() {
      collect_audio_entries(&path, root, entries)?;
      continue;
    }

    if file_type.is_file() && is_supported_audio_path(&path) {
      let relative = path
        .strip_prefix(root)
        .unwrap_or(&path)
        .to_string_lossy()
        .replace('\\', "/");
      let (title, artist) = resolve_track_metadata_for_path(&path);

      entries.push(AudioSourceEntry {
        path: path_to_string(&path),
        display_path: relative,
        title,
        artist,
      });
    }
  }

  Ok(())
}

fn sort_entries(entries: &mut [AudioSourceEntry]) {
  entries.sort_by(|left, right| {
    left
      .display_path
      .cmp(&right.display_path)
      .then_with(|| left.path.cmp(&right.path))
  });
}

fn library_db_path(app: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|err| format!("无法定位应用数据目录: {err}"))?;

  fs::create_dir_all(&app_data_dir)
    .map_err(|err| format!("无法创建应用数据目录 {}: {err}", path_to_string(&app_data_dir)))?;

  Ok(app_data_dir.join(LIBRARY_DB_FILE))
}

fn init_schema(conn: &Connection) -> Result<(), String> {
  conn
    .execute_batch(
      r#"
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        cover_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tracks (
        source_path TEXT PRIMARY KEY,
        source_display_path TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        duration REAL NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS album_tracks (
        album_id TEXT NOT NULL,
        track_path TEXT NOT NULL,
        side_index INTEGER NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (album_id, track_path),
        FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
        FOREIGN KEY (track_path) REFERENCES tracks(source_path) ON DELETE CASCADE
      );
      "#,
    )
    .map_err(|err| format!("初始化数据库失败: {err}"))?;

  Ok(())
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
  let db_path = library_db_path(app)?;
  let conn = Connection::open(&db_path)
    .map_err(|err| format!("无法打开数据库 {}: {err}", path_to_string(&db_path)))?;
  init_schema(&conn)?;
  Ok(conn)
}

fn load_album_tracks(conn: &Connection, album_id: &str) -> Result<Vec<Vec<LibraryTrack>>, String> {
  let mut statement = conn
    .prepare(
      r#"
      SELECT
        tracks.source_path,
        tracks.source_display_path,
        tracks.title,
        tracks.artist,
        tracks.duration,
        album_tracks.side_index
      FROM album_tracks
      JOIN tracks ON tracks.source_path = album_tracks.track_path
      WHERE album_tracks.album_id = ?1
      ORDER BY album_tracks.side_index ASC, album_tracks.position ASC
      "#,
    )
    .map_err(|err| format!("准备曲目查询失败: {err}"))?;

  let rows = statement
    .query_map(params![album_id], |row| {
      Ok((
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, String>(2)?,
        row.get::<_, String>(3)?,
        row.get::<_, f64>(4)?,
        row.get::<_, i64>(5)?,
      ))
    })
    .map_err(|err| format!("查询曲目失败: {err}"))?;

  let mut sides: Vec<Vec<LibraryTrack>> = Vec::new();

  for row in rows {
    let (source_path, source_display_path, title, artist, duration, side_index) =
      row.map_err(|err| format!("读取曲目失败: {err}"))?;
    let side_index = side_index.max(0) as usize;

    while sides.len() <= side_index {
      sides.push(Vec::new());
    }

    sides[side_index].push(LibraryTrack {
      id: source_path.clone(),
      title: load_track_title(&source_path, &title),
      artist: load_track_artist(&source_path, &artist),
      duration,
      source_path,
      source_display_path,
    });
  }

  Ok(sides)
}

fn load_album_by_id(conn: &Connection, album_id: &str) -> Result<Option<LibraryAlbum>, String> {
  let album_row = conn
    .query_row(
      r#"
      SELECT id, title, artist, cover_url, created_at, updated_at
      FROM albums
      WHERE id = ?1
      "#,
      params![album_id],
      |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, String>(2)?,
          row.get::<_, Option<String>>(3)?,
          row.get::<_, i64>(4)?,
          row.get::<_, i64>(5)?,
        ))
      },
    )
    .optional()
    .map_err(|err| format!("查询专辑失败: {err}"))?;

  let Some((id, title, artist, cover_url, created_at, updated_at)) = album_row else {
    return Ok(None);
  };

  Ok(Some(LibraryAlbum {
    id,
    title,
    artist,
    cover_url,
    sides: load_album_tracks(conn, album_id)?,
    created_at,
    updated_at,
  }))
}

fn load_all_albums(conn: &Connection) -> Result<Vec<LibraryAlbum>, String> {
  let mut statement = conn
    .prepare(
      r#"
      SELECT id
      FROM albums
      ORDER BY updated_at DESC, title COLLATE NOCASE ASC
      "#,
    )
    .map_err(|err| format!("准备专辑列表查询失败: {err}"))?;

  let ids = statement
    .query_map([], |row| row.get::<_, String>(0))
    .map_err(|err| format!("查询专辑列表失败: {err}"))?;

  let mut albums = Vec::new();
  for id in ids {
    let id = id.map_err(|err| format!("读取专辑 ID 失败: {err}"))?;
    if let Some(album) = load_album_by_id(conn, &id)? {
      albums.push(album);
    }
  }

  Ok(albums)
}

#[tauri::command]
fn pick_audio_files() -> Result<Option<AudioImportSelection>, String> {
  let Some(paths) = rfd::FileDialog::new()
    .add_filter("Audio", AUDIO_EXTENSIONS)
    .pick_files()
  else {
    return Ok(None);
  };

  let mut entries = paths
    .into_iter()
    .filter(|path| is_supported_audio_path(path))
    .map(|path| {
      let (title, artist) = resolve_track_metadata_for_path(&path);

      AudioSourceEntry {
        display_path: display_name_for_path(&path),
        path: path_to_string(&path),
        title,
        artist,
      }
    })
    .collect::<Vec<_>>();

  sort_entries(&mut entries);

  Ok(Some(AudioImportSelection {
    album_title: None,
    entries,
  }))
}

#[tauri::command]
fn pick_audio_folder() -> Result<Option<AudioImportSelection>, String> {
  let Some(folder_path) = rfd::FileDialog::new().pick_folder() else {
    return Ok(None);
  };

  let mut entries = Vec::new();
  collect_audio_entries(&folder_path, &folder_path, &mut entries)?;
  sort_entries(&mut entries);

  Ok(Some(AudioImportSelection {
    album_title: folder_path
      .file_name()
      .and_then(|value| value.to_str())
      .map(ToOwned::to_owned),
    entries,
  }))
}

#[tauri::command]
fn load_library(app: AppHandle) -> Result<Vec<LibraryAlbum>, String> {
  let conn = open_db(&app)?;
  load_all_albums(&conn)
}

#[tauri::command]
fn save_album(app: AppHandle, album: LibraryAlbum) -> Result<LibraryAlbum, String> {
  if album.id.trim().is_empty() {
    return Err("专辑 ID 不能为空".into());
  }

  let mut conn = open_db(&app)?;
  let tx = conn
    .transaction()
    .map_err(|err| format!("开启事务失败: {err}"))?;

  let now = now_millis();
  let created_at = tx
    .query_row(
      "SELECT created_at FROM albums WHERE id = ?1",
      params![album.id],
      |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|err| format!("读取专辑创建时间失败: {err}"))?
    .unwrap_or(now);

  tx
    .execute(
      r#"
      INSERT INTO albums (id, title, artist, cover_url, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        cover_url = excluded.cover_url,
        updated_at = excluded.updated_at
      "#,
      params![
        album.id,
        album.title,
        album.artist,
        album.cover_url,
        created_at,
        now
      ],
    )
    .map_err(|err| format!("保存专辑失败: {err}"))?;

  tx
    .execute("DELETE FROM album_tracks WHERE album_id = ?1", params![album.id])
    .map_err(|err| format!("重置专辑曲目分配失败: {err}"))?;

  for (side_index, side) in album.sides.iter().enumerate() {
    for (position, track) in side.iter().enumerate() {
      if track.source_path.trim().is_empty() {
        continue;
      }

      let track_created_at = tx
        .query_row(
          "SELECT created_at FROM tracks WHERE source_path = ?1",
          params![track.source_path],
          |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|err| format!("读取曲目创建时间失败: {err}"))?
        .unwrap_or(now);

      tx
        .execute(
          r#"
          INSERT INTO tracks (
            source_path,
            source_display_path,
            title,
            artist,
            duration,
            created_at,
            updated_at
          )
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
          ON CONFLICT(source_path) DO UPDATE SET
            source_display_path = excluded.source_display_path,
            title = excluded.title,
            artist = excluded.artist,
            duration = excluded.duration,
            updated_at = excluded.updated_at
          "#,
          params![
            track.source_path,
            track.source_display_path,
            track.title,
            track.artist,
            track.duration,
            track_created_at,
            now
          ],
        )
        .map_err(|err| format!("保存曲目失败: {err}"))?;

      tx
        .execute(
          r#"
          INSERT INTO album_tracks (album_id, track_path, side_index, position)
          VALUES (?1, ?2, ?3, ?4)
          "#,
          params![album.id, track.source_path, side_index as i64, position as i64],
        )
        .map_err(|err| format!("保存曲目归属失败: {err}"))?;
    }
  }

  tx
    .execute(
      "DELETE FROM tracks WHERE source_path NOT IN (SELECT track_path FROM album_tracks)",
      [],
    )
    .map_err(|err| format!("清理未使用曲目失败: {err}"))?;

  tx.commit().map_err(|err| format!("提交事务失败: {err}"))?;

  let conn = open_db(&app)?;
  load_album_by_id(&conn, &album.id)?.ok_or_else(|| "保存完成但未找到专辑".into())
}

#[tauri::command]
fn delete_album(app: AppHandle, album_id: String) -> Result<(), String> {
  let conn = open_db(&app)?;

  conn
    .execute("DELETE FROM albums WHERE id = ?1", params![album_id])
    .map_err(|err| format!("删除专辑失败: {err}"))?;

  conn
    .execute(
      "DELETE FROM tracks WHERE source_path NOT IN (SELECT track_path FROM album_tracks)",
      [],
    )
    .map_err(|err| format!("清理未使用曲目失败: {err}"))?;

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      pick_audio_files,
      pick_audio_folder,
      load_library,
      save_album,
      delete_album
    ])
    .setup(|app| {
      let _ = open_db(&app.handle());

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
