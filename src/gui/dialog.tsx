import type { Context } from "@opencode/plugin/gui"
import { SchedulePage } from "./page"
import type { ScheduleStore } from "../store"

/** Dialog wrapper: use the host's Dialog chrome so the panel has a real card. */
export function ScheduleDialog(props: { ctx: Context; store: ScheduleStore; onClose: () => void }) {
  const ui = props.ctx.ui
  return (
    <ui.Dialog title="定时任务" size="x-large" closable>
      <SchedulePage ctx={props.ctx} store={props.store} />
    </ui.Dialog>
  )
}
