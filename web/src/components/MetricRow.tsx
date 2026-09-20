// 身体数据历史里的一行（对应 Views.swift 的 MetricRow）。

import { fmt0, fmt1 } from '../engine'
import type { BodyMetric } from '../models'
import { formatDate } from './ui'

export function MetricRow({ m }: { m: BodyMetric }) {
  return (
    <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
      <span style={{ width: 100, flex: '0 0 100px' }}>{formatDate(m.date)}</span>
      <span style={{ width: 80, flex: '0 0 80px' }}>{fmt1(m.weightKG)} kg</span>
      {m.bodyFatPct != null && <span>体脂 {fmt1(m.bodyFatPct)}%</span>}
      {m.waistCM != null && <span>腰围 {fmt0(m.waistCM)}cm</span>}
    </div>
  )
}