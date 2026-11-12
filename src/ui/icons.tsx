import type { SVGProps } from 'react'

const base = (d: React.ReactNode) => (p: SVGProps<SVGSVGElement> & { size?: number }) => {
  const { size = 18, ...rest } = p
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {d}
    </svg>
  )
}

export const IPlay = (p: SVGProps<SVGSVGElement> & { size?: number }) => {
  const { size = 18, ...rest } = p
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" /></svg>
}
export const IPause = (p: SVGProps<SVGSVGElement> & { size?: number }) => {
  const { size = 18, ...rest } = p
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}><rect x="5.5" y="4" width="4.5" height="16" rx="1.2" /><rect x="14" y="4" width="4.5" height="16" rx="1.2" /></svg>
}
export const IPrev = base(<><path d="M18 18 9 12l9-6v12Z" fill="currentColor" /><path d="M6 6v12" /></>)
export const INext = base(<><path d="m6 6 9 6-9 6V6Z" fill="currentColor" /><path d="M18 6v12" /></>)
export const IOpen = base(<><path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-3H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1Z" /></>)
export const IFolder = base(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M12 11v5M9.5 13.5h5" /></>)
export const ISpark = base(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></>)
export const IGear = base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>)
export const ISun = base(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
export const IMoon = base(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />)
export const IVolume = base(<><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>)
export const IRepeat = base(<><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>)
export const IMetronome = base(<><path d="M8.5 3h7l3.5 18H5L8.5 3Z" /><path d="m12 15 5-9" /><path d="M7 17h10" /></>)
export const IStar = (p: SVGProps<SVGSVGElement> & { size?: number; filled?: boolean }) => {
  const { size = 18, filled, ...rest } = p
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden {...rest}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
}
export const ITrash = base(<><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></>)
export const IClose = base(<path d="M6 6l12 12M18 6 6 18" />)
export const IPlus = base(<path d="M12 5v14M5 12h14" />)
export const IMinus = base(<path d="M5 12h14" />)
export const IUp = base(<path d="m6 15 6-6 6 6" />)
export const IDown = base(<path d="m6 9 6 6 6-6" />)
export const IList = base(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></>)
export const IGuitar = base(<><path d="m20 4-6.5 6.5" /><path d="m18 2 4 4" /><path d="M11.5 12.5a3 3 0 0 0-4.2-.3c-.7.6-.8 1.5-1.6 2-1.4.8-3.4.4-3.4 3 0 2 2.5 4.5 4.5 4.5 2.6 0 2.2-2 3-3.4.5-.8 1.4-.9 2-1.6a3 3 0 0 0-.3-4.2Z" /><circle cx="9" cy="16" r="1" /></>)
export const IReport = base(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>)
export const IYouTube = base(<><rect x="2.5" y="5" width="19" height="14" rx="4" /><path d="m10 9 5 3-5 3V9Z" fill="currentColor" /></>)
export const IWave = base(<path d="M2 12h2l2-6 3 12 3-15 3 18 3-12 2 3h2" />)
export const IFlag = base(<><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>)
export const ICopy = base(<><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>)
export const IDownload = base(<><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>)
export const IEdit = base(<><path d="M4 20h4L19 9l-4-4L4 16v4Z" /></>)
export const IZoomIn = base(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M11 8v6M8 11h6" /></>)
export const IZoomOut = base(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M8 11h6" /></>)
