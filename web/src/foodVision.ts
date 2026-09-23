export interface VisionFoodItem {
  name: string
  amountG: number
  kcal: number
  protein: number
  carb: number
  fat: number
  confidence: number
}

const DEFAULT_API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

function finiteNonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`识别结果中的 ${field} 不是有效的非负数`)
  }
  return value
}

function parseItems(content: string): VisionFoodItem[] {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('图片识别返回了无法解析的 JSON，请重试')
  }
  if (parsed == null || typeof parsed !== 'object' || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new Error('图片识别结果缺少 items 数组')
  }
  return (parsed as { items: unknown[] }).items.map((raw) => {
    if (raw == null || typeof raw !== 'object') throw new Error('图片识别结果包含无效条目')
    const item = raw as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (name === '') throw new Error('图片识别结果包含空食物名称')
    return {
      name,
      amountG: finiteNonNegative(item.amountG, 'amountG'),
      kcal: finiteNonNegative(item.kcal, 'kcal'),
      protein: finiteNonNegative(item.protein, 'protein'),
      carb: finiteNonNegative(item.carb, 'carb'),
      fat: finiteNonNegative(item.fat, 'fat'),
      confidence: finiteNonNegative(item.confidence, 'confidence'),
    }
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取所选图片'))
    }
    image.src = url
  })
}

async function compressedDataURL(file: File): Promise<string> {
  const image = await loadImage(file)
  const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (context == null) throw new Error('当前浏览器无法处理图片')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

export async function recognizeFoodImage(file: File): Promise<VisionFoodItem[]> {
  const apiKey = import.meta.env.VITE_VISION_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('未配置图片识别密钥，请在 Vite 环境变量中设置 VITE_VISION_API_KEY')
  }
  const apiURL = import.meta.env.VITE_VISION_API_URL?.trim() || DEFAULT_API_URL
  const model = import.meta.env.VITE_VISION_MODEL?.trim() || DEFAULT_MODEL
  const dataURL = await compressedDataURL(file)
  const response = await fetch(apiURL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: '识别图片中的食物并估算实际可食用份量与营养。只返回 JSON：{"items":[{"name":"中文名称","amountG":0,"kcal":0,"protein":0,"carb":0,"fat":0,"confidence":0}]}。所有数值必须是非负有限数字；kcal 和宏量营养是该份量总量，不是每100克；confidence 为 0 到 1。无法判断时使用保守估算，不要输出解释。',
          },
          { type: 'image_url', image_url: { url: dataURL } },
        ],
      }],
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`图片识别请求失败（${response.status}）：${detail.slice(0, 160)}`)
  }
  const payload = await response.json() as {
    choices?: { message?: { content?: string } }[]
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('图片识别服务未返回有效内容')
  return parseItems(content)
}
