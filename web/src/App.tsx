// 侧栏 + 页面切换。对应 Mac 版 Views.swift 的 ContentView（NavigationSplitView）。
// 不引路由库：Swift 版也没有 URL 路由，选中项就是个内存状态。

import { useState } from 'react'

import {
  BodyIcon,
  ChatIcon,
  DumbbellIcon,
  ForkKnifeIcon,
  GaugeIcon,
  GearIcon,
  ImportIcon,
} from './components/icons'
import { AIChat } from './screens/AIChat'
import { Body } from './screens/Body'
import { Dashboard } from './screens/Dashboard'
import { Diet } from './screens/Diet'
import { ImportExport } from './screens/ImportExport'
import { Settings } from './screens/Settings'
import { Training } from './screens/Training'

type SectionKey = 'dashboard' | 'training' | 'diet' | 'body' | 'aiChat' | 'importExport' | 'profile'

const SECTIONS: { key: SectionKey; label: string; icon: React.ComponentType }[] = [
  { key: 'dashboard', label: '概览', icon: GaugeIcon },
  { key: 'training', label: '训练', icon: DumbbellIcon },
  { key: 'diet', label: '饮食', icon: ForkKnifeIcon },
  { key: 'body', label: '身体', icon: BodyIcon },
  { key: 'aiChat', label: 'AI 助手', icon: ChatIcon },
  { key: 'importExport', label: '导入导出', icon: ImportIcon },
  { key: 'profile', label: '设置', icon: GearIcon },
]

function App() {
  const [section, setSection] = useState<SectionKey>('dashboard')

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">FitTrack</div>
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className="nav-item"
            aria-current={section === key ? 'page' : undefined}
            onClick={() => setSection(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      <main className="content">
        {section === 'dashboard' && <Dashboard />}
        {section === 'training' && <Training />}
        {section === 'diet' && <Diet />}
        {section === 'body' && <Body />}
        {section === 'aiChat' && <AIChat />}
        {section === 'importExport' && <ImportExport />}
        {section === 'profile' && <Settings />}
      </main>
    </div>
  )
}

export default App