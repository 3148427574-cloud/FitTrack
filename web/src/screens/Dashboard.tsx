// 概览页。对应 Mac 版 Views.swift 的 DashboardView / GoalProgressView / TodayPlanView。

import { useState } from 'react'

import { PlanCard } from '../components/PlanCard'
import { StatCard } from '../components/ui'
import { fmt1 } from '../engine'
import { useAppData } from '../hooks'
import { AIService } from '../ai'
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
  const [generating, setGenerating] = useState(false)
  const [hint, setHint] = useState('')

  const bodyWeight = store.currentBodyWeightKG
  const todays = store.planned(new Date())

  async function generate() {
    setGenerating(true)
    setHint('')
    const snapshot = store.data
    const plan = await AIService.generatePlanWithFallback(snapshot, new Date())
    const usedAI = AIService.hasKey() && plan.exercises.length > 0
    const added = store.addPlannedWorkout(plan)
    setHint(
      added
        ? usedAI
          ? '已由 AI 根据训练历史生成'
          : '未设置 API Key，使用固定模板生成（在「AI 助手」设置 Key 后可启用 AI 生成）'
        : '今日该计划已存在',
    )
    setGenerating(false)
  }

  return (
    <>
      <div className="row between" style={{ margin: '20px 0 10px' }}>
        <h2 style={{ margin: 0, fontSize: 19 }}>今日训练计划</h2>
        <button className="btn" disabled={generating} onClick={generate}>
          生成今日计划
        </button>
      </div>

      {hint !== '' && (
        <p className="dim" style={{ margin: '0 0 10px', fontSize: 13 }}>
          {hint}
        </p>
      )}

      {todays.length === 0 ? (
        <p className="dim">今日暂无计划，点击右上角生成。</p>
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