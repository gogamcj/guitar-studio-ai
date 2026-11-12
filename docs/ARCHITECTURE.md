# Guitar Studio AI — 전체 구조 및 기술 설계

## 1. 원칙
- 100% 로컬: 음원은 기기 밖으로 나가지 않음. 서버·계정·외부 API 없음.
- 하나의 코드베이스: React + TypeScript UI와 분석 엔진을 PC(Tauri 2)와 모바일(PWA)이 공유.
- "분석하지 않은 값은 표시하지 않는다": 모든 분석값은 `source: 'ai' | 'user'` 와 `confidence(0~1)` 를 가짐.
- 싱크 최우선: 클릭은 UI 타이머가 아니라 **오디오 스레드(AudioWorklet)** 에서 원곡 샘플 위치 기준으로 렌더링.

## 2. 레이어 구조
```
┌──────────────────────── UI (React + Tailwind) ────────────────────────┐
│ Player · Waveform · ChordLane · Copy Mode · Report · Library · Settings │
└───────────────┬──────────────────────────────┬────────────────────────┘
                │ state (zustand-like store)   │
┌───────────────▼─────────────┐   ┌────────────▼─────────────────────────┐
│ Audio Engine (main thread)   │   │ Analysis Engine (Web Worker, TS DSP) │
│ AudioContext + AudioWorklet  │   │ STFT → onset → tempo → beats →       │
│  "gs-player" processor:      │   │ downbeat/meter → chroma → key →      │
│  - PCM 재생(소스 위치 관리)    │   │ beat-sync chords (HMM/Viterbi)       │
│  - Time-stretch (WSOLA)      │   │ → sections (self-similarity)         │
│  - Pitch shift (resample)    │   └──────────────────────────────────────┘
│  - A-B loop (샘플 단위)        │
│  - Click 합성 (비트 타임스탬프)  │
└──────────────────────────────┘
┌──────────── Platform adapter ────────────┐  ┌──── Storage ────┐
│ web: File/Drag&Drop/File System Access   │  │ IndexedDB (공통) │
│ tauri: 네이티브 파일 대화상자/폴더 스캔     │  │ 백업: JSON 내보내기│
└──────────────────────────────────────────┘  └─────────────────┘
```

## 3. 싱크 설계 (가장 중요)
일반적인 방식(AudioBufferSourceNode + setTimeout 스케줄러)은 배속/피치 처리와 결합되면 드리프트가 생깁니다.
본 앱은 **원곡 재생·배속·피치·클릭을 하나의 AudioWorklet에서 처리**합니다.
- 워크렛은 매 출력 샘플마다 "지금 들리는 원곡 위치(source time)"를 정확히 압니다.
- 분석된 비트 타임스탬프(원곡 기준 초)를 그 위치가 지나는 순간 클릭 샘플을 같은 버퍼에 믹스 → 샘플 단위 정확도, 배속을 바꿔도 클릭이 원곡 박자에 그대로 붙음.
- Time-stretch 지연(분석 창 길이의 절반)은 보정값으로 반영.
- UI는 워크렛이 보내는 위치 메시지 + `AudioContext.getOutputTimestamp()` 로 표시만 함 (박자 생성에 관여하지 않음).
- 클릭 단독 재생/카운트인도 같은 워크렛에서 원곡 볼륨 0 또는 가상 비트로 처리.

