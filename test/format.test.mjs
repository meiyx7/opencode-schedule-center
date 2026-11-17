import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { outcomeLabel, describeCondition, describeWhen } from "./.build/gui/format.js"

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

  it("shell 条件展示 run/is/matches/changes，code 条件展示代码", () => {
    const shell = describeCondition({ type: "shell", run: "git status", is: "clean", matches: "ok", changes: true })
    assert.ok(shell.includes("git status"))
    assert.ok(shell.includes("clean"))
    assert.ok(shell.includes("ok"))
    assert.ok(shell.includes("变化"))
    const code = describeCondition({ type: "code", code: "return true" })
    assert.ok(code.includes("return true"))
    assert.equal(describeCondition(undefined), "")
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
