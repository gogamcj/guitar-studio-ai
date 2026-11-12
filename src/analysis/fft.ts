// 실수 입력 FFT (N/2 복소 FFT + 분리 트릭). 자체 구현.
export class RealFFT {
  readonly n: number
  private half: number
  private rev: Uint32Array
  private cos: Float64Array
  private sin: Float64Array
  private re: Float64Array
  private im: Float64Array
  private twr: Float64Array
  private twi: Float64Array

  constructor(n: number) {
    if (n & (n - 1)) throw new Error('FFT size must be power of 2')
    this.n = n
    const h = n >> 1
    this.half = h
    let bits = 0
    while (1 << bits < h) bits++
    this.rev = new Uint32Array(h)
    for (let i = 0; i < h; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float64Array(h / 2 || 1)
    this.sin = new Float64Array(h / 2 || 1)
    for (let i = 0; i < h / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / h)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / h)
    }
    this.twr = new Float64Array(h)
    this.twi = new Float64Array(h)
    for (let k = 0; k < h; k++) {
      this.twr[k] = Math.cos((-2 * Math.PI * k) / n)
      this.twi[k] = Math.sin((-2 * Math.PI * k) / n)
    }
    this.re = new Float64Array(h)
    this.im = new Float64Array(h)
  }

  /** 입력 x(길이 n) → 크기 스펙트럼 mag(길이 n/2+1) */
  magnitude(x: Float32Array | Float64Array, mag: Float32Array) {
    const h = this.half, re = this.re, im = this.im, rev = this.rev
    for (let i = 0; i < h; i++) {
      const j = rev[i]
      re[j] = x[2 * i]
      im[j] = x[2 * i + 1]
    }
    // 반복형 radix-2
    for (let size = 2; size <= h; size <<= 1) {
      const halfSize = size >> 1
      const step = h / size
      for (let start = 0; start < h; start += size) {
        for (let k = 0; k < halfSize; k++) {
          const wr = this.cos[k * step], wi = this.sin[k * step]
          const a = start + k, b = a + halfSize
          const tr = re[b] * wr - im[b] * wi
          const ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    // 분리: X[k] = (Z[k] + conj(Z[h-k]))/2 + W^k (Z[k] - conj(Z[h-k]))/(2i)
    mag[0] = Math.abs(re[0] + im[0])
    mag[h] = Math.abs(re[0] - im[0])
    for (let k = 1; k < h; k++) {
      const zr = re[k], zi = im[k]
      const cr = re[h - k], ci = -im[h - k]
      const er = (zr + cr) / 2, ei = (zi + ci) / 2
      const or_ = (zi - ci) / 2, oi = -(zr - cr) / 2
      const wr = this.twr[k], wi = this.twi[k]
      const xr = er + (or_ * wr - oi * wi)
      const xi = ei + (or_ * wi + oi * wr)
      mag[k] = Math.sqrt(xr * xr + xi * xi)
    }
  }
}

export function hann(n: number) {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}
