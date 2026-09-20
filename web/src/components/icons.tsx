// 侧栏图标。Mac 版用 SF Symbols，网页版没有等价物，这里手写一组 16px 的描边 SVG。

interface IconProps {
  size?: number
}

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: '0 0 auto' }}
    >
      {children}
    </svg>
  )
}

export function GaugeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 11.5a6 6 0 1 1 12 0" />
      <path d="M8 11.5 10.8 8.6" />
    </Svg>
  )
}

export function DumbbellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.2 8h9.6" />
      <path d="M2 6.2v3.6M4.6 5v6M11.4 5v6M14 6.2v3.6" />
    </Svg>
  )
}

export function ForkKnifeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.2 2v4.6a1.6 1.6 0 0 0 3.2 0V2" />
      <path d="M6.8 6.9V14" />
      <path d="M11.6 2c1.2.9 1.8 2.1 1.8 3.4 0 1.2-.6 1.9-1.8 2.1V14" />
    </Svg>
  )
}

export function BodyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" />
      <path d="M8 6.6c-.9-1-2.3-.5-2.3.7 0 .9 1.2 1.7 2.3 2.4 1.1-.7 2.3-1.5 2.3-2.4 0-1.2-1.4-1.7-2.3-.7Z" />
    </Svg>
  )
}

export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 4.4A1.4 1.4 0 0 1 3.4 3h5.2a1.4 1.4 0 0 1 1.4 1.4v3.2A1.4 1.4 0 0 1 8.6 9H5.2L3 11V9h-.1A1.4 1.4 0 0 1 2 7.6Z" />
      <path d="M11.2 5.8h1.4A1.4 1.4 0 0 1 14 7.2v3.4a1.4 1.4 0 0 1-1.4 1.4H12v2l-2.2-2H8.2" />
    </Svg>
  )
}

export function ImportIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.6" width="12" height="10.8" rx="2" />
      <path d="M8 5v5" />
      <path d="M5.6 7.8 8 10.2l2.4-2.4" />
    </Svg>
  )
}

export function GearIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3" />
    </Svg>
  )
}