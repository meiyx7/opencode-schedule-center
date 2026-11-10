import { Command, Plugin, SettingsPage, TitlebarItem } from "@opencode/plugin/gui"
import { ScheduleDialog } from "./gui/dialog"
import { SchedulePage } from "./gui/page"
import { installStyles } from "./gui/styles"
import { ScheduleStore } from "./store"

export default Plugin.define({
  i18n: {
    en: {
      title: "定时任务",
      open: "打开定时任务",
    },
  },
  setup(ctx) {
    installStyles()
    const store = new ScheduleStore(ctx.client)

    const open = () => {
      if (ctx.dialogs.active()) return
      ctx.dialogs.open((dialog) => <ScheduleDialog ctx={ctx} store={store} onClose={() => dialog.close()} />)
    }

    ctx.add(SettingsPage, {
      id: "schedule-center",
      icon: "flask",
      get title() {
        return ctx.t("title")
      },
      get entries() {
        return [
          {
            id: "schedule-center",
            title: ctx.t("title"),
            description: "查看、创建、暂停与删除实验性定时任务",
            keywords: "schedule cron timer task 定时 任务 cron 计划",
          },
        ]
      },
      render: () => <SchedulePage ctx={ctx} store={store} />,
    })

    ctx.add(TitlebarItem, (): TitlebarItem => ({
      id: "schedules",
      label: "定时任务",
      title: "打开定时任务",
      icon: "task",
      run: open,
    }))

    ctx.add(Command, (): Command => ({
      id: "open",
      title: ctx.t("title"),
      description: "查看与创建定时任务（实验性 schedules）",
      keywords: "schedule cron timer task 定时 任务 计划",
      group: "设置",
      section: "navigation",
      bind: "mod+alt+s",
      featured: true,
      run: open,
    }))
  },
})
