import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../server/auth.mjs";
import {
  normalizeUsage,
  consumeUsage,
  validatePrice,
} from "../server/usage.mjs";
import { consumeCodex, consumeClaude, emptyTask } from "../server/parsers.mjs";
import { consumeExtra } from "../server/adapters.mjs";
const evidence = { path: "synthetic.jsonl", line: 3 },
  timestamp = Date.parse("2026-09-30T12:00:00Z");
test("账号密码异步 scrypt 加盐，不存明文，错误密码与损坏哈希不能登录", async () => {
  const password = "synthetic-unit-password";
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.ok(!a.includes(password));
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword("wrong-synthetic", a), false);
  assert.equal(await verifyPassword(password, "broken"), false);
});
test("用量归一化：缓存口径、推理子集、缺失字段与负数", () => {
  const open = normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_cache_hit_tokens: 70,
    completion_tokens_details: { reasoning_tokens: 5 },
  });
  assert.equal(open.total, 120);
  assert.equal(open.reasoning, 5);
  assert.equal(open.cacheRead, 70);
  const claude = normalizeUsage(
    {
      input_tokens: 10,
      cache_read_input_tokens: 70,
      cache_creation_input_tokens: 20,
      output_tokens: 5,
    },
    { exclusiveCache: true },
  );
  assert.equal(claude.input, 100);
  assert.equal(claude.total, 105);
  assert.equal(normalizeUsage({ output_tokens: 2 }).input, null);
  assert.equal(
    normalizeUsage({ input_tokens: -1, output_tokens: 2 }).input,
    null,
  );
  assert.equal(
    normalizeUsage({
      input_tokens: 4,
      cached_input_tokens: 9,
      output_tokens: 1,
    }).cacheRead,
    null,
  );
  assert.equal(normalizeUsage({}), null);
});
test("Codex：累计快照取正增量，限流重复、双记录与高水位回退不重复相加", () => {
  const task = emptyTask("codex", "synthetic-codex", "synthetic.jsonl");
  consumeCodex(
    task,
    { type: "turn_context", payload: { model: "synthetic-model" }, timestamp },
    evidence,
  );
  const emit = (input, output, cache = 0) =>
    consumeCodex(
      task,
      {
        type: "event_msg",
        timestamp,
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: cache,
              output_tokens: output,
              total_tokens: input + output,
            },
          },
        },
      },
      evidence,
    );
  emit(100, 10, 60);
  emit(100, 10, 60);
  emit(90, 8, 50);
  emit(140, 20, 80);
  assert.equal(task._newUsage.length, 2);
  assert.deepEqual(
    task._newUsage.map((u) => [u.input, u.output, u.cacheRead]),
    [
      [100, 10, 60],
      [40, 10, 20],
    ],
  );
  assert.equal(task._codexHasTotals, true);
  consumeCodex(
    task,
    {
      type: "token_usage_record",
      timestamp,
      payload: {
        response_id: "synthetic-response",
        usage: { input_tokens: 40, output_tokens: 10 },
      },
    },
    evidence,
  );
  assert.equal(task._newUsage.at(-1).mode, "codex_direct");
  assert.equal(
    task._newUsage
      .filter((u) => u.mode === "codex_cumulative")
      .reduce((s, u) => s + u.total, 0),
    160,
  );
});
test("Claude 分段响应使用相同请求键，Pi 分支消息独立、Harness 保留压缩证据", () => {
  const claude = emptyTask("claude", "synthetic-claude", "synthetic.jsonl");
  for (const output of [0, 7])
    consumeClaude(
      claude,
      {
        type: "assistant",
        sessionId: "synthetic-claude",
        timestamp,
        message: {
          id: "same-response",
          model: "synthetic",
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 5,
            output_tokens: output,
          },
          content: [],
        },
      },
      evidence,
    );
  assert.equal(claude._newUsage[0].id, claude._newUsage[1].id);
  assert.equal(claude._newUsage[1].input, 35);
  const pi = emptyTask("pi", "synthetic-pi", "synthetic.jsonl");
  for (const id of ["branch-a", "branch-b"])
    consumeExtra(
      pi,
      {
        id,
        type: "message",
        timestamp,
        message: {
          role: "assistant",
          model: "synthetic",
          usage: {
            input: 10,
            cacheRead: 20,
            cacheWrite: 5,
            output: 3,
            cost: { total: 0.1 },
          },
          content: [],
        },
      },
      evidence,
    );
  assert.equal(pi._newUsage.length, 2);
  assert.equal(pi._newUsage[0].total, 38);
  assert.equal(pi._newUsage[0].sourceCost, 0.1);
  const deep = emptyTask("deepseek", "synthetic-deep", "synthetic.zstd");
  consumeExtra(
    deep,
    {
      type: "assistant/message",
      timestamp,
      seq: 3,
      data: {
        turn: 1,
        step: 1,
        model: "synthetic",
        usage: {
          inputTokens: 50,
          cacheReadTokens: 20,
          outputTokens: 10,
          reasoningTokens: 3,
        },
        message: { content: [] },
      },
    },
    { ...evidence, locator: "frame=12" },
  );
  assert.equal(deep._newUsage[0].total, 60);
  assert.match(deep._newUsage[0].evidence.locator, /frame=12;seq=3/);
});
test("历史单价配置验证明确单位、币种和生效时间，不接受负数", () => {
  const price = {
    provider: "pi",
    model: "synthetic",
    currency: "USD",
    date: "2026-09-30",
    input: 1,
    output: 2,
    cacheRead: 0.1,
    cacheWrite: 1.25,
    cacheWriteLong: 2,
  };
  assert.equal(
    validatePrice(price).effectiveAt,
    Date.parse("2026-09-30T00:00:00+08:00"),
  );
  assert.throws(() => validatePrice({ ...price, input: -1 }));
  assert.throws(() => validatePrice({ ...price, currency: "mixed" }));
});
