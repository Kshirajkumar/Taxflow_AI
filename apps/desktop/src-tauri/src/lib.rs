use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::Manager;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalVaultSettings {
    vault_path: String,
    device_id: String,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("local-vault.json"))
        .map_err(|error| {
            format!("Could not resolve the local app configuration directory: {error}")
        })
}

fn load_settings(app: &tauri::AppHandle) -> Result<Option<LocalVaultSettings>, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read local vault settings: {error}"))?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|error| format!("Local vault settings are invalid: {error}"))
}

#[tauri::command]
fn configure_local_vault(
    app: tauri::AppHandle,
    vault_path: String,
) -> Result<LocalVaultSettings, String> {
    let selected = PathBuf::from(vault_path.trim());
    if !selected.is_absolute() {
        return Err("Choose an absolute folder path for the local vault.".into());
    }
    fs::create_dir_all(&selected)
        .map_err(|error| format!("Could not create the selected local vault folder: {error}"))?;
    let canonical_path = fs::canonicalize(&selected)
        .map_err(|error| format!("Could not validate the selected local vault folder: {error}"))?;
    let existing = load_settings(&app)?;
    let device_id = match existing {
        Some(value) if value.vault_path == canonical_path.to_string_lossy() => value.device_id,
        _ => Uuid::new_v4().to_string(),
    };
    let settings = LocalVaultSettings {
        vault_path: canonical_path.to_string_lossy().into_owned(),
        device_id,
    };
    let probe = canonical_path.join(format!(".taxflow-write-check-{}", Uuid::new_v4()));
    fs::write(&probe, b"")
        .map_err(|error| format!("The selected local vault folder is not writable: {error}"))?;
    fs::remove_file(&probe)
        .map_err(|error| format!("Could not remove the local vault write-check file: {error}"))?;

    let file_path = settings_path(&app)?;
    let parent = file_path
        .parent()
        .ok_or("Local app configuration path has no parent directory.")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create local app configuration directory: {error}"))?;
    let temporary = parent.join(format!("local-vault-{}.tmp", Uuid::new_v4()));
    let contents = serde_json::to_vec(&settings)
        .map_err(|error| format!("Could not encode local vault settings: {error}"))?;
    fs::write(&temporary, contents)
        .map_err(|error| format!("Could not save local vault settings: {error}"))?;
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|error| format!("Could not replace local vault settings: {error}"))?;
    }
    fs::rename(&temporary, &file_path)
        .map_err(|error| format!("Could not save local vault settings: {error}"))?;
    Ok(settings)
}

#[tauri::command]
fn get_local_vault_status(app: tauri::AppHandle) -> Result<Option<LocalVaultSettings>, String> {
    load_settings(&app)
}

#[tauri::command]
fn open_file_with_default_app(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    const MAX_OPEN_FILE_BYTES: usize = 100 * 1024 * 1024;
    if bytes.is_empty() {
        return Err("The file is empty and cannot be opened.".into());
    }
    if bytes.len() > MAX_OPEN_FILE_BYTES {
        return Err("Files larger than 100 MB cannot be opened through TaxFlow.".into());
    }

    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve the temporary document folder: {error}"))?;
    let open_dir = cache_root.join("opened-documents");
    fs::create_dir_all(&open_dir)
        .map_err(|error| format!("Could not prepare the temporary document folder: {error}"))?;
    let canonical_open_dir = fs::canonicalize(&open_dir)
        .map_err(|error| format!("Could not verify the temporary document folder: {error}"))?;
    let safe_name = safe_file_name(&file_name)?;
    let destination = canonical_open_dir.join(format!("{}-{safe_name}", Uuid::new_v4()));

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|error| format!("Could not prepare this file for the default app: {error}"))?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        drop(file);
        if let Err(cleanup_error) = fs::remove_file(&destination) {
            log::warn!("Could not remove an incomplete temporary open file: {cleanup_error}");
        }
        return Err(format!("Could not save a temporary copy of this file: {error}"));
    }
    drop(file);

    if let Err(error) = open::that_detached(&destination) {
        if let Err(cleanup_error) = fs::remove_file(&destination) {
            log::warn!("Could not remove a temporary file after the default app failed: {cleanup_error}");
        }
        return Err(format!("No default application could open this file: {error}"));
    }

    let cleanup_before = SystemTime::now()
        .checked_sub(Duration::from_secs(7 * 24 * 60 * 60));
    if let Some(cleanup_before) = cleanup_before {
        match fs::read_dir(&canonical_open_dir) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => match entry.metadata() {
                            Ok(metadata) if metadata.is_file() => {
                                if metadata.modified().is_ok_and(|modified| modified < cleanup_before)
                                    && entry.file_name() != destination.file_name().unwrap_or_default()
                                {
                                    if let Err(error) = fs::remove_file(entry.path()) {
                                        log::warn!("Could not remove an expired temporary open file: {error}");
                                    }
                                }
                            }
                            Ok(_) => {}
                            Err(error) => log::warn!("Could not inspect a temporary open file: {error}"),
                        },
                        Err(error) => log::warn!("Could not inspect the temporary open-file cache: {error}"),
                    }
                }
            }
            Err(error) => log::warn!("Could not inspect the temporary open-file cache: {error}"),
        }
    }

    Ok(())
}

