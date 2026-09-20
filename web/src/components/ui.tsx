// 通用小组件：对应 Mac 版 Views.swift 里的 StatCard / GroupBox / confirmationDialog / sheet。
// 类名全部复用 src/index.css 里已定义的那一套，不要另起视觉。

import { useCallback, useState, type ReactNode } from 'react'

/** Swift 的 `.formatted(date: .date)` */
export function formatDate(d: Date): string {
  return d.toLocaleDateString('zh-CN')
}

/** 对应 Mac 版的 GroupBox（可选标题 + 标题右侧的操作按钮） */
export function Card({
  title,
  trailing,
  children,
}: {
  title?: ReactNode
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card">
      {title != null &&
        (trailing == null ? (
          <h2>{title}</h2>
        ) : (
          <div className="row between" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {trailing}
          </div>
        ))}
      {children}
    </section>
  )
}

/** 对应 Mac 版的 StatCard */
export function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{title}</div>
      <div className="value">{value}</div>
    </div>
  )
}

/**
 * 数字输入。Swift 的 TextField(format: .number) 是提交时校验，
 * 所以这里也是失焦才夹到 min…max，避免边打字边被改。
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  width = 90,
  suffix,
  placeholder,
}: {
  label?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  width?: number
  suffix?: string
  placeholder?: string
}) {
  const clampOnBlur = (raw: string) => {
    const t = raw.trim()
    const v = t === '' ? value : Number(t)
    if (!isFinite(v)) return
    let c = v
    if (min != null) c = Math.max(c, min)
    if (max != null) c = Math.min(c, max)
    onChange(c)
  }

  const input = (
    <span className="row" style={{ gap: 6 }}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        style={{ width }}
        onChange={(e) => {
          const t = e.target.value
          if (t === '') return
          const v = Number(t)
          if (isFinite(v)) onChange(v)
        }}
        onBlur={(e) => clampOnBlur(e.target.value)}
      />
      {suffix != null && <span className="dim">{suffix}</span>}
    </span>
  )

  if (label == null) return input
  return (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  )
}

/** 对应 Mac 版的 confirmationDialog */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = '删除',
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConfirmSpec {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
}

/** 弹窗状态管理：ask 打开，dialog 渲染到页面里 */
export function useConfirmDialog() {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null)
  const ask = useCallback((s: ConfirmSpec) => setSpec(s), [])
  const dialog =
    spec == null ? null : (
      <ConfirmDialog
        title={spec.title}
        message={spec.message}
        confirmLabel={spec.confirmLabel}
        onConfirm={() => {
          spec.onConfirm()
          setSpec(null)
        }}
        onCancel={() => setSpec(null)}
      />
    )
  return { ask, dialog }
}

/** 对应 Mac 版弹出式表单用的 .sheet，尺寸与 .dialog 一致 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}