// 体重趋势图。Mac 版用 Swift Charts 的 LineMark + PointMark，
// 这里手写一个内联 SVG，类名沿用 index.css 里为图表预留的 .chart 一套。

import { fmt1 } from '../engine'

export interface ChartPoint {
  date: Date
  value: number
}

const W = 800
const PAD_L = 46
const PAD_R = 14
const PAD_T = 12
const PAD_B = 28

export function LineChart({ points, height = 240 }: { points: ChartPoint[]; height?: number }) {
  const H = height
  const values = points.map((p) => p.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  // 上下留白，全平时给一个固定跨度，避免除零
  const span = rawMax - rawMin || Math.max(1, rawMax * 0.05)
  const min = rawMin - span * 0.15
  const max = rawMax + span * 0.15

  const t0 = points[0].date.getTime()
  const t1 = points[points.length - 1].date.getTime()
  const tSpan = t1 - t0

  const x = (d: Date) =>
    tSpan === 0
      ? PAD_L + (W - PAD_L - PAD_R) / 2
      : PAD_L + ((d.getTime() - t0) / tSpan) * (W - PAD_L - PAD_R)
  const y = (v: number) => H - PAD_B - ((v - min) / (max - min)) * (H - PAD_T - PAD_B)

  const coords = points.map((p) => ({ x: x(p.date), y: y(p.value), point: p }))
  const first = points[0]
  const last = points[points.length - 1]

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="体重趋势">
      <line className="axis" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} />
      <line className="axis" x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} />

      <text className="label" x={PAD_L - 6} y={y(rawMax) + 3} textAnchor="end">
        {fmt1(rawMax)}
      </text>
      <text className="label" x={PAD_L - 6} y={y(rawMin) + 3} textAnchor="end">
        {fmt1(rawMin)}
      </text>

      <polyline className="line" points={coords.map((c) => `${c.x},${c.y}`).join(' ')} />

      {coords.map((c) => (
        <circle
          key={c.point.date.getTime()}
          className="dot"
          cx={c.x}
          cy={c.y}
          r={coords.length > 60 ? 1.5 : 3}
        />
      ))}

      <text className="label" x={PAD_L} y={H - 8}>
        {first.date.toLocaleDateString('zh-CN')}
      </text>
      {tSpan !== 0 && (
        <text className="label" x={W - PAD_R} y={H - 8} textAnchor="end">
          {last.date.toLocaleDateString('zh-CN')}
        </text>
      )}
    </svg>
  )
}