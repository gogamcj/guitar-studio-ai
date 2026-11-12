#!/usr/bin/env bash
# 테스트 음원 생성 (정답이 알려진 합성곡) + 포맷 변환 (ffmpeg 필요)
set -e
npx vitest run tests/make-audio.test.ts
cd test-audio
for f in pop_120_G ballad_92.5_Am halfbar_100_A tempo_change_100to112_C sync_ticks_100; do ffmpeg -loglevel error -y -i $f.wav -b:a 192k $f.mp3; done
ffmpeg -loglevel error -y -i waltz_150_C.wav waltz_150_C.flac
ffmpeg -loglevel error -y -i slash_76_D.wav -c:a aac -b:a 192k slash_76_D.m4a
ffmpeg -loglevel error -y -i fast_174_Em.wav -c:a libvorbis -q:a 5 fast_174_Em.ogg
ffmpeg -loglevel error -y -i jazzish_110_F.wav -c:a aac -b:a 160k jazzish_110_F.aac
echo "test-audio/ 생성 완료"