## 4. 분석 알고리즘 (자체 구현, 외부 모델 무사용 → 라이선스 문제 없음)
| 항목 | 방법 |
|---|---|
| 디코딩 | `decodeAudioData` (브라우저/WebView 내장 코덱) → 모노 22.05kHz 다운믹스 |
| 온셋 | STFT(2048/512) 로그 스펙트럴 플럭스, 저역(킥)/중역(스네어)/고역(하이햇) 밴드별 |
| BPM | 온셋 자기상관 + 콤필터 템포그램, 하프/더블 템포 사전분포(log-gaussian, 중심 ~110BPM)와 밴드 일치도로 오인식 방지, 소수점 BPM은 비트 간격 회귀로 정밀화 |
| 템포 변화 | 8초 창 구간별 템포그램 → 변동계수로 고정/가변 판단 |
| 비트 | Ellis 동적계획 비트 트래킹 (가변 템포 허용) |
| 박자/다운비트 | 비트 동기 저역 에너지 + 화성 변화 지점과 2/3/4/5/6 주기 정합 |
| Key | 비트 동기 크로마 + Krumhansl/Temperley 프로파일 상관, 구간별(창) Key, Camelot 표기 |
| 코드 | 베이스 크로마/트레블 크로마 분리, 24+확장 템플릿(7, maj7, m7, sus2/4, add9, dim, aug, m7b5, 슬래시), 비트 동기 HMM Viterbi 스무딩, 사후확률을 신뢰도로 표시 |
| 곡 구간 | 크로마 자기유사 행렬 노벨티 → 경계, 반복 패턴으로 Verse/Chorus 추정 (불확실 시 "추정/미확인") |

향후 정확도 향상을 위해 ONNX Runtime Web(MIT)로 소형 모델을 추가할 수 있도록 인터페이스를 분리합니다. 단, 상업 배포 가능한 라이선스의 모델만 사용합니다 (예: madmom 학습 모델은 CC BY-NC-SA → 사용 불가).

## 5. 배속·피치
- 배속(0.5~2.0): WSOLA 타임 스트레치 (음정 유지) — 자체 구현.
- 피치(±12 반음, 센트 단위): 리샘플링 + 보상 스트레치로 배속과 독립.
- 라이선스 회피: Rubber Band(GPL), SoundTouch(LGPL) 미사용.

## 6. 데이터 (IndexedDB)
- `tracks`: id(파일명+크기+수정시각 해시), 메타, 마지막 재생 위치, 즐겨찾기, 메모
- `analyses`: trackId별 분석 결과 + 사용자 수정본
- `loops`, `markers`, `settings`, `recent`
- 음원 원본은 수정하지 않음. 데스크톱은 파일 경로, 웹은 FileSystemFileHandle(가능 시) 또는 재선택 요청.
- 백업: 전체 DB → JSON 내보내기/가져오기 (USB 등으로 기기 간 이동).

## 7. 배포
- PWA: Vite + vite-plugin-pwa(MIT), 서비스워커 프리캐시 → 오프라인 실행, 홈 화면 설치 (Android/iOS). 정적 파일이므로 서버 없이도 로컬 Wi‑Fi나 USB 정적 호스팅 가능. (PWA 설치 자체는 브라우저가 HTTPS 또는 localhost 출처를 요구함 — 9장 참고)
- Desktop: Tauri 2 → Windows NSIS(.exe, 바탕화면/시작메뉴 바로가기), macOS DMG. 빌드는 각 OS 또는 GitHub Actions에서 수행.

## 8. 사용 라이브러리 및 라이선스
| 라이브러리 | 라이선스 | 상업 배포 |
|---|---|---|
| React, React DOM | MIT | 가능 |
| Vite, vite-plugin-pwa, Workbox | MIT | 가능 |
| Tailwind CSS | MIT | 가능 |
| Tauri 2 | MIT/Apache-2.0 | 가능 |
| TypeScript | Apache-2.0 | 가능 |
| DSP/분석/스트레치 엔진 | 자체 코드 | 가능 |
| 클릭 음색 | 실시간 합성(샘플 파일 없음) | 가능 |

## 9. 알려진 제약 (정직하게)
- iOS PWA는 홈 화면 설치를 위해 최초 1회 HTTPS 출처에서 열어야 합니다. "서버 업로드 없음" 원칙상, 사용자 본인 PC에서 로컬로 띄우거나 GitHub Pages 같은 정적 페이지(음원 전송 없음)를 쓰는 선택지가 있으며 최종 단계에서 결정이 필요합니다.
- OGG는 구형 Safari에서 디코딩되지 않을 수 있습니다.
- 코드/Key 자동분석은 100% 정확할 수 없으므로 신뢰도와 수동 수정을 제공합니다.
