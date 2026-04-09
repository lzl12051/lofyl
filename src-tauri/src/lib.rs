use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
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
    track_number: Option<u32>,
    disc_number: Option<u32>,
    cover_url: Option<String>,
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
    disc_art_url: Option<String>,
    sides: Vec<Vec<LibraryTrack>>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Default, Clone)]
struct EmbeddedTrackMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    cover_url: Option<String>,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn is_supported_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            AUDIO_EXTENSIONS
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn display_name_for_path(path: &Path) -> String {
    path.file_name()
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

fn strip_artist_prefix(name: &str, artist: &str) -> String {
    let trimmed_name = name.trim();
    let trimmed_artist = artist.trim();
    if trimmed_name.is_empty() || trimmed_artist.is_empty() {
        return trimmed_name.to_owned();
    }

    for separator in [" - ", "-", " – ", "—", "_", "·", "/"] {
        let prefix = format!("{trimmed_artist}{separator}");
        if let Some(stripped) = trimmed_name.strip_prefix(&prefix) {
            let candidate = stripped.trim();
            if !candidate.is_empty() {
                return candidate.to_owned();
            }
        }
    }

    trimmed_name.to_owned()
}

fn fallback_track_title_with_artist(path: &Path, artist: &str) -> String {
    let fallback = fallback_track_title(path);
    let stripped = strip_artist_prefix(&fallback, artist);
    if stripped.is_empty() {
        fallback
    } else {
        stripped
    }
}

fn normalize_metadata_text(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("(null)")
        || trimmed.eq_ignore_ascii_case("null")
    {
        return None;
    }

    Some(trimmed.trim_matches('"').to_owned())
}

fn normalize_metadata_list(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("(null)")
        || trimmed.eq_ignore_ascii_case("null")
    {
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

fn parse_number_hint(raw: &str) -> Option<u32> {
    let mut digits = String::new();
    let mut seen_digit = false;

    for ch in raw.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            seen_digit = true;
            continue;
        }

        if seen_digit {
            break;
        }
    }

    if digits.is_empty() {
        None
    } else {
        digits.parse::<u32>().ok().filter(|value| *value > 0)
    }
}

fn is_placeholder_track_title(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("track") {
        let rest = rest.trim();
        return !rest.is_empty()
            && rest.chars().all(|ch| {
                ch.is_ascii_digit() || ch.is_ascii_whitespace() || ch == '/' || ch == '-'
            });
    }

    false
}

fn read_u32_be(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn build_cover_data_url(image_data: &[u8], mime_type: &str) -> Option<String> {
    let trimmed_mime = mime_type.trim();
    if image_data.is_empty() || trimmed_mime.is_empty() {
        return None;
    }

    Some(format!(
        "data:{trimmed_mime};base64,{}",
        BASE64_STANDARD.encode(image_data)
    ))
}

fn parse_flac_picture_block(block: &[u8]) -> Option<String> {
    let mime_length = read_u32_be(block, 4)? as usize;
    let mime_start = 8;
    let mime_end = mime_start + mime_length;
    let mime_type = std::str::from_utf8(block.get(mime_start..mime_end)?).ok()?;

    let description_length = read_u32_be(block, mime_end)? as usize;
    let dimensions_start = mime_end + 4 + description_length;
    let image_length_offset = dimensions_start + 16;
    let image_length = read_u32_be(block, image_length_offset)? as usize;
    let image_start = image_length_offset + 4;
    let image_data = block.get(image_start..image_start + image_length)?;

    build_cover_data_url(image_data, mime_type)
}

fn parse_flac_vorbis_comment_block(block: &[u8], metadata: &mut EmbeddedTrackMetadata) {
    let Some(vendor_length) = read_u32_le(block, 0).map(|value| value as usize) else {
        return;
    };

    let comment_count_offset = 4 + vendor_length;
    let Some(comment_count) = read_u32_le(block, comment_count_offset).map(|value| value as usize)
    else {
        return;
    };

    let mut cursor = comment_count_offset + 4;
    for _ in 0..comment_count {
        let Some(comment_length) = read_u32_le(block, cursor).map(|value| value as usize) else {
            break;
        };
        cursor += 4;

        let Some(comment_bytes) = block.get(cursor..cursor + comment_length) else {
            break;
        };
        cursor += comment_length;

        let Ok(comment) = std::str::from_utf8(comment_bytes) else {
            continue;
        };

        let Some((raw_key, raw_value)) = comment.split_once('=') else {
            continue;
        };

        let key = raw_key.trim().to_ascii_uppercase();
        let value = raw_value.trim();
        if value.is_empty() {
            continue;
        }

        match key.as_str() {
            "TITLE" if metadata.title.is_none() => {
                metadata.title = normalize_metadata_text(value);
            }
            "ARTIST" | "ALBUMARTIST" if metadata.artist.is_none() => {
                metadata.artist = normalize_metadata_text(value);
            }
            "ALBUM" if metadata.album.is_none() => {
                metadata.album = normalize_metadata_text(value);
            }
            "TRACKNUMBER" | "TRACK" if metadata.track_number.is_none() => {
                metadata.track_number = parse_number_hint(value);
            }
            "DISCNUMBER" | "DISC" if metadata.disc_number.is_none() => {
                metadata.disc_number = parse_number_hint(value);
            }
            _ => {}
        }
    }
}

fn read_flac_embedded_metadata(path: &Path) -> EmbeddedTrackMetadata {
    let Ok(mut file) = fs::File::open(path) else {
        return EmbeddedTrackMetadata::default();
    };

    let mut signature = [0_u8; 4];
    if file.read_exact(&mut signature).is_err() || signature != *b"fLaC" {
        return EmbeddedTrackMetadata::default();
    }

    let mut metadata = EmbeddedTrackMetadata::default();

    loop {
        let mut header = [0_u8; 4];
        if file.read_exact(&mut header).is_err() {
            break;
        }

        let is_last = (header[0] & 0x80) != 0;
        let block_type = header[0] & 0x7f;
        let block_length =
            ((header[1] as usize) << 16) | ((header[2] as usize) << 8) | header[3] as usize;
        let mut block = vec![0_u8; block_length];
        if file.read_exact(&mut block).is_err() {
            break;
        }

        match block_type {
            4 => parse_flac_vorbis_comment_block(&block, &mut metadata),
            6 if metadata.cover_url.is_none() => {
                metadata.cover_url = parse_flac_picture_block(&block);
            }
            _ => {}
        }

        if is_last {
            break;
        }
    }

    metadata
}

fn read_embedded_metadata(path: &Path) -> EmbeddedTrackMetadata {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("flac") => read_flac_embedded_metadata(path),
        _ => EmbeddedTrackMetadata::default(),
    }
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

fn resolve_track_metadata_for_path(path: &Path) -> AudioSourceEntry {
    let embedded = read_embedded_metadata(path);
    let artist = embedded
        .artist
        .clone()
        .or_else(|| read_metadata_artist(path))
        .unwrap_or_default();

    let title_hint = embedded.title.clone().or_else(|| read_metadata_title(path));
    let track_number = embedded.track_number.or_else(|| {
        title_hint
            .as_deref()
            .filter(|value| is_placeholder_track_title(value))
            .and_then(parse_number_hint)
    });

    let title = match title_hint {
        Some(value) if !is_placeholder_track_title(&value) => value,
        _ => fallback_track_title_with_artist(path, &artist),
    };

    AudioSourceEntry {
        path: path_to_string(path),
        display_path: display_name_for_path(path),
        title,
        artist,
        track_number,
        disc_number: embedded.disc_number,
        cover_url: embedded.cover_url,
    }
}

fn load_track_title(source_path: &str, stored_title: &str) -> String {
    let path = Path::new(source_path);
    if path.exists() {
        return resolve_track_metadata_for_path(path).title;
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
        let metadata_artist = resolve_track_metadata_for_path(path).artist;
        if !metadata_artist.trim().is_empty() {
            return metadata_artist;
        }
    }

    stored_artist.to_owned()
}

fn collect_audio_entries(
    dir: &Path,
    root: &Path,
    entries: &mut Vec<AudioSourceEntry>,
) -> Result<(), String> {
    let read_dir =
        fs::read_dir(dir).map_err(|err| format!("无法读取目录 {}: {err}", path_to_string(dir)))?;

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
            let mut entry = resolve_track_metadata_for_path(&path);
            entry.display_path = relative;

            entries.push(entry);
        }
    }

    Ok(())
}

