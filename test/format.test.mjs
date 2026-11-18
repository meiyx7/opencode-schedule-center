import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { outcomeLabel, describeWhen, actionText, actionLabel, actionArgsText, scheduleTitle } from "./.build/gui/format.js"

describe("批次4：官方状态/结果展示一致性", () => {
  it("七个官方 outcome 各有明确文案，checked 不等于 skipped", () => {
    const expected = {
      fired: "已触发",
      late: "延迟触发",
      checked: "已检查条件",
      expired: "已过期",
      skipped: "已跳过",
      disabled: "已禁用",
      failed: "触发失败",
    }
    for (const [value, text] of Object.entries(expected)) {
      assert.equal(outcomeLabel(value)?.text, text, `outcome ${value}`)
    }
    assert.notEqual(outcomeLabel("checked").text, outcomeLabel("skipped").text)
    assert.equal(outcomeLabel(undefined), null)
  })

  it("全部 outcome 都有 tone，不向用户暴露英文原值兜底", () => {
    for (const value of ["fired", "late", "checked", "expired", "skipped", "disabled", "failed"]) {
      const label = outcomeLabel(value)
      assert.ok(label)
      assert.ok(["ok", "warn", "bad"].includes(label.tone))
      assert.equal(label.text, label.text, "文案非空")
      assert.ok(!/^[a-z]+$/.test(label.text), `${value} 不应显示英文原值`)
    }
  })

  it("四种触发方式均可描述且时区字段不参与本地推算", () => {
    assert.ok(describeWhen({ type: "in", in: "30 minutes" }).includes("后"))
    assert.ok(describeWhen({ type: "at", at: "2026-12-01T09:00:00" }).includes("触发"))
    assert.ok(describeWhen({ type: "every", every: "2 hours" }).includes("每"))
    assert.ok(describeWhen({ type: "cron", cron: "0 9 * * 1-5" }).includes("工作日"))
    // A tz variant must describe identically — tz is server data, not a local preview input.
    assert.equal(
      describeWhen({ type: "every", every: "2 hours", tz: "Asia/Shanghai" }),
      describeWhen({ type: "every", every: "2 hours" }),
    )
  })
})

describe("B2.1：Action 展示不混淆 Code 与 Prompt", () => {
  it("prompt action 文本/标签为提示词，args 为空", () => {
    const action = { type: "prompt", prompt: "每天检查构建", to: { session: "ses-1" } }
    assert.equal(actionText(action), "每天检查构建")
    assert.equal(actionLabel(action), "提示词")
    assert.equal(actionArgsText(action), undefined)
  })

  it("code action 明确标注为代码，绝不当作 prompt 文本", () => {
    const action = { type: "code", code: "return dayOfWeek() === 5", args: { tz: "Asia/Shanghai" } }
    const text = actionText(action)
    assert.ok(text.includes("代码"), "搜索/标题文本须标注代码")
    assert.ok(text.includes("return dayOfWeek()"), "保留 code 原文")
    assert.equal(actionLabel(action), "代码")
    assert.equal(actionArgsText(action), JSON.stringify({ tz: "Asia/Shanghai" }), "args 完整序列化")
  })

  it("scheduleTitle 对 code action 不用 name 时也不把它伪装成提示词", () => {
    const base = {
      id: "t-1",
      sessionID: "ses-1",
      when: { type: "every", every: "5 minutes" },
      tz: "Asia/Shanghai",
      status: "active",
      runCount: 0,
      time: { created: 1, updated: 1 },
    }
    const titled = scheduleTitle({ ...base, name: "命名任务", action: { type: "code", code: "x()" } })
    assert.equal(titled, "命名任务")
    const fallback = scheduleTitle({ ...base, name: "", action: { type: "code", code: "x()" } })
    assert.ok(fallback.startsWith("[代码]"))
  })
})