fn safe_component(value: &str, fallback: &str) -> String {
    let clean = value
        .encode_utf16()
        .map(|unit| {
            if matches!(unit, 45 | 48..=57 | 65..=90 | 95 | 97..=122) {
                unit as u8 as char
            } else {
                '_'
            }
        })
        .take(64)
        .collect::<String>();
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean
    }
}

fn safe_file_name(value: &str) -> Result<String, String> {
    let name = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ')
        })
        .take(200)
        .collect::<String>();
    let path = Path::new(&name);
    if name.is_empty()
        || name == "."
        || name == ".."
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("The remote document filename is not safe to save.".into());
    }
    Ok(name)
}

#[tauri::command]
fn save_synced_document_chunk(
    app: tauri::AppHandle,
    document_id: String,
    client_name: String,
    year: String,
    month: String,
    file_name: String,
    offset: usize,
    total_size: usize,
    bytes: Vec<u8>,
    expected_sha256: String,
) -> Result<Option<String>, String> {
    let settings =
        load_settings(&app)?.ok_or("Configure a local vault before syncing documents.")?;
    let document_id =
        Uuid::parse_str(&document_id).map_err(|_| "The document ID is invalid.".to_string())?;
    if year.len() != 4 || !year.chars().all(|character| character.is_ascii_digit()) {
        return Err("The document year is invalid.".into());
    }
    const MONTHS: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    if !MONTHS.contains(&month.as_str()) {
        return Err("The document month is invalid.".into());
    }
    const MAX_DOCUMENT_BYTES: usize = 20 * 1024 * 1024;
    const MAX_CHUNK_BYTES: usize = 512 * 1024;
    if total_size == 0
        || total_size > MAX_DOCUMENT_BYTES
        || bytes.is_empty()
        || bytes.len() > MAX_CHUNK_BYTES
    {
        return Err("The document must be between 1 byte and 20 MB.".into());
    }
    let end_offset = offset
        .checked_add(bytes.len())
        .ok_or("The document chunk offset is invalid.")?;
    if offset >= total_size || end_offset > total_size {
        return Err("The document chunk offset is invalid.".into());
    }
    if expected_sha256.len() != 64
        || !expected_sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("The expected SHA-256 checksum is invalid.".into());
    }

    let root = fs::canonicalize(&settings.vault_path)
        .map_err(|error| format!("The configured local vault is unavailable: {error}"))?;
    let file_name = safe_file_name(&file_name)?;
    let target_dir = root
        .join("clients")
        .join(safe_component(&client_name, "unknown"))
        .join(year)
        .join(month)
        .join("Raw");
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Could not create the local client vault folder: {error}"))?;
    let canonical_dir = fs::canonicalize(&target_dir)
        .map_err(|error| format!("Could not validate the local client vault folder: {error}"))?;
    if !canonical_dir.starts_with(&root) {
        return Err("Refused to save outside the configured local vault.".into());
    }

    let destination = canonical_dir.join(&file_name);
    let temporary = canonical_dir.join(format!(".taxflow-{document_id}.part"));
    let temporary_metadata = match fs::symlink_metadata(&temporary) {
        Ok(metadata) => {
            if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
                return Err("Refused to write through a non-regular local sync file.".into());
            }
            Some(metadata)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Could not inspect the local sync file: {error}")),
    };
    if offset > 0 && temporary_metadata.is_none() {
        return Err("The local sync file is missing; retry the document.".into());
    }
    let mut options = OpenOptions::new();
    options.write(true).read(offset > 0);
    if offset == 0 {
        if temporary_metadata.is_some() {
            options.truncate(true);
        } else {
            options.create_new(true);
        }
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("Could not open the local sync file: {error}"))?;
    let current_size = file
        .metadata()
        .map_err(|error| format!("Could not inspect the local sync file: {error}"))?
        .len() as usize;
    if current_size != offset {
        return Err("The local sync chunk is out of sequence; retry the document.".into());
    }
    file.seek(SeekFrom::Start(offset as u64))
        .and_then(|_| file.write_all(&bytes))
        .map_err(|error| format!("Could not write the local sync chunk: {error}"))?;
    if end_offset < total_size {
        return Ok(None);
    }
    if end_offset != total_size {
        return Err("The final local sync chunk has an invalid size.".into());
    }
    file.sync_all()
        .map_err(|error| format!("Could not flush the local document to disk: {error}"))?;
    drop(file);

    let written = fs::read(&temporary)
        .map_err(|error| format!("Could not verify the completed local document: {error}"))?;
    let checksum = format!("{:x}", Sha256::digest(&written));
    if !checksum.eq_ignore_ascii_case(&expected_sha256) {
        let _ = fs::remove_file(&temporary);
        return Err("The downloaded document failed its SHA-256 integrity check.".into());
    }

    match fs::symlink_metadata(&destination) {
        Ok(metadata) => {
            if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
                let _ = fs::remove_file(&temporary);
                return Err("Refused to replace a non-regular file in the local vault.".into());
            }
            let existing = match fs::read(&destination) {
                Ok(value) => value,
                Err(error) => {
                    let _ = fs::remove_file(&temporary);
                    return Err(format!(
                        "Could not verify the existing local document: {error}"
                    ));
                }
            };
            if format!("{:x}", Sha256::digest(&existing)) == checksum {
                fs::remove_file(&temporary).map_err(|error| {
                    format!("Could not clean up the verified temporary file: {error}")
                })?;
                return Ok(Some(destination.to_string_lossy().into_owned()));
            }
            let backup = canonical_dir.join(format!(".taxflow-{}.bak", Uuid::new_v4()));
            if let Err(error) = fs::rename(&destination, &backup) {
                let _ = fs::remove_file(&temporary);
                return Err(format!(
                    "Could not replace the outdated local document safely: {error}"
                ));
            }
            if let Err(error) = fs::rename(&temporary, &destination) {
                let _ = fs::rename(&backup, &destination);
                let _ = fs::remove_file(&temporary);
                return Err(format!("Could not finalize the local document: {error}"));
            }
            fs::remove_file(&backup).map_err(|error| {
                format!(
                    "The new document was saved, but the old copy could not be removed: {error}"
                )
            })?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::rename(&temporary, &destination)
                .map_err(|error| format!("Could not finalize the local document: {error}"))?;
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(format!(
                "Could not check the local destination safely: {error}"
            ));
        }
    }

    Ok(Some(destination.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::{safe_component, safe_file_name};

    #[test]
    fn client_directory_names_match_the_backend_sanitizer() {
        assert_eq!(safe_component("Acme Pvt Ltd", "Unknown"), "Acme_Pvt_Ltd");
        assert_eq!(safe_component("Acme 😀 B", "unknown"), "Acme____B");
    }

    #[test]
    fn unsafe_document_names_cannot_become_path_components() {
        assert!(safe_file_name("").is_err());
        assert!(safe_file_name("..").is_err());
        assert_eq!(safe_file_name("../invoice.pdf").unwrap(), "..invoice.pdf");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tauri::Manager;

        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .invoke_handler(tauri::generate_handler![
            configure_local_vault,
            get_local_vault_status,
            save_synced_document_chunk,
            open_file_with_default_app
        ])
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

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
        .expect("error while building tauri application");
}
