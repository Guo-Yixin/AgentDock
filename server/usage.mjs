import {referenceBudgets} from './price-catalogue.mjs';
import {compactTitle} from './presentation.mjs';
import {historyOverview} from './usage-history.mjs';
import { createHash, randomUUID } from "node:crypto";
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const number = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const first = (...values) => values.find((v) => number(v) !== null) ?? null;
const counters = (raw) =>
  [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ].map((k) => [k, raw[k] ?? null]);
export const usageDDL = [
  "CREATE TABLE IF NOT EXISTS ad_usage(id CHAR(64) PRIMARY KEY,task_id VARCHAR(128) NOT NULL,provider VARCHAR(32) NOT NULL,model VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,recorded_at BIGINT NOT NULL,input_tokens BIGINT NULL,cache_read_tokens BIGINT NULL,cache_write_tokens BIGINT NULL,output_tokens BIGINT NULL,total_tokens BIGINT NULL,record JSON NOT NULL,KEY usage_period(recorded_at,provider),KEY usage_task(task_id),KEY usage_model(model,recorded_at))",
];
export function normalizeUsage(raw, { exclusiveCache = false } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const base = first(
      raw.input_tokens,
      raw.prompt_tokens,
      raw.input,
      raw.inputTokens,
    ),
    output = first(
      raw.output_tokens,
      raw.completion_tokens,
      raw.output,
      raw.outputTokens,
    );
  const read = first(
    raw.cached_input_tokens,
    raw.cache_read_input_tokens,
    raw.prompt_cache_hit_tokens,
    raw.cacheRead,
    raw.cacheReadTokens,
    raw.input_tokens_details?.cached_tokens,
    raw.prompt_tokens_details?.cached_tokens,
  );
  const write = first(
    raw.cache_creation_input_tokens,
    raw.cache_write_input_tokens,
    raw.cacheWrite,
    raw.cacheWriteTokens,
  );
  const input =
    base === null
      ? null
      : base + (exclusiveCache ? (read || 0) + (write || 0) : 0);
  if (
    input === null &&
    output === null &&
    first(raw.total_tokens, raw.totalTokens) === null
  )
    return null;
  const total =
    input !== null && output !== null
      ? input + output
      : first(raw.total_tokens, raw.totalTokens);
  const issue = (read || 0) + (write || 0) > (input ?? Infinity);
  return {
    input,
    output,
    total,
    cacheRead: issue ? null : read,
    cacheWrite: issue ? null : write,
    reasoning: first(
      raw.reasoning_output_tokens,
      raw.reasoning_tokens,
      raw.reasoning,
      raw.reasoningTokens,
      raw.output_tokens_details?.reasoning_tokens,
      raw.completion_tokens_details?.reasoning_tokens,
    ),
    cacheWriteLong: Math.min(
      write || 0,
      first(raw.cache_creation?.ephemeral_1h_input_tokens) || 0,
    ),
    issue: issue ? "缓存用量大于输入，缓存拆分未计入" : null,
  };
}
function add(task, raw, timestamp, evidence, key, model, mode, extra = {}) {
  const value = normalizeUsage(raw, {
    exclusiveCache: task.provider === "claude" || task.provider === "pi",
  });
  if (!value || !timestamp) return;
  const entry = {
    ...value,
    ...extra,
    id: hash([task.provider, task.nativeId, key]),
    timestamp,
    evidence,
    model: String(model || task._usageModel || "未知模型").slice(0, 128),
    mode,
  };
  (task._newUsage ||= []).push(entry);
}
export function consumeUsage(task, row, evidence, timestamp) {
  const p = row.payload || {},
    data = row.data || {},
    m = row.message || data.message || {};
  if (row.type === "turn_context" && p.model) task._usageModel = p.model;
  if (row.type === "model_change" || row.type === "model-change")
    task._usageModel =
      row.model || row.modelId || data.model || task._usageModel;
  if (task.provider === "codex") {
    if (row.type === "token_usage_record" && p.usage) {
      const direct = p.response_id || [row.timestamp, row.ordinal];
      add(
        task,
        p.usage,
        timestamp,
        evidence,
        ["direct", direct],
        p.model,
        "codex_direct",
        { requestId: p.response_id || null },
      );
    }
    if (
      row.type === "event_msg" &&
      p.type === "token_count" &&
      p.info?.total_token_usage
    ) {
      task._codexHasTotals = true;
      const initialSnapshot = !task._usageTotals;
      const current = p.info.total_token_usage,
        old = task._usageTotals || {},
        delta = {};
      for (const field of [
        "input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "total_tokens",
      ]) {
        const n = number(current[field]);
        delta[field] = n === null ? null : Math.max(0, n - (old[field] || 0));
        if (n !== null) old[field] = Math.max(old[field] || 0, n);
      }
      task._usageTotals = old;
      if (
        (delta.input_tokens || 0) + (delta.output_tokens || 0) > 0 ||
        delta.total_tokens > 0
      )
        add(
          task,
          delta,
          timestamp,
          evidence,
          ["cumulative", counters(current)],
          task._usageModel,
          "codex_cumulative",
          { requestId: null, cumulative: current, initialSnapshot },
        );
    }
    return;
  }
  if (task.provider === "claude" && row.type === "assistant" && m.usage)
    add(
      task,
      m.usage,
      timestamp,
      evidence,
      ["request", m.id || row.requestId || row.uuid || row.timestamp],
      m.model,
      "request",
      { requestId: m.id || row.requestId || null },
    );
  if (
    task.provider === "pi" &&
    row.type === "message" &&
    m.role === "assistant" &&
    m.usage
  ) {
    const cost = m.usage.cost?.total;
    add(
      task,
      m.usage,
      timestamp,
      evidence,
      ["request", row.id || m.id || row.timestamp],
      m.model,
      "request",
      {
        requestId: row.id || null,
        apiProvider: m.provider || null,
        sourceCost:
          typeof cost === "number" && Number.isFinite(cost) && cost >= 0
            ? cost
            : null,
        sourceCurrency: "USD",
        sourceCostKind: "SDK 估算",
      },
    );
  }
  if (
    task.provider === "deepseek" &&
    row.type === "assistant/message" &&
    (data.usage || m.usage)
  )
    add(
      task,
      data.usage || m.usage,
      timestamp,
      {
        ...evidence,
        locator: `${evidence.locator || ""};seq=${row.seq ?? row.seq0 ?? "?"}`,
      },
      [
        "request",
        data.requestId ||
          m.id || [data.turn, data.step, row.seq ?? row.seq0 ?? row.timestamp],
      ],
      m.model || data.model || data.modelId,
      "request",
      { requestId: data.requestId || null },
    );
  if (task.provider === "workbuddy" && (m.usage || row.usage))
    add(
      task,
      m.usage || row.usage,
      timestamp,
      evidence,
      [
        "request",
        row.providerData?.messageId ||
          row.providerData?.requestId ||
          row.providerData?.responseId ||
          row.id ||
          row.timestamp,
      ],
      m.model ||
        row.model ||
        row.providerData?.requestModelName ||
        row.providerData?.model,
      "request",
      {
        requestId:
          row.providerData?.messageId ||
          row.providerData?.requestId ||
          row.providerData?.responseId ||
          row.id ||
          null,
      },
    );
  if (task.provider === "cursor" && (row.usage || row.tokenUsage || m.usage))
    add(
      task,
      row.usage || row.tokenUsage || m.usage,
      timestamp,
      evidence,
      ["request", row.requestId || row.bubbleId || row.id || row.timestamp],
      row.model || row.modelInfo?.modelName || m.model,
      "request",
      { requestId: row.requestId || row.bubbleId || row.id || null },
    );
}
export async function saveUsage(store, task) {
  if (task._codexHasTotals)
    await store.rows(
      "DELETE FROM ad_usage WHERE task_id=? AND JSON_UNQUOTE(JSON_EXTRACT(record,'$.mode'))='codex_direct'",
      [task.id],
    );
  const entries = (task._newUsage || []).filter(
    (u) => !task._codexHasTotals || u.mode !== "codex_direct",
  );
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    await store.rows(
      "INSERT INTO ad_usage VALUES " +
        batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(",") +
        " ON DUPLICATE KEY UPDATE input_tokens=IF(input_tokens IS NULL,VALUES(input_tokens),GREATEST(input_tokens,COALESCE(VALUES(input_tokens),0))),cache_read_tokens=IF(cache_read_tokens IS NULL,VALUES(cache_read_tokens),GREATEST(cache_read_tokens,COALESCE(VALUES(cache_read_tokens),0))),cache_write_tokens=IF(cache_write_tokens IS NULL,VALUES(cache_write_tokens),GREATEST(cache_write_tokens,COALESCE(VALUES(cache_write_tokens),0))),output_tokens=IF(output_tokens IS NULL,VALUES(output_tokens),GREATEST(output_tokens,COALESCE(VALUES(output_tokens),0))),total_tokens=IF(input_tokens IS NOT NULL AND output_tokens IS NOT NULL,input_tokens+output_tokens,GREATEST(COALESCE(total_tokens,0),COALESCE(VALUES(total_tokens),0))),record=VALUES(record),model=IF(VALUES(model)='未知模型',model,VALUES(model))",
      batch.flatMap((u) => [
        u.id,
        task.id,
        task.provider,
        u.model,
        task.projectId || "unassigned",
        u.timestamp,
        u.input,
        u.cacheRead,
        u.cacheWrite,
        u.output,
        u.total,
        JSON.stringify(u),
      ]),
    );
  }
  if (
    task._codexHasTotals &&
    entries.some((u) => u.mode === "codex_cumulative")
  ) {
    // Different copies of one session may start at different cumulative baselines.
    // Merge the snapshots first, then derive deltas over the complete retained set.
    let rows = await store.rows(
      "SELECT id,record,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens FROM ad_usage WHERE task_id=? AND JSON_UNQUOTE(JSON_EXTRACT(record,'$.mode'))='codex_cumulative'",
      [task.id],
    );
    const ids = new Set(rows.map((r) => r.id));
    let canonicalized = false;
    if (task.nativeId)
      for (const r of rows) {
        const value =
          typeof r.record === "string" ? JSON.parse(r.record) : r.record;
        if (!value.cumulative) continue;
        const id = hash([
          task.provider,
          task.nativeId,
          ["cumulative", counters(value.cumulative)],
        ]);
        if (id === r.id) continue;
        if (ids.has(id))
          await store.rows("DELETE FROM ad_usage WHERE id=?", [r.id]);
        else {
          await store.rows("UPDATE ad_usage SET id=? WHERE id=?", [id, r.id]);
          ids.add(id);
        }
        canonicalized = true;
      }
    if (canonicalized)
      rows = await store.rows(
        "SELECT id,record,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens FROM ad_usage WHERE task_id=? AND JSON_UNQUOTE(JSON_EXTRACT(record,'$.mode'))='codex_cumulative'",
        [task.id],
      );
    const snapshots = rows
      .map((r) => ({
        ...r,
        value: typeof r.record === "string" ? JSON.parse(r.record) : r.record,
      }))
      .sort(
        (a, b) =>
          a.value.timestamp - b.value.timestamp ||
          (a.value.cumulative?.total_tokens || 0) -
            (b.value.cumulative?.total_tokens || 0) ||
          a.id.localeCompare(b.id),
      );
    const high = {};
    const changes = [];
    for (const r of snapshots) {
      const raw = r.value.cumulative || {},
        delta = {};
      for (const field of [
        "input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "total_tokens",
      ]) {
        const n = number(raw[field]);
        delta[field] = n === null ? null : Math.max(0, n - (high[field] || 0));
        if (n !== null) high[field] = Math.max(high[field] || 0, n);
      }
      const u = normalizeUsage(delta);
      if (!u) continue;
      if (
        [
          ["input_tokens", "input"],
          ["output_tokens", "output"],
          ["cache_read_tokens", "cacheRead"],
          ["cache_write_tokens", "cacheWrite"],
          ["total_tokens", "total"],
        ].some(
          ([column, key]) =>
            (r[column] === null ? null : Number(r[column])) !== u[key],
        )
      )
        changes.push({ id: r.id, ...u });
    }
    for (let i = 0; i < changes.length; i += 100) {
      const batch = changes.slice(i, i + 100);
      const fields = [
        ["input_tokens", "input"],
        ["output_tokens", "output"],
        ["cache_read_tokens", "cacheRead"],
        ["cache_write_tokens", "cacheWrite"],
        ["total_tokens", "total"],
      ];
      const params = [];
      const assignments = fields.map(([column, key]) => {
        for (const u of batch) params.push(u.id, u[key]);
        return `${column}=CASE id ${batch.map(() => "WHEN ? THEN ?").join(" ")} ELSE ${column} END`;
      });
      params.push(...batch.map((u) => u.id));
      await store.rows(
        `UPDATE ad_usage SET ${assignments.join(",")} WHERE id IN (${batch.map(() => "?").join(",")})`,
        params,
      );
    }
  }
}
export async function saveAssistantUsage(
  store,
  { id, model, usage, timestamp },
) {
  const value = normalizeUsage(usage);
  if (!value) return;
  await saveUsage(store, {
    id: `assistant-${id}`,
    provider: "agentdock",
    projectId: "unassigned",
    _newUsage: [
      {
        ...value,
        id: hash(["agentdock", id]),
        model,
        timestamp,
        mode: "request",
        requestId: id,
        evidence: { locator: `AgentDock 助手回答 ${id}` },
      },
    ],
  });
}
export function validatePrice(input) {
  if (
    ![
      "codex",
      "claude",
      "cursor",
      "pi",
      "deepseek",
      "workbuddy",
      "agentdock",
    ].includes(input.provider) ||
    !input.model?.trim() ||
    input.model.length > 128 ||
    !["USD", "CNY"].includes(input.currency)
  )
    throw new Error("请选择工具、模型与币种");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(Date.parse(input.date + "T00:00:00+08:00")) ||
    new Date(Date.parse(input.date + "T00:00:00+08:00") + 28800000)
      .toISOString()
      .slice(0, 10) !== input.date
  )
    throw new Error("单价生效日期无效");
  for (const key of [
    "input",
    "cacheRead",
    "cacheWrite",
    "cacheWriteLong",
    "output",
  ])
    if (
      typeof input[key] !== "number" ||
      !Number.isFinite(input[key]) ||
      input[key] < 0 ||
      input[key] > 100000
    )
      throw new Error("单价须为有效非负数（每百万 token）");
  return {
    id: randomUUID(),
    title: `${input.provider} / ${input.model}`,
    provider: input.provider,
    model: input.model.trim(),
    currency: input.currency,
    date: input.date,
    effectiveAt: Date.parse(input.date + "T00:00:00+08:00"),
    input: input.input,
    cacheRead: input.cacheRead,
    cacheWrite: input.cacheWrite,
    cacheWriteLong: input.cacheWriteLong,
    output: input.output,
  };
}
const aggregate =
  "COUNT(*) records,COALESCE(SUM(input_tokens),0) input,COALESCE(SUM(cache_read_tokens),0) cacheRead,COALESCE(SUM(cache_write_tokens),0) cacheWrite,COALESCE(SUM(output_tokens),0) output,COALESCE(SUM(total_tokens),0) total,SUM(input_tokens IS NULL OR output_tokens IS NULL) incomplete,SUM(cache_read_tokens IS NULL) cacheUnknown,COUNT(DISTINCT task_id) sessions";
