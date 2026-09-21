// 概览页。对应 Mac 版 Views.swift 的 DashboardView / GoalProgressView / TodayPlanView。

import { useState } from 'react'

import { GeneratePlanButton, PlanCard } from '../components/PlanCard'
import { StatCard } from '../components/ui'
import { fmt1 } from '../engine'
import { useAppData } from '../hooks'
import { GOAL_LABELS, type BodyMetric, type Goal } from '../models'
import { store } from '../store'

export function Dashboard() {
  const data = useAppData()
  const latest = store.latestWeight
  const sorted = store.sortedMetrics
  const last = sorted.length > 0 ? sorted[sorted.length - 1] : null

  return (
    <>
      <h1>概览</h1>

      <div className="grid">
        <StatCard title="最新体重" value={latest == null ? '—' : `${fmt1(latest)} kg`} />
        <StatCard title="目标体重" value={`${fmt1(data.goal.targetWeightKG)} kg`} />
        <StatCard title="训练记录" value={`${data.workouts.length} 次`} />
        <StatCard title="身体数据" value={`${data.bodyMetrics.length} 条`} />
      </div>

      {last != null && <GoalProgress metric={last} goal={data.goal} />}
      <TodayPlan />
    </>
  )
}

function GoalProgress({ metric, goal }: { metric: BodyMetric; goal: Goal }) {
  const delta = goal.targetWeightKG - metric.weightKG
  return (
    <section className="card">
      <h2>目标进度</h2>
      <div style={{ fontWeight: 600 }}>目标：{GOAL_LABELS[goal.type]}</div>
      <div>
        当前 {fmt1(metric.weightKG)} kg · 目标 {fmt1(goal.targetWeightKG)} kg
      </div>
      <div className="dim">
        {delta > 0
          ? `还需增重 ${fmt1(delta)} kg`
          : `还需减重 ${fmt1(Math.abs(delta))} kg`}
      </div>
    </section>
  )
}

function TodayPlan() {
  const data = useAppData()
  const [hint, setHint] = useState('')

  const bodyWeight = store.currentBodyWeightKG
  const todays = store.planned(new Date())

  return (
    <>
      <div className="row between" style={{ margin: '20px 0 10px' }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>今日训练计划</h2>
        <GeneratePlanButton onResult={setHint} />
      </div>

      {hint !== '' && (
        <p className="dim" style={{ margin: '0 0 10px', fontSize: 13 }}>
          {hint}
        </p>
      )}

      {todays.length === 0 ? (
        <p className="dim">今日暂无计划，点击右上角生成；生成后可在卡片上「编辑」。</p>
      ) : (
        todays.map((w) => (
          <PlanCard
            key={w.id}
            workout={w}
            bodyWeightKG={bodyWeight}
            heightCM={data.profile.heightCM}
          />
        ))
      )}
    </>
  )
}