// 身体数据页。对应 Mac 版 Views.swift 的 BodyView。
//
// 与 Mac 版的差异（有意为之）：Swift Charts 换成内联 SVG 的 LineChart。

import { useState } from 'react'

import { LineChart } from '../components/LineChart'
import { MetricRow } from '../components/MetricRow'
import { Card, NumberField } from '../components/ui'
import { useAppData } from '../hooks'
import { newID } from '../models'
import { store } from '../store'

export function Body() {
  // 订阅一次就够：下面的 sorted 每次渲染都从 store 重新取
  useAppData()
  const [weight, setWeight] = useState(70)
  const [bodyFat, setBodyFat] = useState('')
  const [waist, setWaist] = useState('')

  const sorted = store.sortedMetrics

  /** Swift 的 `Double("")` 是 nil —— 空串要当成「没填」而不是 0 */
  function optional(raw: string): number | null {
    const t = raw.trim()
    if (t === '') return null
    const v = Number(t)
    return isFinite(v) ? v : null
  }

  function add() {
    store.addBodyMetric({
      id: newID(),
      date: new Date(),
      weightKG: weight,
      bodyFatPct: optional(bodyFat),
      waistCM: optional(waist),
    })
    setBodyFat('')
    setWaist('')
  }

  return (
    <>
      <h1>身体数据</h1>

      {sorted.length > 1 ? (
        <div className="card">
          <LineChart points={sorted.map((m) => ({ date: m.date, value: m.weightKG }))} />
        </div>
      ) : (
        <p className="dim">至少录入 2 条体重数据后显示趋势图</p>
      )}

      <Card title="录入今天">
        <div className="row">
          <NumberField value={weight} onChange={setWeight} min={0} width={120} placeholder="体重(kg)" />
          <input
            placeholder="体脂%"
            value={bodyFat}
            style={{ width: 80 }}
            onChange={(e) => setBodyFat(e.target.value)}
          />
          <input
            placeholder="腰围cm"
            value={waist}
            style={{ width: 100 }}
            onChange={(e) => setWaist(e.target.value)}
          />
          <button className="btn primary" onClick={add}>
            添加
          </button>
        </div>
      </Card>

      <Card title="历史记录">
        {sorted.length === 0 ? (
          <p className="empty">暂无记录</p>
        ) : (
          <div className="list">
            {[...sorted].reverse().map((m) => (
              <div className="list-row" key={m.id}>
                <MetricRow m={m} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}