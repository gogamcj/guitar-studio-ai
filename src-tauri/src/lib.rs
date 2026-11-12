// Guitar Studio AI 데스크톱 셸.
// 네트워크 기능 없음: 프런트엔드(로컬 번들) + 파일 대화상자 + 읽기 전용 파일 접근만 사용한다.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("Guitar Studio AI 실행 중 오류");
}
