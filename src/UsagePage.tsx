import { useEffect, useState, useRef } from "react";
import {
  Activity,
  ArrowDownToLine,
  Coins,
  Flame,
  Info,
  Layers3,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {HistoryEditor, type History, tools as names} from "./UsageHistory";
import { useAccount } from "./Auth";
import { request } from "./api";
import { today } from "./workspace/shared";
import type { Overview } from "./types";
type Totals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  records: number;
  incomplete: number;
  cacheUnknown: number;
  sessions: number;
};
type Price = {
  id: string;
  provider: string;
  model: string;
  currency: string;
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWriteLong: number;
};
type Cost = {
  currency: string;
  amount: number;
  records: number;
  cacheUnknown?: number;
};
type Usage = {
  history?: History;
  lifetimeTools?: (Totals & {provider:string;model:string})[];
  summary: Totals;
  days: (Totals & { day: string })[];
  tools: (Totals & { provider: string; model: string })[];
  coverage: { totalSessions: number; measuredSessions: number };
  costs: Cost[];
  costDays: (Cost & { day: string })[];
  sourceCosts: Cost[];
  prices: Price[];
  options: { provider: string; model: string }[];
  profile: {
    total: number;
    measuredTotal?: number;
    historicalTotal?: number;
    peak: number;
    longest: number;
    current: number;
    activeDays: number;
  };
  heatmap: { day: number; total: number }[];
};
type UsageRecord = {
  id: string;
  taskId: string;
  title: string;
  project: string;
  provider: string;
  model: string;
  timestamp: number;
  input: number | null;
  output: number | null;
  total: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
  mode: string;
  requestId: string | null;
  sourceCost?: number;
  sourceCurrency?: string;
  evidence: { path?: string; line?: number; locator?: string };
  issue?: string;
};
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "未提供" : n.toLocaleString("zh-CN");
const short = (n: number) =>
  n >= 1e8
    ? (n / 1e8).toFixed(2) + " 亿"
    : n >= 1e6
      ? (n / 1e6).toFixed(2) + " M"
      : n >= 1e3
        ? (n / 1e3).toFixed(1) + " K"
        : String(n);
const dateTime = (n: number) =>
  new Date(n).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
const epoch = (d: string) => Date.parse(d + "T00:00:00+08:00");
const offsetDate = (n: number) =>
  new Date(epoch(today()) - n * 86400000 + 28800000).toISOString().slice(0, 10);