fn sort_entries(entries: &mut [AudioSourceEntry]) {
    entries.sort_by(|left, right| {
        let disc_order = match (left.disc_number, right.disc_number) {
            (Some(left_disc), Some(right_disc)) => left_disc.cmp(&right_disc),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        };

        let track_order = match (left.track_number, right.track_number) {
            (Some(left_track), Some(right_track)) => left_track.cmp(&right_track),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        };

        disc_order
            .then(track_order)
            .then_with(|| left.display_path.cmp(&right.display_path))
            .then_with(|| left.path.cmp(&right.path))
    });
}

fn library_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位应用数据目录: {err}"))?;

    fs::create_dir_all(&app_data_dir).map_err(|err| {
        format!(
            "无法创建应用数据目录 {}: {err}",
            path_to_string(&app_data_dir)
        )
    })?;

    Ok(app_data_dir.join(LIBRARY_DB_FILE))
}

fn ensure_column_exists(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = conn
        .prepare(&pragma)
        .map_err(|err| format!("读取表结构失败: {err}"))?;

    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| format!("查询表字段失败: {err}"))?;

    for column in columns {
        let column = column.map_err(|err| format!("读取表字段失败: {err}"))?;
        if column == column_name {
            return Ok(());
        }
    }

    let alter_sql =
        format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}");
    conn.execute(&alter_sql, [])
        .map_err(|err| format!("升级数据库字段失败: {err}"))?;

    Ok(())
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        cover_url TEXT,
        disc_art_url TEXT,
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

    ensure_column_exists(conn, "albums", "disc_art_url", "TEXT")?;

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
      SELECT id, title, artist, cover_url, disc_art_url, created_at, updated_at
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
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|err| format!("查询专辑失败: {err}"))?;

    let Some((id, title, artist, cover_url, disc_art_url, created_at, updated_at)) = album_row
    else {
        return Ok(None);
    };

    Ok(Some(LibraryAlbum {
        id,
        title,
        artist,
        cover_url,
        disc_art_url,
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
        .map(|path| resolve_track_metadata_for_path(&path))
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

    tx.execute(
        r#"
      INSERT INTO albums (id, title, artist, cover_url, disc_art_url, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        cover_url = excluded.cover_url,
        disc_art_url = excluded.disc_art_url,
        updated_at = excluded.updated_at
      "#,
        params![
            album.id,
            album.title,
            album.artist,
            album.cover_url,
            album.disc_art_url,
            created_at,
            now
        ],
    )
    .map_err(|err| format!("保存专辑失败: {err}"))?;

    tx.execute(
        "DELETE FROM album_tracks WHERE album_id = ?1",
        params![album.id],
    )
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

            tx.execute(
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

            tx.execute(
                r#"
          INSERT INTO album_tracks (album_id, track_path, side_index, position)
          VALUES (?1, ?2, ?3, ?4)
          "#,
                params![
                    album.id,
                    track.source_path,
                    side_index as i64,
                    position as i64
                ],
            )
            .map_err(|err| format!("保存曲目归属失败: {err}"))?;
        }
    }

    tx.execute(
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

    conn.execute("DELETE FROM albums WHERE id = ?1", params![album_id])
        .map_err(|err| format!("删除专辑失败: {err}"))?;

    conn.execute(
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
