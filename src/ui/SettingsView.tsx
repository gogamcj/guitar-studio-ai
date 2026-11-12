import { useEffect, useState } from 'react'
import { clearAllData, toast, updateSettings, useApp } from '../store/app'
import { exportBackup, importBackup } from '../store/db'
import { download, isTauri, pickWithInput } from '../platform/files'
import { engine } from '../engine/AudioEngine'
import type { ClickSound, ClickSubdivision } from '../types'

const SOUNDS: [ClickSound, string][] = [['electronic', '전자 메트로놈'], ['woodblock', '우드블록'], ['stick', '스틱'], ['cowbell', '카우벨'], ['kicksnare', '킥/스네어']]
const SUBS: [ClickSubdivision, string][] = [['half', '2박마다'], ['quarter', '1박마다'], ['eighth', '8분음표'], ['sixteenth', '16분음표'], ['shuffle', '셔플']]

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 border-b border-line/40 last:border-0">
      <div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-mute">{hint}</div>}</div>
      <div className="flex flex-wrap gap-1.5 items-center">{children}</div>
    </div>
  )
}

export function ClickSettings() {
  const s = useApp((x) => x.settings)
  return (
    <>
      <Row label="클릭 음색">
        {SOUNDS.map(([v, l]) => <button key={v} className={`chip ${s.clickSound === v ? 'chip-on' : ''}`} onClick={() => updateSettings({ clickSound: v })}>{l}</button>)}
      </Row>
      <Row label="클릭 간격" hint="분석된 비트 사이를 나누어 생성 (템포 변화도 따라감)">
        {SUBS.map(([v, l]) => <button key={v} className={`chip ${s.clickSubdivision === v ? 'chip-on' : ''}`} onClick={() => updateSettings({ clickSubdivision: v })}>{l}</button>)}
      </Row>
      <Row label="첫 박 강조">
        <button className={`chip ${s.accentDownbeat ? 'chip-on' : ''}`} onClick={() => updateSettings({ accentDownbeat: !s.accentDownbeat })}>{s.accentDownbeat ? '켜짐' : '꺼짐'}</button>
      </Row>
      <Row label="클릭 음량">
        <input type="range" min={0} max={1.5} step={0.01} value={s.clickVolume} onChange={(e) => updateSettings({ clickVolume: +e.target.value })} className="w-40" />
        <span className="text-xs tabular w-10">{Math.round(s.clickVolume * 100)}%</span>
      </Row>
      <Row label="카운트 인" hint="재생 시작 전 클릭으로 마디 수만큼 세어 줍니다 (분석 후)">
        {[0, 1, 2].map((n) => <button key={n} className={`chip ${s.countIn === n ? 'chip-on' : ''}`} onClick={() => updateSettings({ countIn: n })}>{n === 0 ? '끔' : `${n}마디`}</button>)}
      </Row>
      <Row label="클릭 싱크 보정" hint="블루투스 이어폰 등 출력 지연이 다른 경우 미세 조정 (+ = 클릭을 늦춤)">
        <input type="range" min={-100} max={100} step={1} value={s.clickOffsetMs} onChange={(e) => updateSettings({ clickOffsetMs: +e.target.value })} className="w-40" />
        <span className="text-xs tabular w-14">{s.clickOffsetMs > 0 ? '+' : ''}{s.clickOffsetMs}ms</span>
      </Row>
    </>
  )
}

