# 빌드 및 재설치 방법

## 준비물
- Node.js 20 이상 (22 권장)
- 데스크톱 빌드: Rust (stable) + 각 OS 의 Tauri 필수 구성요소
  - Windows: Microsoft C++ Build Tools, WebView2(Windows 11 기본 포함)
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf`
- 테스트 음원 생성: ffmpeg

## 명령
```bash
npm ci                 # 의존성 설치
npm run dev            # 개발 서버 (http://localhost:5173)
npm test               # 분석 정확도·WSOLA·워크렛 싱크 단위 테스트
./tests/make-audio.sh  # 정답이 알려진 테스트 음원 생성 (test-audio/)
npm run build          # PWA 빌드 → dist/
npm run preview        # dist 미리보기 (http://localhost:4173)
npm run test:e2e       # 실제 Chromium E2E (preview 서버 실행 중이어야 함)
npm run desktop:dev    # 데스크톱 앱 개발 실행
npm run desktop:build  # 현재 OS 용 설치 파일 생성
```

## 설치 파일 위치 (`npm run desktop:build` 후)
| OS | 파일 |
|---|---|
| Windows | `src-tauri/target/release/bundle/nsis/Guitar Studio AI_0.1.0_x64-setup.exe` (바탕화면·시작 메뉴 바로가기 생성), `bundle/msi/*.msi` |
| macOS | `src-tauri/target/release/bundle/dmg/*.dmg` (유니버설: `npm run tauri build -- --target universal-apple-darwin`) |
| Linux | `bundle/deb/*.deb`, `bundle/appimage/*.AppImage` |

Windows 설치 파일은 Windows 에서, macOS DMG 는 Mac 에서 빌드해야 합니다. 두 OS 장비가 없으면 GitHub 저장소에 올린 뒤 **Actions → build → Run workflow** 를 실행하면 `.github/workflows/build.yml` 이 Windows·macOS 설치 파일을 만들어 아티팩트로 제공합니다.

## 코드 서명(선택)
서명하지 않은 설치 파일도 동작하지만 Windows SmartScreen / macOS Gatekeeper 경고가 표시됩니다. 배포 시에는 Windows 코드 서명 인증서, Apple Developer ID 서명·공증을 권장합니다 (Tauri 문서의 Code Signing 참고).

## PWA 배포
`npm run build` 결과인 `dist/` 폴더는 정적 파일입니다. HTTPS 정적 호스팅(GitHub Pages 등)에 올리면 휴대폰에서 설치할 수 있고, 한 번 연 뒤에는 오프라인으로 동작합니다. 음악 파일·분석 데이터는 서버로 전송되지 않습니다.

## 재설치 / 업데이트
- Windows: 새 setup.exe 를 실행하면 덮어쓰기 업데이트됩니다. 사용자 데이터(라이브러리·분석 결과)는 유지됩니다.
- macOS: 새 앱으로 교체. 데이터 유지.
- PWA: 앱을 다시 열면 새 버전이 자동 적용됩니다.
- 완전 초기화: 설정 → "모든 로컬 데이터 삭제" (먼저 백업 권장).
