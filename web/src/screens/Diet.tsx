import { useEffect, useMemo, useState } from 'react'

import { Card, NumberField, StatCard } from '../components/ui'
import {
  DietPlanner,
  dietSuggestions,
  dietTargetStrategy,
  fmt0,
  fmt1,
  nutritionForDietLog,
  summarizeDietLogsOnDate,
} from '../engine'
import { recognizeFoodImage, type VisionFoodItem } from '../foodVision'
import { useAppData } from '../hooks'
import { newID } from '../models'
import { store } from '../store'

export function Diet() {
  const data = useAppData()
  const [logFoodName, setLogFoodName] = useState(data.foods[0]?.name ?? '')
  const [logAmount, setLogAmount] = useState(100)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewURL, setPreviewURL] = useState<string | null>(null)
  const [visionItems, setVisionItems] = useState<VisionFoodItem[]>([])
  const [visionLoading, setVisionLoading] = useState(false)
  const [visionError, setVisionError] = useState('')

  useEffect(() => {
    if (imageFile == null) {
      setPreviewURL(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setPreviewURL(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const weight = store.latestWeight ?? data.goal.targetWeightKG
  const targets = DietPlanner.targets(data.profile, data.goal, weight)
  const strategy = dietTargetStrategy(data.profile, data.goal, weight)
  const now = new Date()
  const consumed = summarizeDietLogsOnDate(data.dietLogs, data.foods, now)
  const suggestions = dietSuggestions(targets, consumed)
  const todayLogs = useMemo(
    () => data.dietLogs.filter((log) =>
      log.date.getFullYear() === now.getFullYear() &&
      log.date.getMonth() === now.getMonth() &&
      log.date.getDate() === now.getDate(),
    ).sort((a, b) => b.date.getTime() - a.date.getTime()),
    [data.dietLogs, now.getDate(), now.getMonth(), now.getFullYear()],
  )

  function addLog() {
    const food = data.foods.find((item) => item.name === logFoodName)
    if (food == null || !(logAmount > 0)) return
    const scale = logAmount / 100
    store.addDietLog({
      id: newID(),
      date: new Date(),
      foodName: food.name,
      amountG: logAmount,
      foodId: food.id,
      kcal: food.kcalPer100g * scale,
      protein: food.proteinPer100g * scale,
      carb: food.carbPer100g * scale,
      fat: food.fatPer100g * scale,
      source: 'manual',
    })
  }

  async function recognizeImage() {
    if (imageFile == null) return
    setVisionLoading(true)
    setVisionError('')
    setVisionItems([])
    try {
      setVisionItems(await recognizeFoodImage(imageFile))
    } catch (error) {
      setVisionError(error instanceof Error ? error.message : '图片识别失败，请重试')
    } finally {
      setVisionLoading(false)
    }
  }

  function updateVisionItem(index: number, patch: Partial<VisionFoodItem>) {
    setVisionItems((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  function visionItemIsValid(item: VisionFoodItem): boolean {
    return item.name.trim() !== '' && item.amountG > 0 &&
      [item.kcal, item.protein, item.carb, item.fat].every((value) => Number.isFinite(value) && value >= 0)
  }

  function confirmVisionItems() {
    if (imageFile == null || visionItems.length === 0 || !visionItems.every(visionItemIsValid)) return
    const date = new Date()
    for (const item of visionItems) {
      store.addDietLog({
        id: newID(),
        date,
        foodName: item.name.trim(),
        amountG: item.amountG,
        kcal: item.kcal,
        protein: item.protein,
        carb: item.carb,
        fat: item.fat,
        source: 'image',
        imageName: imageFile.name,
      })
    }
    setVisionItems([])
    setImageFile(null)
  }

  const remaining = {
    kcal: targets.kcal - consumed.kcal,
    protein: targets.protein - consumed.protein,
    carb: targets.carb - consumed.carb,
    fat: targets.fat - consumed.fat,
  }

  return (
    <>
      <h1>饮食</h1>

      <Card title={`每日目标 · 当前体重 ${fmt1(weight)} kg`}>
        <div className="grid">
          <StatCard title="TDEE" value={`${fmt0(strategy.tdee)} kcal`} />
          <StatCard title="目标热量" value={`${fmt0(strategy.targetKcal)} kcal`} />
          <StatCard title="目标策略" value={strategy.label} />
        </div>
      </Card>

      <Card title="今日进度">
        <div className="grid">
          {(['kcal', 'protein', 'carb', 'fat'] as const).map((key) => {
            const label = { kcal: '热量', protein: '蛋白质', carb: '碳水', fat: '脂肪' }[key]
            const unit = key === 'kcal' ? 'kcal' : 'g'
            return <StatCard key={key} title={label} value={`${fmt0(consumed[key])} / ${fmt0(targets[key])} · 剩余 ${fmt0(remaining[key])} ${unit}`} />
          })}
        </div>
      </Card>

      <Card title="今日建议">
        <div className="list">
          {suggestions.map((suggestion) => <div className="dim" key={suggestion}>• {suggestion}</div>)}
        </div>
      </Card>

      <Card title="手动记录">
        <div className="row">
          <select value={logFoodName} style={{ width: 180 }} onChange={(e) => setLogFoodName(e.target.value)}>
            {data.foods.map((food) => <option key={food.id} value={food.name}>{food.name}</option>)}
          </select>
          <NumberField value={logAmount} onChange={setLogAmount} min={0} width={80} suffix="g" />
          <button className="btn primary" disabled={logFoodName === '' || !(logAmount > 0)} onClick={addLog}>添加</button>
        </div>
      </Card>

      <Card title="照片识别">
        <p className="dim">照片识别仅为估算，份量和烹调用油可能造成明显误差。请编辑核对每项结果，确认后才会保存；原图不会保存。</p>
        <div className="row">
          <input type="file" accept="image/*" capture="environment" onChange={(event) => {
            setImageFile(event.target.files?.[0] ?? null)
            setVisionItems([])
            setVisionError('')
          }} />
          <button className="btn primary" disabled={imageFile == null || visionLoading} onClick={recognizeImage}>
            {visionLoading ? '识别中…' : '开始识别'}
          </button>
        </div>
        {previewURL != null && <img src={previewURL} alt="待识别食物预览" style={{ display: 'block', maxWidth: '100%', maxHeight: 320, marginTop: 12, borderRadius: 8 }} />}
        {visionError !== '' && <p className="err">{visionError}</p>}
        {visionItems.length > 0 && (
          <div className="list" style={{ marginTop: 12 }}>
            {visionItems.map((item, index) => (
              <div className="list-row" key={index} style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label className="field" style={{ flex: '1 1 140px' }}>名称
                  <input value={item.name} onChange={(e) => updateVisionItem(index, { name: e.target.value })} />
                </label>
                {(['amountG', 'kcal', 'protein', 'carb', 'fat'] as const).map((key) => (
                  <NumberField key={key} label={{ amountG: '克数', kcal: 'kcal', protein: '蛋白质', carb: '碳水', fat: '脂肪' }[key]} value={item[key]} onChange={(value) => updateVisionItem(index, { [key]: value })} min={0} step={0.1} width={76} />
                ))}
                <span className="dim">置信度 {fmt0(Math.min(1, item.confidence) * 100)}%</span>
                <button className="btn danger" onClick={() => setVisionItems((items) => items.filter((_, i) => i !== index))}>移除</button>
              </div>
            ))}
            <div className="row">
              <button className="btn primary" disabled={!visionItems.every(visionItemIsValid)} onClick={confirmVisionItems}>确认并保存全部</button>
              <span className="dim">确认即表示你已检查名称、份量和营养估算。</span>
            </div>
          </div>
        )}
      </Card>

      <Card title="今天的记录">
        {todayLogs.length === 0 ? <div className="empty">今天还没有饮食记录</div> : (
          <div className="list">
            {todayLogs.map((log) => {
              const nutrition = nutritionForDietLog(log, data.foods)
              return (
                <div className="list-row" key={log.id}>
                  <div>
                    <div>{log.foodName} · {fmt1(log.amountG)} g</div>
                    <div className="dim">{fmt0(nutrition.kcal)} kcal · P {fmt1(nutrition.protein)} / C {fmt1(nutrition.carb)} / F {fmt1(nutrition.fat)} g{log.source === 'image' ? ' · 照片估算' : ''}</div>
                  </div>
                  <button className="btn danger" onClick={() => store.deleteDietLog(log.id)}>删除</button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card title="食物库（每 100g）">
        <div className="list">
          {data.foods.map((food) => (
            <div className="row" key={food.id} style={{ gap: 0, fontSize: 14 }}>
              <span style={{ flex: '0 0 130px' }}>{food.name}</span>
              <span style={{ flex: '0 0 80px' }}>{fmt0(food.kcalPer100g)} kcal</span>
              <span style={{ flex: '0 0 90px' }}>蛋白 {fmt0(food.proteinPer100g)}g</span>
              <span style={{ flex: '0 0 90px' }}>碳水 {fmt0(food.carbPer100g)}g</span>
              <span>脂肪 {fmt0(food.fatPer100g)}g</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