export function SettingsView() {
  const s = useApp((x) => x.settings)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [storage, setStorage] = useState<string>('')
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((d) => setDevices(d.filter((x) => x.kind === 'audiooutput'))).catch(() => {})
    navigator.storage?.estimate?.().then((e) => setStorage(`${((e.usage || 0) / 1048576).toFixed(0)}MB 사용 / 약 ${((e.quota || 0) / 1073741824).toFixed(1)}GB 가능`)).catch(() => {})
  }, [])
  const doExport = async () => {
    const data = await exportBackup()
    download(`guitar-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json')
  }
  const doImport = async () => {
    const f = await pickWithInput({ accept: '.json,application/json' })
    if (!f.length) return
    try {
      const r = await importBackup(JSON.parse(await f[0].file.text()))
      toast(`복원 완료: ${r.tracks}곡, 분석 ${r.analyses}건. 앱을 다시 불러옵니다.`)
      setTimeout(() => location.reload(), 1200)
    } catch (e: any) { toast('복원 실패: ' + (e?.message || e)) }
  }
  return (
    <div className="space-y-3 max-w-3xl">
      <section className="card px-4">
        <h2 className="pt-3 label">화면</h2>
        <Row label="테마"><button className={`chip ${s.theme === 'dark' ? 'chip-on' : ''}`} onClick={() => updateSettings({ theme: 'dark' })}>다크</button><button className={`chip ${s.theme === 'light' ? 'chip-on' : ''}`} onClick={() => updateSettings({ theme: 'light' })}>라이트</button></Row>
        <Row label="포인트 색상"><button className={`chip ${s.accent === 'orange' ? 'chip-on' : ''}`} onClick={() => updateSettings({ accent: 'orange' })}>오렌지</button><button className={`chip ${s.accent === 'blue' ? 'chip-on' : ''}`} onClick={() => updateSettings({ accent: 'blue' })}>블루</button></Row>
        <Row label="파형 색상"><input type="color" value={s.waveformColor} onChange={(e) => updateSettings({ waveformColor: e.target.value })} className="h-8 w-14 bg-transparent" /></Row>
        <Row label="언어" hint="현재 한국어 UI 를 제공합니다. (영어 UI 는 추후 단계)"><span className="chip chip-on">한국어</span></Row>
      </section>
      <section className="card px-4">
        <h2 className="pt-3 label">재생</h2>
        <Row label="기본 재생 장치" hint={engine.supportsOutputSelect ? undefined : '이 브라우저/기기에서는 시스템 설정의 출력 장치를 사용합니다.'}>
          {engine.supportsOutputSelect ? (
            <select className="input" value={s.outputDeviceId} onChange={(e) => updateSettings({ outputDeviceId: e.target.value })}>
              <option value="">시스템 기본</option>
              {devices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || '출력 장치'}</option>)}
            </select>
          ) : <span className="text-xs text-mute">시스템 기본</span>}
        </Row>
        <Row label="기본 배속">
          <select className="input" value={s.defaultRate} onChange={(e) => updateSettings({ defaultRate: +e.target.value })}>{[0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.5, 2].map((r) => <option key={r} value={r}>{r.toFixed(1)}×</option>)}</select>
        </Row>
        <Row label="기본 피치">
          <select className="input" value={s.defaultPitch} onChange={(e) => updateSettings({ defaultPitch: +e.target.value })}>{Array.from({ length: 25 }, (_, i) => i - 12).map((p) => <option key={p} value={p}>{p > 0 ? '+' : ''}{p} 반음</option>)}</select>
        </Row>
      </section>
      <section className="card px-4">
        <h2 className="pt-3 label">메트로놈 클릭</h2>
        <ClickSettings />
      </section>
      <section className="card px-4">
        <h2 className="pt-3 label">분석</h2>
        <Row label="곡을 열면 자동 분석"><button className={`chip ${s.autoAnalyze ? 'chip-on' : ''}`} onClick={() => updateSettings({ autoAnalyze: !s.autoAnalyze })}>{s.autoAnalyze ? '켜짐' : '꺼짐'}</button></Row>
        <Row label="분석 정확도" hint="정밀: 코드 경계 해상도 2배 (분석 시간 약 1.5배)">
          <button className={`chip ${s.analysisQuality === 'fast' ? 'chip-on' : ''}`} onClick={() => updateSettings({ analysisQuality: 'fast' })}>빠름</button>
          <button className={`chip ${s.analysisQuality === 'accurate' ? 'chip-on' : ''}`} onClick={() => updateSettings({ analysisQuality: 'accurate' })}>정밀</button>
        </Row>
      </section>
      <section className="card px-4">
        <h2 className="pt-3 label">데이터 (이 기기에만 저장)</h2>
        <Row label="저장 위치" hint={isTauri() ? '앱 데이터 폴더 (WebView 로컬 저장소)' : '브라우저 로컬 저장소 (IndexedDB) · 서버 전송 없음'}><span className="text-xs text-mute">{storage}</span></Row>
        <Row label="음원 사본 보관" hint="켜면 불러온 음원을 이 기기 저장소에 복사해 두어, 앱을 다시 열 때 파일을 다시 선택하지 않아도 됩니다. (원본은 변경되지 않음, 모바일 권장)">
          <button className={`chip ${s.keepCopies ? 'chip-on' : ''}`} onClick={() => updateSettings({ keepCopies: !s.keepCopies })}>{s.keepCopies ? '켜짐' : '꺼짐'}</button>
        </Row>
        <Row label="백업 / 복원" hint="분석 결과·코드 수정·구간·메모·설정을 파일로 내보내 USB 등으로 다른 기기에 옮길 수 있습니다. (음원 파일은 포함되지 않음)">
          <button className="btn" onClick={doExport}>백업 파일 내보내기</button>
          <button className="btn" onClick={doImport}>백업 가져오기</button>
        </Row>
        <Row label="모든 로컬 데이터 삭제">
          <button className="btn text-warn" onClick={async () => { if (confirm('라이브러리, 분석 결과, 구간, 메모, 설정을 모두 삭제할까요? (원본 음악 파일은 삭제되지 않습니다)')) { await clearAllData(); location.reload() } }}>삭제</button>
        </Row>
      </section>
      <p className="text-xs text-mute px-1 pb-6">Guitar Studio AI · 모든 분석은 기기 내부에서 처리됩니다. 사용자 정보와 음악 파일을 수집·전송하지 않으며 외부 API 를 호출하지 않습니다.</p>
    </div>
  )
}
