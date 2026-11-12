# 라이선스 검토 (상업적 사용·배포)

## 앱에 포함되는(배포되는) 코드
| 구성요소 | 라이선스 | 상업 배포 | 비고 |
|---|---|---|---|
| React, React DOM, scheduler | MIT | 가능 | 저작권 고지 포함 필요 |
| Workbox (서비스워커, vite-plugin-pwa 가 생성) | MIT | 가능 | |
| @tauri-apps/api, plugin-dialog, plugin-fs | MIT 또는 Apache-2.0 | 가능 | |
| Tauri 2 런타임(Rust 크레이트) | MIT 또는 Apache-2.0 | 가능 | 하위 크레이트는 `cargo about` 등으로 고지 파일 생성 권장 |
| 분석 엔진(BPM·비트·박자·Key·코드·구조), FFT | 자체 코드 | 가능 | `src/analysis/*` |
| 타임 스트레치(WSOLA)·피치 시프트·클릭 스케줄러 | 자체 코드 | 가능 | `src/engine/*` |
| 클릭 음색 | 실시간 합성(샘플 파일 없음) | 가능 | `src/engine/clickSounds.ts` |
| 아이콘 | 자체 제작 SVG | 가능 | |

## 빌드·테스트 도구(배포물에 포함되지 않음)
Vite, TypeScript, Tailwind CSS, PostCSS, Autoprefixer, Vitest, @tauri-apps/cli: 모두 MIT 또는 Apache-2.0.
Playwright(Apache-2.0)는 테스트에만 사용합니다.

## 사용하지 않은(라이선스 문제로 제외한) 라이브러리·모델
| 후보 | 라이선스 | 제외 이유 |
|---|---|---|
| Rubber Band (타임 스트레치) | GPL / 상용 라이선스 별도 구매 | GPL 은 앱 전체 소스 공개 의무 |
| SoundTouch | LGPL-2.1 | 정적 링크/번들 시 조건 복잡 |
| Essentia / essentia.js | AGPL-3.0 | 앱 전체 소스 공개 의무 |
| madmom 학습 모델 | CC BY-NC-SA | 비상업 전용 |
| Chordino / NNLS Chroma | GPL | 소스 공개 의무 |
| BTC·기타 공개 코드 인식 모델 | 대부분 학습 데이터 라이선스 불명확 | 상업 배포 위험 |

향후 ONNX Runtime Web(MIT)으로 딥러닝 모델을 추가할 경우, 모델 가중치와 **학습 데이터**의 상업 이용 허용 여부를 반드시 확인해야 합니다.

## 개인정보
앱은 네트워크 요청을 하지 않습니다(데스크톱 CSP 가 외부 연결을 차단). 사용자 정보·음악 파일·분석 결과를 수집하거나 전송하지 않습니다.
