// AI 助手页。对应 Mac 版 Views.swift 的 AIChatView。
//
// 与 Mac 版的差异（有意为之）：API Key 存在 localStorage（浏览器没有 Keychain），
// 所以「保存」写的是 store.setApiKey，读取走 store.apiKey。

import { Fragment, useEffect, useRef, useState } from 'react'

import { AIService } from '../ai'
import { ChatBubble, ProposalCard } from '../components/Chat'
import { useConfirmDialog } from '../components/ui'
import { useApiKey, useChatMessages } from '../hooks'
import { newID } from '../models'
import { MAX_CHAT, store } from '../store'

const GREETING =
  '你好！我是你的 AI 健身助手，可以看到你的训练历史、身体数据与今日计划。可以问我动作替换、动作规范、计划调整或饮食问题，例如：“杠铃卧推肩膀不舒服，能换成什么动作？”\n\n也可以直接让我改今日计划（比如“把今天的卧推换成哑铃卧推”“深蹲减一组”），或告诉我你的长期目标与限制（比如“我想增肌增强力量，每周只能练 4 天”）。这些改动都会先给出待确认卡片，你点「应用」后才会写入。'

export function AIChat() {
  const messages = useChatMessages()
  const apiKey = useApiKey()
  const hasKey = apiKey.trim() !== ''

  const [draft, setDraft] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const { ask, dialog } = useConfirmDialog()

  const bottomRef = useRef<HTMLDivElement>(null)

  // 对应 Swift 的 .onAppear { seedGreeting() }
  useEffect(() => {
    if (store.chatMessages.length > 0) return
    if (!AIService.hasKey()) return
    store.appendChat({ id: newID(), role: 'assistant', content: GREETING })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, busy])

  function saveKey() {
    store.setApiKey(keyDraft.trim())
    setKeyDraft('')
    // 存完 Key 后补上欢迎语（与 Swift 的 seedGreeting 一致）
    if (store.chatMessages.length === 0) {
      store.appendChat({ id: newID(), role: 'assistant', content: GREETING })
    }
  }

  async function send() {
    const text = draft.trim()
    if (text === '' || !hasKey || busy) return
    store.appendChat({ id: newID(), role: 'user', content: text })
    setDraft('')
    setBusy(true)

    const context = AIService.contextString(store.data)
    // 构造历史：跳过开头连续的 assistant 消息（欢迎语），确保从 user 开始
    const history: { role: string; content: string }[] = []
    let started = false
    for (const m of store.chatMessages) {
      if (!started && m.role !== 'user') continue
      started = true
      history.push({ role: m.role, content: m.content })
    }

    try {
      const reply = await AIService.chat(history, context)
      store.appendChat({
        id: newID(),
        role: 'assistant',
        content: reply.text,
        proposal: reply.proposalJSON,
      })
      store.trimChat(MAX_CHAT)
    } catch (e) {
      store.appendChat({
        id: newID(),
        role: 'assistant',
        content: `出错：${e instanceof Error ? e.message : String(e)}`,
      })
      store.trimChat(MAX_CHAT)
    }
    setBusy(false)
  }

  return (
    <>
      <h1>AI 助手</h1>

      {!hasKey && (
        <div className="card" style={{ borderColor: 'var(--orange)' }}>
          <p className="warn" style={{ margin: '0 0 8px' }}>
            需要 DeepSeek API Key 才能使用 AI 功能
          </p>
          <div className="row">
            <input
              type="password"
              placeholder="粘贴 API Key（sk-…）"
              value={keyDraft}
              style={{ flex: 1 }}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <button className="btn primary" disabled={keyDraft.trim() === ''} onClick={saveKey}>
              保存
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {messages.length === 0 ? (
          <p className="empty">还没有对话。设置 API Key 后就可以开始提问。</p>
        ) : (
          <div className="chat">
            {messages.map((m) => (
              <Fragment key={m.id}>
                <ChatBubble message={m} />
                {m.proposal != null && <ProposalCard message={m} />}
              </Fragment>
            ))}
          </div>
        )}

        {busy && <p className="dim" style={{ fontSize: 13, marginBottom: 0 }}>思考中…</p>}

        <div ref={bottomRef} />

        <div className="composer">
          <textarea
            rows={2}
            placeholder="问：这个动作能换成什么？…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button className="btn primary" disabled={draft.trim() === '' || busy} onClick={send}>
            发送
          </button>
          <button
            className="btn"
            disabled={messages.length === 0}
            onClick={() =>
              ask({
                title: '清空聊天记录？',
                message: '将删除全部聊天记录，且不可恢复。',
                confirmLabel: '清空',
                onConfirm: () => store.clearChat(),
              })
            }
          >
            清空
          </button>
        </div>
      </div>

      {dialog}
    </>
  )
}