function filters(
  { start, end, provider = "", model = "", project = "" },
  alias = "",
) {
  const prefix = alias ? alias + "." : "";
  const clauses = [`${prefix}recorded_at>=?`, `${prefix}recorded_at<?`],
    params = [start, end];
  for (const [field, v] of [
    ["provider", provider],
    ["model", model],
    ["project_id", project],
  ])
    if (v) {
      clauses.push(`${prefix}${field}=?`);
      params.push(v);
    }
  return { sql: clauses.join(" AND "), params };
}
const numeric = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      [
        "day",
        "provider",
        "model",
        "project",
        "currency",
        "name",
        "id",
        "title",
      ].includes(k)
        ? v
        : v === null
          ? null
          : Number(v),
    ]),
  );
export async function usageOverview(store, args = {}) {
  args={start:0,end:Date.now()+86400000,...args};
  const f = filters(args),
    [summary] = await store.rows(
      `SELECT ${aggregate} FROM ad_usage WHERE ${f.sql}`,
      f.params,
    );
  const days = await store.rows(
    `SELECT DATE_FORMAT(DATE_ADD('1970-01-01',INTERVAL FLOOR((recorded_at+28800000)/86400000) DAY),'%Y-%m-%d') day,${aggregate} FROM ad_usage WHERE ${f.sql} GROUP BY day ORDER BY day`,
    f.params,
  );
  const tools = await store.rows(
    `SELECT provider,model,${aggregate} FROM ad_usage WHERE ${f.sql} GROUP BY provider,model ORDER BY total DESC`,
    f.params,
  );
  const [coverage] = await store.rows(
    `SELECT COUNT(DISTINCT t.id) totalSessions,COUNT(DISTINCT u.task_id) measuredSessions FROM ad_tasks t LEFT JOIN ad_usage u ON u.task_id=t.id WHERE t.updated_at>=? AND t.created_at<?${args.provider ? " AND t.provider=?" : ""}${args.project ? " AND t.project_id=?" : ""}`,
    [
      args.start,
      args.end,
      ...(args.provider ? [args.provider] : []),
      ...(args.project ? [args.project] : []),
    ],
  );
  const prices = (await store.documents("price")).sort(
    (a, b) => b.effectiveAt - a.effectiveAt || b.updatedAt - a.updatedAt,
  );
  const costs = [],
    costDays = [];
  // Every record is priced by its latest applicable tariff. Mixed currencies stay separate.
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i],
      newer = prices
        .slice(0, i)
        .filter((x) => x.provider === p.provider && x.model === p.model);
    const rateFilters = newer.map(() => "NOT (recorded_at>=?)").join(" AND ");
    const sql = `${f.sql} AND provider=? AND model=? AND recorded_at>=? ${rateFilters ? "AND " + rateFilters : ""} AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL`;
    const rows = await store.rows(
      `SELECT DATE_FORMAT(DATE_ADD('1970-01-01',INTERVAL FLOOR((recorded_at+28800000)/86400000) DAY),'%Y-%m-%d') day,COUNT(*) records,COALESCE(SUM((input_tokens-COALESCE(cache_read_tokens,0)-COALESCE(cache_write_tokens,0))*?+COALESCE(cache_read_tokens,0)*?+(COALESCE(cache_write_tokens,0)-COALESCE(JSON_EXTRACT(record,'$.cacheWriteLong'),0))*?+COALESCE(JSON_EXTRACT(record,'$.cacheWriteLong'),0)*?+output_tokens*?)/1000000,0) amount,SUM(cache_read_tokens IS NULL) cacheUnknown FROM ad_usage WHERE ${sql} GROUP BY day ORDER BY day`,
      [
        p.input,
        p.cacheRead,
        p.cacheWrite,
        p.cacheWriteLong,
        p.output,
        ...f.params,
        p.provider,
        p.model,
        p.effectiveAt,
        ...newer.map((x) => x.effectiveAt),
      ],
    );
    if (rows.length) {
      costs.push({
        amount: rows.reduce((s, r) => s + Number(r.amount), 0),
        records: rows.reduce((s, r) => s + Number(r.records), 0),
        cacheUnknown: rows.reduce((s, r) => s + Number(r.cacheUnknown), 0),
        currency: p.currency,
        kind: "自定义单价估算",
        priceId: p.id,
      });
      costDays.push(
        ...rows.map((r) => ({ ...numeric(r), currency: p.currency })),
      );
    }
  }
  const source = await store.rows(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(record,'$.sourceCurrency')) currency,COUNT(*) records,SUM(JSON_EXTRACT(record,'$.sourceCost')) amount FROM ad_usage WHERE ${f.sql} AND JSON_TYPE(JSON_EXTRACT(record,'$.sourceCost')) IN ('INTEGER','DOUBLE','DECIMAL') GROUP BY currency`,
    f.params,
  );
  let options = await store.rows(
    "SELECT DISTINCT provider,model FROM ad_usage ORDER BY provider,model",
  );
  const global = filters({ ...args, start: 0, end: Date.now() + 86400000 });
  const activity = await store.rows(
    `SELECT FLOOR((recorded_at+28800000)/86400000) day,COALESCE(SUM(total_tokens),0) total FROM ad_usage WHERE ${global.sql} AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record,'$.mode')),'')<>'manual' GROUP BY day ORDER BY day`,
    global.params,
  );
  let longest = 0,
    run = 0,
    previous = -2;
  for (const d of activity.filter((d) => Number(d.total) > 0)) {
    const day = Number(d.day);
    run = day === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  const today = Math.floor((Date.now() + 28800000) / 86400000),
    active = new Set(
      activity.filter((d) => Number(d.total) > 0).map((d) => Number(d.day)),
    );
  let current = 0,
    day = active.has(today) ? today : today - 1;
  while (active.has(day--)) current++;
  const history = await historyOverview(store,args);
  const lifetimeTools = await store.rows(`SELECT provider,model,${aggregate} FROM ad_usage WHERE ${global.sql} GROUP BY provider,model ORDER BY total DESC`,global.params);
  for(const r of history.config?.enabled?history.config.allocations:[])if(!options.some(o=>o.provider===r.provider&&o.model===r.model))options.push({provider:r.provider,model:r.model});
  const manualHeatmap=(await store.rows(`SELECT FLOOR((recorded_at+28800000)/86400000) day,SUM(total_tokens) total FROM ad_usage WHERE ${global.sql} AND JSON_UNQUOTE(JSON_EXTRACT(record,'$.mode'))='manual' GROUP BY day`,global.params)).map(numeric);
  const profile = {
    total: lifetimeTools.reduce((s,d)=>s+Number(d.total),0)+history.total,
    measuredTotal:lifetimeTools.reduce((s,d)=>s+Number(d.total),0),
    historicalTotal:history.total,
    peak: Math.max(0, ...activity.map((d) => Number(d.total))),
    longest,
    current,
    activeDays: active.size,
  };
  return {
    summary: numeric(summary),
    days: days.map(numeric),
    tools: tools.map(numeric),referenceBudgets:referenceBudgets(tools.map(numeric)),
    coverage: numeric(coverage),
    costs,
    costDays,
    sourceCosts: source.map(numeric),
    prices,
    options,
    profile,
    history,manualHeatmap,
    lifetimeTools:lifetimeTools.map(numeric),
    heatmap: activity
      .filter((d) => Number(d.day) >= today - 364)
      .map((d) => ({ day: Number(d.day), total: Number(d.total) })),
  };
}
export async function usageRecords(store, args) {
  const f = filters(args, "u"),
    page = Math.max(1, Math.floor(Number(args.page) || 1)), size = Math.min(30,Math.max(1,Math.floor(Number(args.pageSize)||30)));
  const [count] = await store.rows(
    `SELECT COUNT(*) total FROM ad_usage u WHERE ${f.sql}`,
    f.params,
  );
  const rows = await store.rows(
    `SELECT u.*,JSON_UNQUOTE(JSON_EXTRACT(t.record,'$.title')) task_title,JSON_UNQUOTE(JSON_EXTRACT(t.record,'$.projectName')) task_project FROM ad_usage u LEFT JOIN ad_tasks t ON t.id=u.task_id WHERE ${f.sql} ORDER BY u.recorded_at DESC,u.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    f.params,
  );
  return {
    total: Number(count.total),
    page,
    records: rows.map((r) => {
      const record =
          typeof r.record === "string" ? JSON.parse(r.record) : r.record,
        task =
          {title:r.task_title,projectName:r.task_project};
      return {
        ...record,
        id: r.id,
        taskId: r.task_id,
        provider: r.provider,
        model: r.model,
        title: compactTitle(task?.title||(record.mode==='manual'?'手动补录':"AgentDock 助手分析"),'',task?.projectName),
        project: task?.projectName || "未归属项目",
        timestamp: Number(r.recorded_at),
        input: r.input_tokens === null ? null : Number(r.input_tokens),
        output: r.output_tokens === null ? null : Number(r.output_tokens),
        total: r.total_tokens === null ? null : Number(r.total_tokens),
        cacheRead:
          r.cache_read_tokens === null ? null : Number(r.cache_read_tokens),
        cacheWrite:
          r.cache_write_tokens === null ? null : Number(r.cache_write_tokens),
      };
    }),
  };
}
