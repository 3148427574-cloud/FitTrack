// 导入 / 导出页。对应 Mac 版 Views.swift 的 ImportView。
//
// 与 Mac 版的差异（有意为之）：fileImporter / fileExporter 换成 <input type="file"> 与 Blob 下载；
// Importer 在 TS 里没有 inout，返回 { result, data }，这里把 data 交给 store.replaceData。

import { useRef, useState } from 'react'

import { Card } from '../components/ui'
import { downloadText } from '../download'
import { useAppData } from '../hooks'
import { ICSExporter } from '../ics'
import { Importer } from '../importer'
import { store } from '../store'

const HELP_TEXT = `JSON 示例：
{"version":"1.0","source":"manual","workouts":[{"date":"2026-09-10","split":"推","exercises":[{"name":"杠铃卧推","sets":[{"reps":8,"weight_kg":60}]}]}],"bodyMetrics":[{"date":"2026-09-10","weight_kg":72.5,"bodyFatPct":16}]}

CSV 身体数据示例（表头）：date,weight_kg,body_fat_pct,waist_cm
CSV 训练记录示例（表头）：date,exercise,reps,weight_kg`

export function ImportExport() {
  const data = useAppData()
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function runJSON(source: string) {
    const { result, data: next } = Importer.importJSON(source, store.data)
    if (result.workouts > 0 || result.metrics > 0) store.replaceData(next)
    let msg = result.message
    const addedChat = store.importChat(result.chat)
    if (addedChat > 0) msg += `，聊天记录新增 ${addedChat} 条`
    setMessage(msg)
  }

  function runCSV(source: string) {
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
      if (file.name.toLowerCase().endsWith('.json')) runJSON(content)
      else runCSV(content)
    }
    reader.readAsText(file)
  }

  function exportJSON() {
    downloadText('fittrack-export.json', store.exportJSON(), 'application/json')
  }

  function exportICS() {
    downloadText(
      '训练计划.ics',
      ICSExporter.ics(store.upcomingPlanned(), store.currentBodyWeightKG, data.profile.heightCM),
      'text/calendar',
    )
  }

  return (
    <>
      <h1>导入 / 导出</h1>

      <Card>
        <p className="dim" style={{ marginTop: 0 }}>
          历史数据上传接口：粘贴 CSV 或 JSON，或从文件导入。
        </p>

        <textarea
          rows={8}
          value={text}
          style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => runJSON(text)}>
            导入 JSON
          </button>
          <button className="btn" onClick={() => runCSV(text)}>
            导入 CSV
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            选择文件
          </button>
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
          <button className="btn" onClick={exportJSON}>
            导出 JSON
          </button>
          <button className="btn" onClick={exportICS}>
            导出 .ics
          </button>
        </div>

        {message !== '' && (
          <p className="dim" style={{ marginBottom: 0 }}>
            {message}
          </p>
        )}

        <pre className="dim" style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 0 }}>
          {HELP_TEXT}
        </pre>
      </Card>
    </>
  )
}