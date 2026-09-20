// 设置页。对应 Mac 版 Views.swift 的 ProfileView。
//
// 与 Mac 版的差异（有意为之）：
// - 没有页脚的「保存」按钮 —— 网页版每次改动立刻 commit 落盘，不存在「改完忘记保存」；
// - API Key 存 localStorage，不是 Keychain。

import { useState } from 'react'

import { Card, NumberField } from '../components/ui'
import {
  BIG_THREE_LIFTS,
  BIG_THREE_LABELS,
  StrengthModel,
  bigThreeSet,
  bigThreeValue,
  fmt0,
  fmt1,
  type BigThreeLift,
} from '../engine'
import { useApiKey, useAppData } from '../hooks'
import { GOAL_LABELS, GOAL_TYPES, bigThreeIsEmpty } from '../models'
import { store } from '../store'

/** 对应 Swift ProfileView 的 fmtNum：整数不带小数位，否则一位 */
function fmtNum(v: number): string {
  return Number.isInteger(v) ? fmt0(v) : fmt1(v)
}

const ACTIVITY_LEVELS: { value: number; label: string }[] = [
  { value: 1.2, label: '1.2 久坐' },
  { value: 1.375, label: '1.375 轻度活动' },
  { value: 1.55, label: '1.55 中度活动' },
  { value: 1.725, label: '1.725 高度活动' },
  { value: 1.9, label: '1.9 极高活动' },
]

