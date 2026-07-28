mod storage;

use serde::Serialize;
use storage::{
    clear_stored_import, load_stored_import, save_stored_import, ImportedFile, StoredImport,
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    stored_import: Option<StoredImport>,
    demo_mode: bool,
    load_error: Option<String>,
}

#[tauri::command]
async fn load_app_state(app: AppHandle) -> Result<AppState, String> {
    let demo_mode = std::env::var("WORKOUT_BOARD_DEMO").as_deref() == Ok("1");
    let (stored_import, load_error) = if demo_mode {
        (None, None)
    } else {
        match load_stored_import(&storage_path(&app)?) {
            Ok(stored_import) => (stored_import, None),
            Err(error) => (None, Some(error.to_string())),
        }
    };
    Ok(AppState {
        stored_import,
        demo_mode,
        load_error,
    })
}

#[tauri::command]
async fn save_import(
    app: AppHandle,
    file_name: String,
    contents: String,
) -> Result<ImportedFile, String> {
    ensure_not_demo()?;
    save_stored_import(&storage_path(&app)?, &file_name, &contents)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn clear_import(app: AppHandle) -> Result<(), String> {
    ensure_not_demo()?;
    clear_stored_import(&storage_path(&app)?).map_err(|error| error.to_string())
}

fn storage_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .data_dir()
        .map(|directory| {
            directory
                .join("workout-board")
                .join("imported-workouts.json")
        })
        .map_err(|_| "保存先を特定できませんでした。".to_string())
}

fn ensure_not_demo() -> Result<(), String> {
    if std::env::var("WORKOUT_BOARD_DEMO").as_deref() == Ok("1") {
        Err("デモモードでは設定を変更できません。".to_string())
    } else {
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_import,
            clear_import
        ])
        .run(tauri::generate_context!())
        .expect("Workout Boardを起動できませんでした。");
}
