// 页面读取 store 的统一入口。
//
// store.ts 的快照是稳定引用（只有 commit 才换对象），所以 useSyncExternalStore 直接可用。

import { useSyncExternalStore } from 'react'

import type { AppData, ChatMessage } from './models'
import { store } from './store'

export function useAppData(): AppData {
  return useSyncExternalStore(store.subscribe, store.getData)
}

export function useChatMessages(): ChatMessage[] {
  return useSyncExternalStore(store.subscribe, store.getChat)
}

export function useApiKey(): string {
  return useSyncExternalStore(store.subscribe, () => store.apiKey)
}