export function Settings() {
  const data = useAppData()
  const apiKey = useApiKey()
  const hasKey = apiKey.trim() !== ''
  const [keyDraft, setKeyDraft] = useState('')
  const [newNote, setNewNote] = useState('')

  const notes = data.coachNotes ?? []
  const anchors = StrengthModel.historicalAnchors(data.workouts)
  const historicalHint = (() => {
    const parts: string[] = []
    for (const lift of BIG_THREE_LIFTS) {
      const v = bigThreeValue(anchors, lift)
      if (v != null) parts.push(`${BIG_THREE_LABELS[lift]} ${fmtNum(v)}kg`)
    }
    return parts.length === 0 ? '' : '历史估算：' + parts.join(' / ')
  })()

  function setLift(lift: BigThreeLift, raw: string) {
    const m = { ...(data.bigThree ?? {}) }
    const trimmed = raw.trim()
    const v = trimmed === '' ? null : Number(trimmed)
    bigThreeSet(m, lift, v == null || !isFinite(v) ? null : v)
    store.setBigThree(bigThreeIsEmpty(m) ? null : m)
  }

  function estimateBigThree() {
    const est = StrengthModel.historicalAnchors(data.workouts)
    if (bigThreeIsEmpty(est)) return
    store.setBigThree(est)
  }

  return (
    <>
      <h1>设置</h1>

      <Card title="个人资料">
        <div className="row">
          <label className="field">
            <span>性别</span>
            <select
              style={{ width: 220 }}
              value={data.profile.sex}
              onChange={(e) => store.updateProfile({ sex: e.target.value })}
            >
              <option value="male">男</option>
              <option value="female">女</option>
            </select>
          </label>
          <NumberField
            label="年龄"
            value={data.profile.age}
            onChange={(v) => store.updateProfile({ age: v })}
            min={10}
            max={90}
            width={70}
          />
          <NumberField
            label="身高(cm)"
            value={data.profile.heightCM}
            onChange={(v) => store.updateProfile({ heightCM: v })}
            width={80}
          />
          <NumberField
            label="每周训练天数"
            value={data.profile.trainingDaysPerWeek}
            onChange={(v) => store.updateProfile({ trainingDaysPerWeek: v })}
            min={1}
            max={7}
            width={70}
          />
          <label className="field">
            <span>活动系数</span>
            <select
              style={{ width: 260 }}
              value={data.profile.activityLevel}
              onChange={(e) => store.updateProfile({ activityLevel: Number(e.target.value) })}
            >
              {ACTIVITY_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card title="目标">
        <div className="row">
          <label className="field">
            <span>目标类型</span>
            <select
              style={{ width: 220 }}
              value={data.goal.type}
              onChange={(e) => store.updateGoal({ type: e.target.value as typeof data.goal.type })}
            >
              {GOAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {GOAL_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="目标体重(kg)"
            value={data.goal.targetWeightKG}
            onChange={(v) => store.updateGoal({ targetWeightKG: v })}
            width={80}
          />
          <NumberField
            label="每周增减(kg)"
            value={data.goal.weeklyTargetDeltaKG}
            onChange={(v) => store.updateGoal({ weeklyTargetDeltaKG: v })}
            width={80}
            step={0.05}
          />
        </div>
      </Card>

      <Card title="三大项极限（1RM）">
        <p className="dim" style={{ fontSize: 12, marginTop: 0 }}>
          给没有历史记录的动作配重时，按发力模式换算：推类看卧推、蹲类看深蹲、髋铰链看硬拉。留空则用训练历史自动估算。
        </p>
        <div className="row">
          {BIG_THREE_LIFTS.map((lift) => {
            const v = bigThreeValue(data.bigThree ?? {}, lift)
            return (
              <label className="field" key={lift}>
                <span>{BIG_THREE_LABELS[lift]}</span>
                <span className="row" style={{ gap: 6 }}>
                  <input
                    placeholder="未填"
                    style={{ width: 72 }}
                    value={v == null ? '' : fmtNum(v)}
                    onChange={(e) => setLift(lift, e.target.value)}
                  />
                  <span className="dim">kg</span>
                </span>
              </label>
            )
          })}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={data.workouts.length === 0} onClick={estimateBigThree}>
            用历史估算
          </button>
          <span className="dim" style={{ fontSize: 12 }}>
            {historicalHint}
          </span>
        </div>
      </Card>

      <Card title="训练偏好与约束">
        <p className="dim" style={{ fontSize: 12, marginTop: 0 }}>
          会长期注入 AI 上下文，影响训练计划的生成与对话建议。也可以在 AI 助手里聊出来，确认后再写入。
        </p>
        {notes.length === 0 ? (
          <p className="dim">暂无</p>
        ) : (
          <div className="list">
            {notes.map((note, index) => (
              <div className="list-row" key={note}>
                <span>• {note}</span>
                <button className="link" onClick={() => store.removeCoachNote(index)}>
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: notes.length === 0 ? 0 : 12 }}>
          <input
            placeholder="例如：每周只能练 4 天，主项偏好低次数"
            value={newNote}
            style={{ flex: 1 }}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <button
            className="btn"
            disabled={newNote.trim() === ''}
            onClick={() => {
              store.addCoachNote(newNote)
              setNewNote('')
            }}
          >
            添加
          </button>
        </div>
      </Card>

      <Card title="AI 设置">
        <p className="dim" style={{ fontSize: 12, marginTop: 0 }}>
          用于 AI 生成训练计划与 AI 助手对话（模型：DeepSeek）
        </p>
        <div className="row">
          <input
            type="password"
            placeholder="DeepSeek API Key（sk-…）"
            value={keyDraft}
            style={{ flex: 1 }}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
          <button
            className="btn primary"
            disabled={keyDraft.trim() === ''}
            onClick={() => {
              store.setApiKey(keyDraft.trim())
              setKeyDraft('')
            }}
          >
            保存
          </button>
          {hasKey && (
            <button
              className="btn"
              onClick={() => {
                store.setApiKey('')
                setKeyDraft('')
              }}
            >
              清除
            </button>
          )}
        </div>
        <p className={hasKey ? 'ok' : 'warn'} style={{ fontSize: 12, marginBottom: 0 }}>
          {hasKey
            ? '已配置 API Key'
            : '未设置 API Key：训练计划将回退到固定模板，AI 助手不可用。'}
        </p>
      </Card>
    </>
  )
}