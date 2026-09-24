// 导入 / 导出页。完整备份先预览、确认，再由 Store 事务恢复；旧 JSON/CSV 保持追加导入。

import { useRef, useState } from 'react'

import { Card } from '../components/ui'
import { downloadText } from '../download'
import { useAppData } from '../hooks'
import { ICSExporter } from '../ics'
import {
  Importer,
  type ConflictStrategy,
  type RestoreMode,
  type RestorePreview,
} from '../importer'
import { store } from '../store'

const HELP_TEXT = `JSON 示例：
{"version":"1.0","source":"manual","workouts":[{"date":"2026-09-10","split":"推","exercises":[{"name":"杠铃卧推","sets":[{"reps":8,"weight_kg":60}]}]}],"bodyMetrics":[{"date":"2026-09-10","weight_kg":72.5,"bodyFatPct":16}]}

CSV 身体数据示例（表头）：date,weight_kg,body_fat_pct,waist_cm
CSV 训练记录示例（表头）：date,exercise,reps,weight_kg`

const COUNT_LABELS: Record<keyof RestorePreview['counts'], string> = {
  workouts: '训练',
  plannedWorkouts: '训练计划',
  bodyMetrics: '身体数据',
  foods: '食物',
  exercises: '动作',
  dietLogs: '饮食日志',
  dietEvaluations: '校准评估',
  chat: '聊天',
}

export function ImportExport() {
  const data = useAppData()
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [mode, setMode] = useState<RestoreMode>('replace')
  const [strategy, setStrategy] = useState<ConflictStrategy>('local')
  const fileRef = useRef<HTMLInputElement>(null)

  function parseJSON(source: string) {
    const full = Importer.previewFullBackup(source)
    if (full != null) {
      setPreview(full)
      setMessage(full.valid ? '已识别完整 FitTrack 备份，请核对预览后恢复。' : '完整备份未通过验证，不能恢复。')
      return
    }
    setPreview(null)
    const { result, data: next } = Importer.importJSON(source, store.data)
    if (result.workouts > 0 || result.metrics > 0) store.replaceData(next)
    let msg = result.message
    const addedChat = store.importChat(result.chat)
    if (addedChat > 0) msg += `，聊天记录新增 ${addedChat} 条`
    setMessage(msg)
  }

  function runRestore() {
    if (preview == null || !preview.valid) return
    if (mode === 'replace' && !window.confirm('完整恢复将替换本地所有配置和集合数据。恢复前会自动创建快照，确定继续吗？')) return
    try {
      const plan = Importer.planFullRestore(preview, store.data, store.chatMessages, mode, strategy)
      const stats = store.applyRestore(plan)
      setMessage(`恢复成功：新增 ${stats.added}，更新 ${stats.updated}，忽略 ${stats.ignored}，跳过 ${stats.skipped}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败，本地数据未改变')
    }
  }

  function runCSV(source: string) {
    setPreview(null)
    const { result, data: next } = Importer.importCSV(source, store.data)
    setMessage(result.message)
    if (result.workouts > 0 || result.metrics > 0) store.replaceData(next)
  }

  function pickFile(file: File | undefined) {
    if (file == null) return
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result ?? '')
      setText(content)
      if (file.name.toLowerCase().endsWith('.json')) parseJSON(content)
      else runCSV(content)
    }
    reader.readAsText(file)
  }

  function downloadRestoreBackup() {
    const backup = store.getRestoreBackupJSON()
    if (backup == null) {
      setMessage('暂无恢复前快照')
      return
    }
    downloadText('fittrack-before-restore.json', backup, 'application/json')
  }

  return (
    <>
      <h1>导入 / 导出</h1>

      <Card>
        <p className="dim" style={{ marginTop: 0 }}>
          完整备份会先解析预览；历史 JSON 与 CSV 仍按原方式追加。
        </p>

        <textarea
          rows={8}
          value={text}
          style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          onChange={(e) => {
            setText(e.target.value)
            setPreview(null)
          }}
        />

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => parseJSON(text)}>解析 / 导入 JSON</button>
          <button className="btn" onClick={() => runCSV(text)}>导入 CSV</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>选择文件</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,.txt,application/json,text/csv,text/plain"
            style={{ display: 'none' }}
            onChange={(e) => {
              pickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => downloadText('fittrack-export.json', store.exportJSON(), 'application/json')}>导出 JSON</button>
          <button className="btn" onClick={() => downloadText('训练计划.ics', ICSExporter.ics(store.upcomingPlanned(), store.currentBodyWeightKG, data.profile.heightCM), 'text/calendar')}>导出 .ics</button>
          <button className="btn" onClick={downloadRestoreBackup}>下载恢复前快照</button>
        </div>

        {preview != null && (
          <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <strong>完整备份预览</strong>
            <p className="dim">来源 schema v{preview.sourceVersion} → 当前 v{preview.schemaVersion}</p>
            <div className="row">
              {Object.entries(preview.counts).map(([key, value]) => (
                <span key={key}>{COUNT_LABELS[key as keyof typeof COUNT_LABELS]}：{value}</span>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <label>模式 <select value={mode} onChange={(e) => setMode(e.target.value as RestoreMode)}><option value="replace">全量替换</option><option value="merge">安全合并</option></select></label>
              <label>同 ID / 配置冲突 <select value={strategy} onChange={(e) => setStrategy(e.target.value as ConflictStrategy)}><option value="local">保留本地</option><option value="backup">使用备份</option></select></label>
              <button className="btn" disabled={!preview.valid} onClick={runRestore}>执行完整恢复</button>
            </div>
            {mode === 'replace' && <p style={{ color: 'var(--danger, #b42318)', fontWeight: 600 }}>警告：完整恢复会替换本地配置及全部集合。</p>}
            {preview.issues.length > 0 && (
              <ul className="dim">
                {preview.issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.path}：{issue.message}</li>)}
              </ul>
            )}
          </div>
        )}

        {message !== '' && <p className="dim" style={{ marginBottom: 0 }}>{message}</p>}
        <pre className="dim" style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 0 }}>{HELP_TEXT}</pre>
      </Card>
    </>
  )
}
