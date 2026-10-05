import { useEffect, useRef, useState } from "react";
import { Command, Search, X, ArrowUpRight } from "lucide-react";
export function QuickActions({
  go,
  exportToday,
}: {
  go: (view: string) => void;
  exportToday: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [q, setQ] = useState("");
  function open() {
    setQ("");
    ref.current?.showModal();
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "p"
      ) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const actions = [
    ["工作台", "回到今日进展", "overview"],
    ["工作目标", "查看跨工具工作目标", "goals"],
    ["历史记录", "搜索全部保留会话", "history"],
    ["用量审计", "查看跨工具 Token 与估算费用", "usage"],
    ["报告中心", "生成日报或周报", "reports"],
    ["日历日程", "安排下一步与提醒", "calendar"],
    ["内置助手", "选取上下文进行分析", "assistant"],
    ["工具接入", "检查来源目录和覆盖", "sources"],
    ["账号中心", "个人资料、密码与登录会话", "account"],
    ["导出今日摘要", "保存当天事实为 Markdown", "export"],
  ];
  return (
    <>
      <button
        className="quick-trigger outline-button"
        aria-label="快捷操作"
        onClick={open}
      >
        <Command size={15} />
        <span>快捷操作</span>
        <kbd>⇧ P</kbd>
      </button>
      <dialog
        ref={ref}
        className="quick-dialog"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <header>
          <Search size={19} />
          <input
            autoFocus
            aria-label="搜索快捷操作"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="跳转页面或执行操作…"
          />
          <button
            className="icon-button"
            aria-label="关闭快捷操作"
            onClick={() => ref.current?.close()}
          >
            <X size={18} />
          </button>
        </header>
        <div>
          {actions
            .filter((a) => a.join("").includes(q))
            .map(([title, desc, id]) => (
              <button
                key={id}
                onClick={() => {
                  ref.current?.close();
                  if (id === "export") exportToday();
                  else go(id);
                }}
              >
                <div>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </div>
                <ArrowUpRight size={16} />
              </button>
            ))}
        </div>
        <footer>Ctrl / ⌘ + Shift + P 打开 · Esc 关闭</footer>
      </dialog>
    </>
  );
}
