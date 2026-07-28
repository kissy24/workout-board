use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{self, ErrorKind, Write};
use std::path::Path;
use tempfile::NamedTempFile;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const MAX_IMPORT_BYTES: usize = 5 * 1_024 * 1_024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredImport {
    version: u8,
    #[serde(rename = "type")]
    import_type: String,
    file_name: String,
    imported_at: String,
    contents: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    #[serde(rename = "type")]
    import_type: &'static str,
    file_name: String,
    imported_at: String,
}

pub fn load_stored_import(path: &Path) -> Result<Option<StoredImport>, StorageError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(StorageError::read(error)),
    };
    let stored: StoredImport = serde_json::from_str(&raw)
        .map_err(|_| StorageError::invalid("保存データ形式が不正です。"))?;
    validate_stored_import(&stored)?;
    Ok(Some(stored))
}

pub fn save_stored_import(
    path: &Path,
    file_name: &str,
    contents: &str,
) -> Result<ImportedFile, StorageError> {
    validate_import(file_name, contents)?;
    let imported_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| StorageError::write(io::Error::other(error)))?;
    save_stored_import_at(path, file_name, contents, &imported_at)?;
    Ok(ImportedFile {
        import_type: "import",
        file_name: file_name.to_string(),
        imported_at,
    })
}

fn save_stored_import_at(
    path: &Path,
    file_name: &str,
    contents: &str,
    imported_at: &str,
) -> Result<(), StorageError> {
    validate_import(file_name, contents)?;
    OffsetDateTime::parse(imported_at, &Rfc3339)
        .map_err(|_| StorageError::invalid("取り込み日時が不正です。"))?;
    let parent = path
        .parent()
        .ok_or_else(|| StorageError::write(io::Error::other("保存ディレクトリがありません。")))?;
    fs::create_dir_all(parent).map_err(StorageError::write)?;
    set_mode(parent, 0o700).map_err(StorageError::write)?;

    let stored = StoredImport {
        version: 1,
        import_type: "import".to_string(),
        file_name: file_name.to_string(),
        imported_at: imported_at.to_string(),
        contents: contents.to_string(),
    };
    let mut encoded = serde_json::to_vec(&stored)
        .map_err(|error| StorageError::write(io::Error::other(error)))?;
    encoded.push(b'\n');

    let mut temporary = NamedTempFile::new_in(parent).map_err(StorageError::write)?;
    temporary
        .as_file()
        .set_len(0)
        .map_err(StorageError::write)?;
    temporary.write_all(&encoded).map_err(StorageError::write)?;
    temporary
        .as_file()
        .sync_all()
        .map_err(StorageError::write)?;
    set_file_mode(temporary.as_file(), 0o600).map_err(StorageError::write)?;
    temporary
        .persist(path)
        .map_err(|error| StorageError::write(error.error))?;
    set_mode(path, 0o600).map_err(StorageError::write)?;
    Ok(())
}

pub fn clear_stored_import(path: &Path) -> Result<(), StorageError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(StorageError::delete(error)),
    }
}

fn validate_stored_import(stored: &StoredImport) -> Result<(), StorageError> {
    if stored.version != 1 || stored.import_type != "import" {
        return Err(StorageError::invalid("保存形式に対応していません。"));
    }
    validate_import(&stored.file_name, &stored.contents)?;
    OffsetDateTime::parse(&stored.imported_at, &Rfc3339)
        .map_err(|_| StorageError::invalid("取り込み日時が不正です。"))?;
    Ok(())
}

fn validate_import(file_name: &str, contents: &str) -> Result<(), StorageError> {
    if file_name.is_empty()
        || file_name.chars().count() > 255
        || file_name.contains(['/', '\\', '\0'])
    {
        return Err(StorageError::invalid("ファイル名が不正です。"));
    }
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("csv") && !extension.eq_ignore_ascii_case("tsv") {
        return Err(StorageError::invalid(
            "CSVまたはTSVファイルを選択してください。",
        ));
    }
    if contents.len() > MAX_IMPORT_BYTES {
        return Err(StorageError::invalid("ファイルは5MB以下にしてください。"));
    }
    Ok(())
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_file_mode(file: &File, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_file_mode(_file: &File, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[derive(Debug)]
pub struct StorageError {
    message: String,
}

impl StorageError {
    fn read(_error: io::Error) -> Self {
        Self {
            message: "保存したトレーニング記録を読み込めませんでした。".to_string(),
        }
    }

    fn write(_error: io::Error) -> Self {
        Self {
            message: "トレーニング記録を保存できませんでした。".to_string(),
        }
    }

    fn delete(_error: io::Error) -> Self {
        Self {
            message: "トレーニング記録を削除できませんでした。".to_string(),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StorageError {}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const CONTENTS: &str = "日付,種目,セット,重さ(kg),レップ数\n2026-07-15,ベンチプレス,1,60,5\n";

    #[test]
    fn saves_loads_and_clears_legacy_compatible_data() {
        let directory = tempdir().expect("temporary directory");
        let path = directory
            .path()
            .join("workout-board/imported-workouts.json");
        save_stored_import_at(&path, "workouts.csv", CONTENTS, "2026-07-18T03:00:00Z")
            .expect("save import");

        let stored = load_stored_import(&path)
            .expect("load import")
            .expect("stored import");
        assert_eq!(stored.version, 1);
        assert_eq!(stored.import_type, "import");
        assert_eq!(stored.file_name, "workouts.csv");
        assert_eq!(stored.contents, CONTENTS);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(path.parent().expect("parent"))
                    .expect("directory metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&path).expect("metadata").permissions().mode() & 0o777,
                0o600
            );
        }

        clear_stored_import(&path).expect("clear import");
        assert!(load_stored_import(&path).expect("load cleared").is_none());
    }

    #[test]
    fn loads_data_saved_by_the_browser_version() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("imported-workouts.json");
        let encoded = serde_json::json!({
            "version": 1,
            "type": "import",
            "fileName": "legacy.csv",
            "importedAt": "2026-07-18T03:00:00.000Z",
            "contents": CONTENTS
        });
        fs::write(&path, encoded.to_string()).expect("write legacy import");

        let stored = load_stored_import(&path)
            .expect("load legacy import")
            .expect("stored import");
        assert_eq!(stored.file_name, "legacy.csv");
        assert_eq!(stored.imported_at, "2026-07-18T03:00:00.000Z");
        assert_eq!(stored.contents, CONTENTS);
    }

    #[test]
    fn rejects_invalid_imports_and_saved_data() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("imported-workouts.json");
        assert!(
            save_stored_import_at(&path, "../workouts.csv", CONTENTS, "2026-07-18T03:00:00Z")
                .is_err()
        );
        assert!(
            save_stored_import_at(&path, "workouts.txt", CONTENTS, "2026-07-18T03:00:00Z").is_err()
        );
        assert!(save_stored_import_at(
            &path,
            "workouts.csv",
            &"x".repeat(MAX_IMPORT_BYTES + 1),
            "2026-07-18T03:00:00Z"
        )
        .is_err());

        fs::write(&path, r#"{"version":2}"#).expect("write invalid data");
        assert!(load_stored_import(&path).is_err());
    }
}
