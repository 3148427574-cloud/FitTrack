// AI 助手页的两个组件：聊天气泡 + 资料变更确认卡片（对应 Views.swift 的 ChatBubble / ProposalCard）。

import { AppStore, store } from '../store'
import { useAppData } from '../hooks'
import type { ChatMessage } from '../models'

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return <div className={`bubble ${isUser ? 'user' : 'assistant'}`}>{message.content}</div>
}

/** AI 提出的资料变更确认卡片：用户点「应用」才写入 */
export function ProposalCard({ message }: { message: ChatMessage }) {
  const data = useAppData()

  const json = message.proposal
  const payload = json == null ? null : AppStore.decodePayload(json)
  if (payload == null) return null

  const status = message.proposalStatus ?? ''
  const applied = message.proposalResult ?? []
  // 待确认时用同一个函数做预览，保证预览与落地一致
  const pending = AppStore.plannedChanges(payload, data).changes
  const lines = status === 'applied' ? applied : pending

  return (
    <div className="proposal">
      <div className={`head${status === 'applied' ? ' ok' : ''}`}>
        {status === 'applied' ? '已应用到个人资料' : '建议更新个人资料'}
      </div>

      {status === 'dismissed' ? (
        <span className="dim">已忽略这条建议</span>
      ) : (
        <>
          {payload.reason != null && payload.reason !== '' && (
            <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>
              {payload.reason}
            </div>
          )}

          {lines.length === 0 ? (
            <div className="dim">
              {status === 'applied' ? '没有实际改动。' : '这些内容已经是最新的。'}
            </div>
          ) : (
            <ul>
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          {status === '' && (
            <div className="row between" style={{ marginTop: 4 }}>
              <button
                className="btn"
                onClick={() => store.setProposalStatus(message.id, 'dismissed')}
              >
                忽略
              </button>
              <button
                className="btn primary"
                disabled={pending.length === 0}
                onClick={() => store.applyProposal(message.id)}
              >
                应用
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}