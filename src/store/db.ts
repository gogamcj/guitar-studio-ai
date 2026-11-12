// IndexedDB 로컬 저장소 (서버 전송 없음)
import type { Analysis, LoopRegion, Marker, Settings, TrackMeta } from '../types'

const DB_NAME = 'guitar-studio-ai'
const DB_VER = 1
const STORES = ['tracks', 'analyses', 'loops', 'markers', 'kv', 'handles', 'blobs'] as const
type StoreName = (typeof STORES)[number]

let dbp: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB 미지원'))
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue
        if (s === 'loops' || s === 'markers') {
          const os = db.createObjectStore(s, { keyPath: 'id' })
          os.createIndex('trackId', 'trackId')
        } else if (s === 'tracks') db.createObjectStore(s, { keyPath: 'id' })
        else if (s === 'analyses') db.createObjectStore(s, { keyPath: 'trackId' })
        else db.createObjectStore(s)
      }
    }
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  return dbp
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    const r = fn(s)
    t.oncomplete = () => res(r ? (r.result as T) : (undefined as T))
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error)
  }))
}

export const db = {
  put: <T>(store: StoreName, value: T, key?: IDBValidKey) => tx(store, 'readwrite', (s) => s.put(value as any, key)),
  get: <T>(store: StoreName, key: IDBValidKey) => tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  del: (store: StoreName, key: IDBValidKey) => tx(store, 'readwrite', (s) => s.delete(key)),
  all: <T>(store: StoreName) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  keys: (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
  byTrack: <T>(store: 'loops' | 'markers', trackId: string) => tx<T[]>(store, 'readonly', (s) => s.index('trackId').getAll(trackId) as IDBRequest<T[]>),
  clear: (store: StoreName) => tx(store, 'readwrite', (s) => s.clear()),
}

export const saveTrack = (t: TrackMeta) => db.put('tracks', t)
export const saveAnalysis = (a: Analysis) => db.put('analyses', a)
export const getAnalysis = (id: string) => db.get<Analysis>('analyses', id)
export const saveLoop = (l: LoopRegion) => db.put('loops', l)
export const saveMarker = (m: Marker) => db.put('markers', m)
export const saveSettings = (s: Settings) => db.put('kv', s, 'settings')
export const loadSettings = () => db.get<Settings>('kv', 'settings')

/** 백업: 음원 사본(blobs)과 파일 핸들을 제외한 모든 사용자 데이터 */
export async function exportBackup() {
  const [tracks, analyses, loops, markers] = await Promise.all([db.all('tracks'), db.all('analyses'), db.all('loops'), db.all('markers')])
  const settings = await loadSettings()
  const session = await db.get('kv', 'session')
  return { app: 'guitar-studio-ai', format: 1, exportedAt: new Date().toISOString(), tracks, analyses, loops, markers, settings, session }
}

export async function importBackup(data: any) {
  if (!data || data.app !== 'guitar-studio-ai') throw new Error('Guitar Studio AI 백업 파일이 아닙니다.')
  for (const t of data.tracks || []) await db.put('tracks', t)
  for (const a of data.analyses || []) await db.put('analyses', a)
  for (const l of data.loops || []) await db.put('loops', l)
  for (const m of data.markers || []) await db.put('markers', m)
  if (data.settings) await saveSettings(data.settings)
  return { tracks: (data.tracks || []).length, analyses: (data.analyses || []).length }
}
