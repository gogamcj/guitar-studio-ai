# Guitar Studio AI

기타 연주자를 위한 **로컬 AI 음악 분석 플레이어**. 음악 파일을 열면 이 기기 안에서 BPM·박자·Key·전체 코드 진행을 분석하고, 원곡 비트에 샘플 단위로 맞춘 클릭을 들으며 배속·피치·A-B 반복으로 카피 연습을 할 수 있습니다.

- 서버·계정·클라우드 없음. 음악 파일을 외부로 전송하지 않음. 오프라인 동작.
- Windows / macOS: Tauri 2 설치형 앱 · Android / iOS: 설치형 PWA
- MP3 · WAV · FLAC · M4A · AAC · OGG

## 문서
- [설치 및 사용 설명서](docs/USER_GUIDE.md)
- [전체 구조 및 기술 설계](docs/ARCHITECTURE.md)
- [기능별 테스트 결과](docs/TEST_RESULTS.md)
- [빌드 및 재설치 방법](docs/BUILD.md)
- [라이선스 검토](docs/LICENSES.md)

## 빠른 시작
```bash
npm ci
npm run dev            # 브라우저 개발 실행
npm test               # 분석 정확도 · 싱크 단위 테스트
npm run desktop:build  # 현재 OS 용 설치 파일
```

## 소스 구조
```
src/
  analysis/   분석 엔진 (Web Worker): FFT, 온셋, 템포·비트, 박자, 크로마, Key, 코드 HMM, 곡 구조
  engine/     오디오 엔진: AudioWorklet(재생+WSOLA 배속+피치+A-B 반복+클릭 합성), 클릭 음색, 이벤트
  store/      상태 관리, IndexedDB 저장·백업
  platform/   파일 접근 (웹 / File System Access / Tauri)
  ui/         화면 (플레이어, 파형, 코드, 카피 모드, 리포트, 라이브러리, 설정)
src-tauri/    데스크톱 셸 (Windows NSIS/MSI, macOS DMG)
tests/        합성 테스트 음원, 정확도·싱크 테스트, Chromium E2E, WebKit 인페이지 테스트
```