function fake(): Usage {
  const days = Array.from({ length: 30 }, (_, i) => {
    const input = ((i % 5) + 1) * 22000,
      output = ((i % 3) + 1) * 2500,
      cacheRead = Math.floor(input * 0.65);
    return {
      day: offsetDate(29 - i),
      input,
      output,
      cacheRead,
      cacheWrite: 0,
      total: input + output,
      records: (i % 5) + 2,
      incomplete: 0,
      cacheUnknown: 0,
      sessions: 2,
    };
  });
  const summary = days.reduce(
    (s, d) =>
      Object.fromEntries(
        Object.keys(s).map((k) => [
          k,
          s[k as keyof Totals] + d[k as keyof Totals],
        ]),
      ) as Totals,
    {
      input: 0,
      output: 0,
      total: 0,
      cacheRead: 0,
      cacheWrite: 0,
      records: 0,
      incomplete: 0,
      cacheUnknown: 0,
      sessions: 0,
    },
  );
  return {
    summary,
    days,
    tools: [{ ...summary, provider: "codex", model: "演示模型" }],
    coverage: { totalSessions: 6, measuredSessions: 4 },
    costs: [],
    costDays: [],
    sourceCosts: [],
    prices: [],
    options: [{ provider: "codex", model: "演示模型" }],
    profile: {
      total: summary.total,
      peak: 115000,
      longest: 30,
      current: 30,
      activeDays: 30,
    },
    heatmap: days.map((d) => ({
      day: Math.floor((epoch(d.day) + 28800000) / 86400000),
      total: d.total,
    })),
  };
}
export default function UsagePage({
  demo,
  overview,
  revision,
  openTask,
}: {
  demo: boolean;
  overview: Overview | null;
  revision: number;
  openTask: (id: string) => void;
}) {
  const { user } = useAccount(),
    [scope, setScope] = useState("lifetime"),
    [includeHistory, setIncludeHistory] = useState(true),
    [range, setRange] = useState("30"),
    [start, setStart] = useState(offsetDate(29)),
    [end, setEnd] = useState(today()),
    [provider, setProvider] = useState(""),
    [model, setModel] = useState(""),
    [project, setProject] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<Usage>(),
    [records, setRecords] = useState<{ total: number; records: UsageRecord[] }>(
      { total: 0, records: [] },
    ),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState<UsageRecord>(),
    [pricing, setPricing] = useState(false),
    [busy, setBusy] = useState(false),
    [price, setPrice] = useState({
      provider: "deepseek",
      model: "",
      currency: "CNY",
      date: today(),
      input: "",
      output: "",
      cacheRead: "",
      cacheWrite: "",
      cacheWriteLong: "",
    });
  const evidenceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement;
    const close =
      evidenceRef.current?.querySelector<HTMLButtonElement>("button");
    close?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelected(undefined);
      }
      if (e.key === "Tab") {
        e.preventDefault();
        close?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, [selected]);
  const params = new URLSearchParams({
    start: String(epoch(start)),
    end: String(epoch(end) + 86400000),
    provider,
    model,
    project,
    page: String(page),
  }).toString();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (demo) {
      setData(fake());
      setRecords({ total: 0, records: [] });
      setError("");
      return;
    }
    setLoading(true);
    void Promise.all([
      request<Usage>("/api/usage?" + params, { signal: controller.signal }),
      request<typeof records>("/api/usage/records?" + params, {
        signal: controller.signal,
      }),
    ])
      .then(([u, r]) => {
        setData(u);
        setRecords(r);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params, demo, revision, refresh]);
  function period(value: string) {
    setRange(value);
    if (value !== "custom") {
      setStart(offsetDate(Number(value) - 1));
      setEnd(today());
    }
    setPage(1);
  }
  async function savePrice(e: React.FormEvent) {
    e.preventDefault();
    if (demo) {
      setError("演示模式不保存真实价格");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request("/api/usage/prices", {
        method: "POST",
        body: JSON.stringify({
          ...price,
          ...Object.fromEntries(
            [
              "input",
              "output",
              "cacheRead",
              "cacheWrite",
              "cacheWriteLong",
            ].map((k) => [k, Number(price[k as keyof typeof price])]),
          ),
        }),
      });
      setRefresh((v) => v + 1);
      setPricing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const historical = data?.history;
  const combinedRows = (()=>{
    const list = (scope==='lifetime'?data?.lifetimeTools || data?.tools:data?.tools)||[];
    const result=list.map(t=>({...t,measured:t.total,historical:0}));
    for(const r of (scope==='lifetime'?historical?.allocations:historical?.periodAllocations)||[]){
      const t=result.find(x=>x.provider===r.provider&&x.model===r.model);
      if(t){t.historical+=r.total;t.total+=r.total;}
      else result.push({provider:r.provider,model:r.model,input:0,output:0,cacheRead:0,cacheWrite:0,total:r.total,records:0,incomplete:0,cacheUnknown:0,sessions:0,measured:0,historical:r.total});
    }
    return result.sort((a,b)=>b.total-a.total);
  })();
  const comparisonTotal=combinedRows.reduce((s,t)=>s+t.total,0);
  function exportSummary() {
    if (!data) return;
    const safe = (v: unknown) =>
      '"' +
      String(v ?? "")
        .replaceAll('"', '""')
        .replace(/^[=+@-]/, "'$&") +
      '"';
    const rows = [
      ["统计范围","数据性质","工具","模型","输入（含缓存）","缓存读取","缓存写入","输出","Token 总量","用量记录"],
      ...combinedRows.flatMap(t=>[
        ...(t.measured||t.records?[[scope,"日志实测",names[t.provider]||t.provider,t.model,t.input,t.cacheRead,t.cacheWrite,t.output,t.measured,t.records]]:[]),
        ...(t.historical?[[scope,"历史估算（生成工作日）",names[t.provider]||t.provider,t.model,"","","","",t.historical,""]]:[]),
      ]),
    ];
    const text = "\uFEFF" + rows.map((r) => r.map(safe).join(",")).join("\r\n");
    const url = URL.createObjectURL(
        new Blob([text], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `agentdock-usage-${scope}-${start}-${end}${demo ? "-demo" : ""}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const costByCurrency = (data?.costs || []).reduce(
    (s, c) => ({ ...s, [c.currency]: (s[c.currency] || 0) + c.amount }),
    {} as { [currency: string]: number },
  );
  const priced = (data?.costs || []).reduce((s, c) => s + c.records, 0);
  return (
    <div className="usage-page">
      <div className="section-heading">
        <div>
          <span className="auth-kicker">TOKEN OBSERVATORY</span>
          <h2>用量审计</h2>
        </div>
        <button
          className="outline-button"
          onClick={exportSummary}
          disabled={!data || loading}
        >
          <ArrowDownToLine size={15} />
          导出汇总 CSV
        </button>
      </div>
      <p className="muted usage-caption">
        跨工具用量，逐条有据。按 Asia/Shanghai
        自然日统计；日志实测与个人历史估算分别展示。
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <section className="usage-profile source-panel">
        <div className="usage-owner">
          <span className="usage-avatar">
            {(demo ? "D" : user?.displayName || "A").slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h3>
              {demo ? "演示工作空间" : user?.displayName || "个人工作空间"}
            </h3>
            <p>多智能体 · 本地可追溯 {demo && "· 合成演示数据"}</p>
          </div>
          <span className="usage-badge">
            <ShieldCheck size={15} />
            {historical?.total ? "实测 + 历史估算" : "已记录用量"}
          </span>
        </div>
        <div className="usage-profile-stats">
          {[
            ["累计 Token", short(data?.profile.total || 0)],
            ["实测单日峰值", short(data?.profile.peak || 0)],
            ["实测活跃天数", fmt(data?.profile.activeDays || 0)],
            ["实测最长连续", fmt(data?.profile.longest || 0) + " 天"],
            ["实测当前连续", fmt(data?.profile.current || 0) + " 天"],
          ].map(([label, value]) => (
            <div key={label}>
              <strong>{value}</strong>
              <small>{label}</small>
            </div>
          ))}
        </div>
        <p className="muted">
          累计为当前工具、模型与项目筛选下的全部历史，不受日期范围限制。日志实测 {short(data?.profile.measuredTotal ?? data?.profile.total ?? 0)} + 历史估算 {short(historical?.total || 0)}；峰值、活跃与连续天数仅依据真实日志。
        </p>
      </section>
      {!demo && <HistoryEditor history={historical} onSaved={()=>setRefresh(v=>v+1)}/> }
      <div className="usage-filters">
        <label>
          时间范围
          <select
            aria-label="用量时间范围"
            value={range}
            onChange={(e) => period(e.target.value)}
          >
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
            <option value="90">近 90 天</option>
            <option value="365">近一年</option>
            <option value="custom">自定义日期</option>
          </select>
        </label>
        {range === "custom" && (
          <>
            <label>
              开始
              <input
                aria-label="用量开始日期"
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              结束
              <input
                aria-label="用量结束日期"
                type="date"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          </>
        )}
        <label>
          工具
          <select
            aria-label="用量工具"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel("");
              setPage(1);
            }}
          >
            <option value="">全部工具</option>
            {Object.entries(names).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          模型
          <select
            aria-label="用量模型"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部模型</option>
            {[
              ...new Set(
                (data?.options || [])
                  .filter((x) => !provider || x.provider === provider)
                  .map((x) => x.model),
              ),
            ].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          项目
          <select
            aria-label="用量项目"
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部项目</option>
            {overview?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="text-button"
          onClick={() => {
            setProvider("");
            setProject("");
            setModel("");
            period("30");
          }}
        >
          清除筛选
        </button>
      </div>
      {loading && (
        <p className="muted" role="status">
          正在读取用量索引…
        </p>
      )}
      {data && (
        <>
          <div className="usage-metrics">
            {[
              [
                Layers3,
                "当前范围总 Token",
                short(data.summary.total + (historical?.periodTotal||0)),
                `实测 ${short(data.summary.total)} · 历史估算 ${short(historical?.periodTotal||0)}；实测输入 ${fmt(data.summary.input)} / 输出 ${fmt(data.summary.output)}`,
              ],
              [
                Activity,
                "用量记录",
                fmt(data.summary.records),
                `${data.summary.sessions} 个会话 / 助手请求；累计快照并非 API 请求次数`,
              ],
              [
                Coins,
                "自定义单价估算",
                Object.entries(costByCurrency)
                  .map(([c, v]) => `${v.toFixed(4)} ${c}`)
                  .join(" / ") || "未配置单价",
                `${priced} 条已计价 · ${Math.max(0, data.summary.records - priced)} 条未计价`,
              ],
            ].map(([Icon, label, value, caption]) => {
              const I = Icon as typeof Layers3;
              return (
                <article className="metric" key={String(label)}>
                  <div>
                    <span>{String(label)}</span>
                    <I size={19} />
                  </div>
                  <strong>{String(value)}</strong>
                  <p>{String(caption)}</p>
                </article>
              );
            })}
          </div>
          <section className="source-panel heatmap-panel">
            <div className="section-heading">
              <h3>
                <Flame size={18} /> Token 活动
              </h3>
              <label className="muted"><input type="checkbox" checked={includeHistory} onChange={e=>setIncludeHistory(e.target.checked)}/> 显示历史估算 · 过去 365 天</label>
            </div>
            <Heatmap days={data.heatmap} estimates={includeHistory ? historical?.days || [] : []} />
          </section>
          <div className="usage-charts">
            <section className="source-panel">
              <div className="section-heading">
                <h3>每日 Token 分布</h3>
                <span>
                  {start} — {end}
                </span>
              </div>
              <TokenChart
                days={Array.from(
                  {
                    length: Math.max(
                      0,
                      Math.min(
                        366,
                        Math.round((epoch(end) - epoch(start)) / 86400000) + 1,
                      ),
                    ),
                  },
                  (_, i) => {
                    const day = new Date(epoch(start) + i * 86400000 + 28800000)
                      .toISOString()
                      .slice(0, 10);
                    const estimated = historical?.days.find(d=>d.day===Math.floor((epoch(day)+28800000)/86400000))?.total||0;
                    return {...(
                      data.days.find((d) => d.day === day) || {
                        day,
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        total: 0,
                        records: 0,
                        incomplete: 0,
                        cacheUnknown: 0,
                        sessions: 0,
                      }
                    ),historical:estimated};
                  },
                )}
              />
              <div className="usage-legend">
                <span className="uncached">普通输入</span>
                <span className="cached">缓存读取</span>
                <span className="write">缓存写入</span>
                <span className="output">输出</span><span className="unknown">未拆分实测</span><span className="historical">历史估算（未拆分）</span>
              </div>
              <p className="muted">
                输入总数包含缓存；紫色部分为生成日期的历史估算，无输入输出拆分，不计入费用。
              </p>
            </section>
            <section className="source-panel">
              <div className="section-heading">
                <h3>估算费用与计价覆盖</h3>
                <button
                  className="text-button"
                  onClick={() => setPricing(!pricing)}
                >
                  <Plus size={14} />
                  配置单价
                </button>
              </div>
              {Object.entries(costByCurrency).map(([currency, value]) => (
                <div className="cost-line" key={currency}>
                  <span>{currency} · 自定义单价估算</span>
                  <strong>{value.toFixed(6)}</strong>
                </div>
              ))}
              {!priced && (
                <div className="usage-empty">
                  <Coins size={30} />
                  <p>尚未计价</p>
                  <small>
                    填写模型的单价及生效日期后，计算已知输入与输出的费用。
                  </small>
                </div>
              )}
              <CostChart days={data.costDays} start={start} end={end} />
              <div className="usage-coverage">
                <span
                  style={{
                    width: `${data.summary.records ? (priced / data.summary.records) * 100 : 0}%`,
                  }}
                />
              </div>
              <p className="muted">
                {priced} / {data.summary.records}{" "}
                条记录有适用价格。不同币种独立汇总，金额是估算，不代表订阅费用或实际账单。
              </p>
              {data.sourceCosts.map((c) => (
                <p className="source-cost" key={c.currency}>
                  来源 SDK 估算：{c.amount.toFixed(6)} {c.currency}（{c.records}{" "}
                  条；独立展示，不与自定义估算相加）
                </p>
              ))}
            </section>
          </div>
          <div className="explanation usage-disclosure">
            <Info size={17} />
            <p>
              当前范围内保留 {data.coverage.totalSessions} 个 IDE 会话，其中{" "}
              {data.coverage.measuredSessions} 个包含可解析用量。
              {data.summary.incomplete} 条用量缺少输入或输出；
              {data.summary.cacheUnknown}{" "}
              条未报告缓存读取。缺失值不按零用量推断。Codex
              累计值按增量去重；Claude/Pi 缓存输入合并；推理 token
              是输出的子集，不重复相加。Pi
              的所有已保留分支均计入实际发生的用量。
            </p>
          </div>
          <section className="source-panel usage-models">
            <div className="section-heading">
              <h3>工具与模型对比</h3>
              <select aria-label="模型对比范围" value={scope} onChange={e=>setScope(e.target.value)}><option value="lifetime">全部历史（与累计一致）</option><option value="period">当前日期范围</option></select>
            </div>
            <p className="muted">青绿：日志实测 · 紫色：个人历史估算；模型分配并非平台账单。对比合计 {short(comparisonTotal)}。</p>
            {combinedRows.map((t) => (
              <div className="usage-model-row" key={t.provider + t.model}>
                <div>
                  <strong>{names[t.provider] || t.provider}</strong>
                  <small>{t.model}</small>
                </div>
                <div className="model-bar">
                  <i
                    style={{
                      width: `${comparisonTotal ? (t.measured / comparisonTotal) * 100 : 0}%`,
                    }}
                  />
                  <i className="historical-bar" style={{width:`${comparisonTotal ? t.historical/comparisonTotal*100 : 0}%`}}/>
                </div>
                <div>
                  <strong>{short(t.total)}</strong>
                  <small>
                    实测 {short(t.measured)} / 历史估算 {short(t.historical)}
                    {t.measured>0 && <> · 输入 {short(t.input)} / 输出 {short(t.output)}</>}
                  </small>
                </div>
              </div>
            ))}
            {!combinedRows.length && (
              <p className="muted">
                没有可解析的用量记录。采集到明确 usage 字段后会出现在这里。
              </p>
            )}
          </section>
          {pricing && (
            <section className="source-panel price-editor">
              <div className="section-heading">
                <h3>每百万 Token 单价</h3>
                <button
                  className="icon-button"
                  aria-label="关闭单价配置"
                  onClick={() => setPricing(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <p className="muted">
                使用你的实际 API
                合同价格。未报告缓存读取的记录暂按普通输入计价；不自动套用订阅价格或汇率。新规则按生效日期覆盖同工具、同模型的旧规则。
                <a
                  href="https://api-docs.deepseek.com/quick_start/pricing/"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看 DeepSeek 官方价格 ↗
                </a>
              </p>
              <form onSubmit={(e) => void savePrice(e)}>
                <div className="form-grid">
                  <label className="field-label">
                    工具
                    <select
                      aria-label="单价工具"
                      value={price.provider}
                      onChange={(e) =>
                        setPrice({ ...price, provider: e.target.value })
                      }
                    >
                      {Object.entries(names).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    模型
                    <input
                      aria-label="单价模型"
                      list="usage-models"
                      required
                      value={price.model}
                      onChange={(e) =>
                        setPrice({ ...price, model: e.target.value })
                      }
                    />
                    <datalist id="usage-models">
                      {data.options.map((x) => (
                        <option key={x.provider + x.model}>{x.model}</option>
                      ))}
                    </datalist>
                  </label>
                  <label className="field-label">
                    币种
                    <select
                      aria-label="单价币种"
                      value={price.currency}
                      onChange={(e) =>
                        setPrice({ ...price, currency: e.target.value })
                      }
                    >
                      <option>CNY</option>
                      <option>USD</option>
                    </select>
                  </label>
                  <label className="field-label">
                    生效日期
                    <input
                      aria-label="单价生效日期"
                      type="date"
                      required
                      value={price.date}
                      onChange={(e) =>
                        setPrice({ ...price, date: e.target.value })
                      }
                    />
                  </label>
                  {(
                    [
                      "input",
                      "cacheRead",
                      "cacheWrite",
                      "cacheWriteLong",
                      "output",
                    ] as const
                  ).map((k) => (
                    <label className="field-label" key={k}>
                      {
                        {
                          input: "普通输入单价",
                          cacheRead: "缓存读取单价",
                          cacheWrite: "缓存写入 / 5 分钟单价",
                          cacheWriteLong: "1 小时缓存写入单价",
                          output: "输出单价",
                        }[k]
                      }
                      <input
                        aria-label={k + " 单价"}
                        type="number"
                        min={0}
                        step="any"
                        required
                        value={price[k]}
                        onChange={(e) =>
                          setPrice({ ...price, [k]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </div>
                <button className="primary-button" disabled={busy}>
                  保存单价规则
                </button>
              </form>
              <div>
                {data.prices.map((p) => (
                  <div className="price-rule" key={p.id}>
                    <span>
                      {names[p.provider]} / {p.model} · {p.date} · {p.currency}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`删除单价 ${p.model}`}
                      disabled={busy || demo}
                      onClick={async () => {
                        if (
                          !confirm(
                            "删除此规则后，历史估算将按剩余规则重新计算，是否继续？",
                          )
                        )
                          return;
                        try {
                          await request("/api/usage/prices/" + p.id, {
                            method: "DELETE",
                          });
                          setRefresh((v) => v + 1);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="source-panel usage-ledger">
            <div className="section-heading">
              <h3>
                <Search size={18} /> 用量明细与依据
              </h3>
              <span>{records.total} 条</span>
            </div>
            <div className="usage-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间 / 会话</th>
                    <th>工具 / 模型</th>
                    <th>输入</th>
                    <th>缓存读取</th>
                    <th>输出</th>
                    <th>总 Token</th>
                    <th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {records.records.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() =>
                            r.provider === "agentdock"
                              ? setSelected(r)
                              : openTask(r.taskId)
                          }
                        >
                          {r.title}
                        </button>
                        <small>{dateTime(r.timestamp)}</small>
                      </td>
                      <td>
                        {names[r.provider]}
                        <small>{r.model}</small>
                      </td>
                      <td>{fmt(r.input)}</td>
                      <td>{fmt(r.cacheRead)}</td>
                      <td>{fmt(r.output)}</td>
                      <td>{fmt(r.total)}</td>
                      <td>
                        <button
                          className="outline-button"
                          onClick={() => setSelected(r)}
                        >
                          查看
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!records.total && (
              <p className="muted">
                {demo
                  ? "演示图表使用合成数字，不对应真实证据。"
                  : "当前筛选下暂无用量明细。"}
              </p>
            )}
            <div className="pagination">
              <span>每页 30 条 · 相同请求 ID 去重</span>
              <div>
                <button
                  className="outline-button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <span>
                  {page} / {Math.max(1, Math.ceil(records.total / 30))}
                </span>
                <button
                  className="outline-button"
                  disabled={page * 30 >= records.total}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          </section>
        </>
      )}
      {selected && (
        <div className="detail-overlay">
          <button
            className="detail-backdrop"
            aria-label="关闭用量依据"
            onClick={() => setSelected(undefined)}
          />
          <aside
            ref={evidenceRef}
            className="detail usage-evidence"
            role="dialog"
            aria-modal="true"
            aria-label="用量依据"
          >
            <header className="detail-header">
              <strong>用量依据</strong>
              <button
                className="icon-button"
                aria-label="关闭用量详情"
                onClick={() => setSelected(undefined)}
              >
                <X />
              </button>
            </header>
            <div className="detail-body">
              <h2>{selected.title}</h2>
              <p className="muted">
                {names[selected.provider]} / {selected.model} ·{" "}
                {dateTime(selected.timestamp)}
              </p>
              <dl>
                {[
                  ["输入（含缓存）", fmt(selected.input)],
                  ["缓存读取", fmt(selected.cacheRead)],
                  ["缓存写入", fmt(selected.cacheWrite)],
                  ["输出（含推理）", fmt(selected.output)],
                  ["推理输出（不另加）", fmt(selected.reasoning)],
                  [
                    "统计口径",
                    selected.mode === "codex_cumulative"
                      ? "累计快照的正增量"
                      : "单条请求 / 响应用量",
                  ],
                  [
                    "请求标识",
                    selected.requestId || "来源未提供，不能等同 API 调用次数",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {selected.issue && <p className="warning">{selected.issue}</p>}
              <code className="evidence-path">
                {selected.evidence.path || "AgentDock 内置助手"}
                {selected.evidence.line ? ":" + selected.evidence.line : ""}
                {selected.evidence.locator
                  ? " · " + selected.evidence.locator
                  : ""}
              </code>
              <p className="muted">
                缺失字段显示“未提供”，不会从文本长度推算用量。费用须结合适用价格；此条记录不是平台账单。
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
function Heatmap({ days, estimates }: { days: { day: number; total: number }[]; estimates: {day:number;total:number}[] }) {
  const [activeDay,setActiveDay]=useState<number>();
  const now = Math.floor((Date.now() + 28800000) / 86400000),
    start = now - 364,
    startWeekday = new Date(start * 86400000).getUTCDay(),
    map = new Map(days.map((d) => [d.day, d.total])),
    estimated = new Map(estimates.map(d=>[d.day,d.total])),
    max = Math.max(1,...Array.from({length:365},(_,i)=>(map.get(start+i)||0)+(estimated.get(start+i)||0)));
  return (
    <>
      <div className="heatmap-scroll">
        <div className="heatmap-grid">
          {Array.from({ length: startWeekday }, (_, i) => (
            <span className="heatmap-pad" key={"pad" + i} />
          ))}
          {Array.from({ length: 365 }, (_, i) => {
            const day = start + i,
              measured = map.get(day)||0, historical = estimated.get(day)||0,
              n = measured + historical,
              level = n
                ? Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n / max) * 4)))
                : 0,
              date = new Date(day * 86400000).toISOString().slice(0, 10);
            return (
              <button
                className={`heatmap-cell level-${level} ${historical ? "estimated-day" : ""}`}
                key={day}
                onFocus={()=>setActiveDay(day)} onMouseEnter={()=>setActiveDay(day)}
                aria-label={`${date}：${fmt(n)} Token；实测 ${fmt(measured)}，历史估算 ${fmt(historical)}`}
                title={`${date} · 合计 ${fmt(n)}\n日志实测 ${fmt(measured)}\n历史估算 ${fmt(historical)}（生成工作日）`}
              />
            );
          })}
        </div>
        <div className="heatmap-months">
          {Array.from({ length: 12 }, (_, i) => {
            const d = new Date((now - 330 + i * 30) * 86400000);
            return <span key={i}>{d.getUTCMonth() + 1}月</span>;
          })}
        </div>
      </div>
      <p className="muted heatmap-readout" aria-live="polite">{activeDay!==undefined?`${new Date(activeDay*86400000).toISOString().slice(0,10)} · 日志实测 ${fmt(map.get(activeDay)||0)} · 历史估算 ${fmt(estimated.get(activeDay)||0)}（生成工作日）`:'悬停或聚焦日期，查看实测与历史估算。'}</p>
      <div className="heatmap-legend">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={`heatmap-cell level-${i}`} />
        ))}
        <span>多</span><i className="heatmap-cell level-3 estimated-day"/><span>紫色描边：含估算日期</span>
      </div>
    </>
  );
}
function TokenChart({ days }: { days: (Totals & { day: string; historical?:number })[] }) {
  const [active, setActive] = useState<string>(),
    max = Math.max(1, ...days.map((d) => d.total + (d.historical||0))),
    width = 600,
    height = 175,
    gap = days.length > 90 ? 0 : 2,
    barWidth = width / Math.max(1, days.length);
  const selected = days.find((d) => d.day === active);
  return (
    <>
      <div className="token-chart">
        <span className="chart-max">{short(max)}</span>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="每日实测输入、缓存、输出及未拆分历史估算 Token 图表"
        >
          <path
            d={`M0 ${height - 1}H${width}M0 ${height / 2}H${width}M0 1H${width}`}
            className="chart-grid"
          />
          {days.map((d, i) => {
            const values = [
              Math.max(0, d.input - d.cacheRead - d.cacheWrite),
              d.cacheRead,
              d.cacheWrite,
              d.output,
              Math.max(0,d.total-d.input-d.output),
              d.historical || 0,
            ];
            let y = height;
            return (
              <g
                key={d.day}
                tabIndex={0}
                role="button"
                aria-label={`${d.day}：输入 ${d.input}，缓存读取 ${d.cacheRead}，输出 ${d.output}，历史估算 ${d.historical||0}`}
                onFocus={() => setActive(d.day)}
                onBlur={() => setActive(undefined)}
                onMouseEnter={() => setActive(d.day)}
                onMouseLeave={() => setActive(undefined)}
              >
                {values.map((n, k) => {
                  const h = (n / max) * (height - 10);
                  y -= h;
                  return (
                    <rect
                      key={k}
                      x={i * barWidth + gap / 2}
                      y={y}
                      width={Math.max(0.1, barWidth - gap)}
                      height={h}
                      className={["uncached", "cached", "write", "output", "unknown", "historical"][k]}
                    />
                  );
                })}
                <title>{`${d.day}\n输入 ${fmt(d.input)}\n缓存读取 ${fmt(d.cacheRead)}\n缓存写入 ${fmt(d.cacheWrite)}\n输出 ${fmt(d.output)}`}</title>
              </g>
            );
          })}
        </svg>
        {selected && (
          <div className="chart-tooltip">
            <strong>
              {selected.day} · {fmt(selected.total)}
            </strong>
            <span>
              普通输入{" "}
              {fmt(
                Math.max(
                  0,
                  selected.input - selected.cacheRead - selected.cacheWrite,
                ),
              )}
            </span>
            <span>缓存读取 {fmt(selected.cacheRead)}</span>
            <span>缓存写入 {fmt(selected.cacheWrite)}</span>
            <span>输出 {fmt(selected.output)}</span><span>未拆分实测 {fmt(Math.max(0,selected.total-selected.input-selected.output))}</span><span>历史估算 {fmt(selected.historical||0)}（生成日期）</span>
          </div>
        )}
      </div>
      <div className="chart-labels">
        <span>{days[0]?.day || "暂无记录"}</span>
        <span>{days.at(-1)?.day}</span>
      </div>
    </>
  );
}

function CostChart({
  days,
  start,
  end,
}: {
  days: (Cost & { day: string })[];
  start: string;
  end: string;
}) {
  const currencies = [...new Set(days.map((d) => d.currency))],
    [selected, setCurrency] = useState("");
  const currency = currencies.includes(selected) ? selected : currencies[0];
  const totals = new Map<string, number>();
  for (const d of days.filter((d) => d.currency === currency))
    totals.set(d.day, (totals.get(d.day) || 0) + d.amount);
  const values = Array.from(
      {
        length: Math.max(
          0,
          Math.min(366, Math.round((epoch(end) - epoch(start)) / 86400000) + 1),
        ),
      },
      (_, i) => {
        const day = new Date(epoch(start) + i * 86400000 + 28800000)
          .toISOString()
          .slice(0, 10);
        return [day, totals.get(day) || 0] as [string, number];
      },
    ),
    max = Math.max(0.000001, ...values.map(([, v]) => v));
  if (!currencies.length || !values.length) return null;
  return (
    <div className="cost-chart">
      <label>
        每日估算
        <select
          aria-label="费用图币种"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {currencies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <svg viewBox="0 0 500 120" role="img" aria-label="每日估算费用图">
        <path d="M0 119H500M0 60H500" className="chart-grid" />
        {values.map(([day, n], i) => (
          <rect
            key={day}
            x={(i * 500) / values.length + 2}
            y={119 - (n / max) * 100}
            width={Math.max(1, 500 / values.length - 4)}
            height={(n / max) * 100}
            rx={3}
          >
            <title>
              {day + " · " + n.toFixed(6) + " " + currency + "（估算）"}
            </title>
          </rect>
        ))}
      </svg>
      <div className="chart-labels">
        <span>{values[0]?.[0]}</span>
        <span>{values.at(-1)?.[0]}</span>
      </div>
    </div>
  );
}
