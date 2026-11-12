// 플랫폼별 파일 접근. 원본 파일은 읽기만 하며 절대 수정하지 않는다.
export const AUDIO_EXT = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'mp4']
export const AUDIO_ACCEPT = '.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.opus,audio/*'

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const hasFSAccess = () => typeof window !== 'undefined' && 'showOpenFilePicker' in window && !isTauri()

export function isAudioName(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return AUDIO_EXT.includes(ext)
}

export interface PickedFile {
  file: File
  handle?: FileSystemFileHandle
  folder?: string
  path?: string
}

/** 숨겨진 input 으로 파일 선택 (모든 브라우저/모바일) */
export function pickWithInput(opts: { multiple?: boolean; directory?: boolean; accept?: string }): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = opts.accept ?? AUDIO_ACCEPT
    input.multiple = !!opts.multiple
    if (opts.directory) (input as any).webkitdirectory = true
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => {
      const files = Array.from(input.files || [])
      document.body.removeChild(input)
      resolve(files.filter((f) => !opts.accept || opts.accept === AUDIO_ACCEPT ? isAudioName(f.name) : true).map((f) => {
        const rel = (f as any).webkitRelativePath as string | undefined
        const folder = rel && rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : undefined
        return { file: f, folder }
      }))
    }
    // 취소 감지(지원 브라우저)
    input.addEventListener('cancel', () => { document.body.removeChild(input); resolve([]) })
    input.click()
  })
}

/** File System Access API (Chrome/Edge 데스크톱): 핸들을 저장해 재실행 시 다시 열 수 있음 */
export async function pickWithFSAccess(): Promise<PickedFile[]> {
  try {
    const handles: FileSystemFileHandle[] = await (window as any).showOpenFilePicker({
      multiple: true,
      types: [{ description: 'Audio', accept: { 'audio/*': AUDIO_EXT.map((e) => '.' + e) } }],
    })
    const out: PickedFile[] = []
    for (const h of handles) out.push({ file: await h.getFile(), handle: h })
    return out
  } catch {
    return []
  }
}

export async function pickFolderFSAccess(): Promise<PickedFile[]> {
  try {
    const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker()
    const out: PickedFile[] = []
    const walk = async (d: FileSystemDirectoryHandle, path: string) => {
      for await (const [name, h] of (d as any).entries()) {
        if (h.kind === 'file' && isAudioName(name)) out.push({ file: await h.getFile(), handle: h, folder: path })
        else if (h.kind === 'directory') await walk(h, path + '/' + name)
      }
    }
    await walk(dir, dir.name)
    return out
  } catch {
    return []
  }
}

/** 저장된 핸들로 파일 재획득 (권한 재요청 포함) */
export async function fileFromHandle(h: FileSystemFileHandle): Promise<File | null> {
  try {
    const q = await (h as any).queryPermission?.({ mode: 'read' })
    if (q !== 'granted') {
      const r = await (h as any).requestPermission?.({ mode: 'read' })
      if (r !== 'granted') return null
    }
    return await h.getFile()
  } catch {
    return null
  }
}

/** 데스크톱(Tauri): 네이티브 대화상자 & 경로 기반 읽기 */
export async function tauriPick(directory: boolean): Promise<PickedFile[]> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readFile, readDir } = await import('@tauri-apps/plugin-fs')
  const sel = await open({ multiple: !directory, directory, filters: directory ? undefined : [{ name: 'Audio', extensions: AUDIO_EXT }] })
  if (!sel) return []
  const paths: { path: string; folder?: string }[] = []
  if (directory) {
    const root = sel as string
    const walk = async (dir: string) => {
      for (const e of await readDir(dir)) {
        const p = `${dir}/${e.name}`
        if (e.isDirectory) await walk(p)
        else if (isAudioName(e.name)) paths.push({ path: p, folder: dir })
      }
    }
    await walk(root)
  } else {
    for (const p of (Array.isArray(sel) ? sel : [sel]) as string[]) paths.push({ path: p, folder: p.replace(/[\\/][^\\/]+$/, '') })
  }
  const out: PickedFile[] = []
  for (const p of paths) {
    const data = await readFile(p.path)
    const name = p.path.split(/[\\/]/).pop()!
    out.push({ file: new File([data], name), path: p.path, folder: p.folder })
  }
  return out
}

export async function tauriRead(path: string): Promise<File | null> {
  try {
    const { readFile, stat } = await import('@tauri-apps/plugin-fs')
    const data = await readFile(path)
    const st = await stat(path).catch(() => null)
    return new File([data], path.split(/[\\/]/).pop()!, { lastModified: st?.mtime ? new Date(st.mtime).getTime() : Date.now() })
  } catch {
    return null
  }
}

export function trackIdFor(f: File) {
  // 이름+크기+수정시각 → 안정적 ID (FNV-1a)
  const s = `${f.name}|${f.size}|${f.lastModified}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return 't' + (h >>> 0).toString(36) + f.size.toString(36)
}

export function download(name: string, data: string | Blob, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type: type + ';charset=utf-8' }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
}
