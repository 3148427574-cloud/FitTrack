// 饮食页。对应 Mac 版 Views.swift 的 DietView。

import { useState } from 'react'

import { Card, NumberField } from '../components/ui'
import { DietPlanner, fmt0, fmt1 } from '../engine'
import { useAppData } from '../hooks'
import { newID } from '../models'
import { store } from '../store'

export function Diet() {
  const data = useAppData()
  const [logFoodName, setLogFoodName] = useState(data.foods[0]?.name ?? '')
  const [logAmount, setLogAmount] = useState(100)

  const weight = store.latestWeight ?? data.goal.targetWeightKG
  const macros = DietPlanner.targets(data.profile, data.goal, weight)
  const mealPlan = DietPlanner.sampleMealPlan(data.profile, data.goal, weight, data.foods)

  function addLog() {
    store.addDietLog({
      id: newID(),
      date: new Date(),
      foodName: logFoodName,
      amountG: logAmount,
    })
  }

  return (
    <>
      <h1>饮食</h1>

      <Card title={`每日目标 · 当前体重 ${fmt1(weight)} kg`}>
        <div style={{ fontWeight: 650 }}>热量 {fmt0(macros.kcal)} 千卡</div>
        <div className="dim">
          蛋白质 {fmt0(macros.protein)} g · 碳水 {fmt0(macros.carb)} g · 脂肪 {fmt0(macros.fat)} g
        </div>
      </Card>

      <Card title="示例餐单">
        {mealPlan.map((line) => (
          <div key={line} className="dim">
            {line}
          </div>
        ))}
      </Card>

      <Card title="记录饮食">
        <div className="row">
          <select
            value={logFoodName}
            style={{ width: 180 }}
            onChange={(e) => setLogFoodName(e.target.value)}
          >
            {data.foods.map((f) => (
              <option key={f.id} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <NumberField value={logAmount} onChange={setLogAmount} min={0} width={80} />
          <button className="btn primary" disabled={logFoodName === ''} onClick={addLog}>
            添加
          </button>
        </div>
      </Card>

      <Card title="食物库（每 100g）">
        <div className="list">
          {data.foods.map((f) => (
            <div className="row" key={f.id} style={{ gap: 0, fontSize: 14 }}>
              <span style={{ flex: '0 0 130px' }}>{f.name}</span>
              <span style={{ flex: '0 0 80px' }}>{fmt0(f.kcalPer100g)} kcal</span>
              <span style={{ flex: '0 0 90px' }}>蛋白 {fmt0(f.proteinPer100g)}g</span>
              <span style={{ flex: '0 0 90px' }}>碳水 {fmt0(f.carbPer100g)}g</span>
              <span>脂肪 {fmt0(f.fatPer100g)}g</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}