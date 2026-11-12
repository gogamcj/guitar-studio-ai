import { useEffect } from 'react'
import { IClose } from './icons'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card w-full max-w-md p-5 shadow-2xl" role="dialog" aria-label={title}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="닫기"><IClose /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
