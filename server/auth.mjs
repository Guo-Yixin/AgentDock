import { scrypt, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt),
  options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
export const authDDL = [
  "CREATE TABLE IF NOT EXISTS ad_users(id VARCHAR(32) PRIMARY KEY,username VARCHAR(64) COLLATE utf8mb4_bin NOT NULL UNIQUE,display_name VARCHAR(100) NOT NULL,password_hash VARCHAR(256) NOT NULL,created_at BIGINT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ad_sessions(token_hash CHAR(64) PRIMARY KEY,user_id VARCHAR(32) NOT NULL,label VARCHAR(32) NOT NULL,created_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,KEY session_user(user_id,expires_at))",
];
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64, options);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}
export async function verifyPassword(password, value) {
  const [algorithm, salt, hex] = String(value).split("$");
  if (
    algorithm !== "scrypt" ||
    !/^\w{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(hex)
  )
    return false;
  const hash = await derive(password, salt, 64, options);
  return timingSafeEqual(hash, Buffer.from(hex, "hex"));
}
function validate(input) {
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(input.username))
    throw new Error("账号须为 3–64 位字母、数字、点、下划线或短横线");
  if (
    typeof input.password !== "string" ||
    input.password.length < 6 ||
    input.password.length > 128
  )
    throw new Error("密码须为 6–128 个字符");
}
const publicUser = (u) =>
  u
    ? {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        createdAt: Number(u.created_at),
      }
    : null;
export async function authStatus(store, token = "") {
  if (!store) return { available: false, initialized: false, user: null };
  const [owner] = await store.rows("SELECT id FROM ad_users LIMIT 1");
  const [user] = token
    ? await store.rows(
        "SELECT u.* FROM ad_sessions s JOIN ad_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
        [tokenHash(token), Date.now()],
      )
    : [];
  return {
    available: true,
    initialized: Boolean(owner),
    user: publicUser(user),
  };
}
export async function createOwner(store, input) {
  validate(input);
  const hash = await hashPassword(input.password);
  return store.transaction(async (tx) => {
    await tx.rows(
      "SELECT version FROM ad_schema_migrations WHERE version=5 FOR UPDATE",
    );
    if ((await tx.rows("SELECT id FROM ad_users LIMIT 1")).length)
      throw new Error("工作空间已设置账号，请登录");
    await tx.rows("INSERT INTO ad_users VALUES(?,?,?,?,?)", [
      "owner",
      input.username,
      input.displayName?.trim().slice(0, 100) || input.username,
      hash,
      Date.now(),
    ]);
    return { ok: true };
  });
}
export async function login(store, input) {
  const [user] = await store.rows("SELECT * FROM ad_users WHERE username=?", [
    String(input.username || "").slice(0, 64),
  ]);
  // Unknown accounts pay the same expensive derivation cost; no account enumeration.
  const fallback = "scrypt$00000000000000000000000000000000$" + "0".repeat(128);
  if (
    !(await verifyPassword(
      String(input.password || ""),
      user?.password_hash || fallback,
    )) ||
    !user
  )
    throw new Error("账号或密码错误");
  const token = randomBytes(32).toString("base64url"),
    duration = input.remember ? 7 * 86400000 : 8 * 3600000,
    now = Date.now();
  await store.transaction(async (tx) => {
    const [fresh] = await tx.rows(
      "SELECT password_hash FROM ad_users WHERE id=? FOR UPDATE",
      [user.id],
    );
    if (fresh.password_hash !== user.password_hash)
      throw new Error("账号或密码错误");
    await tx.rows("DELETE FROM ad_sessions WHERE expires_at<=?", [now]);
    await tx.rows("INSERT INTO ad_sessions VALUES(?,?,?,?,?)", [
      tokenHash(token),
      user.id,
      input.desktop ? "桌面端" : "网页版",
      now,
      now + duration,
    ]);
  });
  return { token, maxAge: duration / 1000, user: publicUser(user) };
}
export async function account(store, { token, action, ...input }) {
  const state = await authStatus(store, token);
  if (!state.user) throw new Error("请重新登录");
  const id = state.user.id;
  if (action === "sessions")
    return (
      await store.rows(
        "SELECT token_hash,label,created_at,expires_at FROM ad_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC",
        [id, Date.now()],
      )
    ).map((s) => ({
      id: s.token_hash,
      label: s.label,
      createdAt: Number(s.created_at),
      expiresAt: Number(s.expires_at),
      current: s.token_hash === tokenHash(token),
    }));
  if (action === "profile") {
    const name = String(input.displayName || "").trim();
    if (!name || name.length > 100)
      throw new Error("显示名称须为 1–100 个字符");
    await store.rows("UPDATE ad_users SET display_name=? WHERE id=?", [
      name,
      id,
    ]);
    return (await authStatus(store, token)).user;
  }
  if (action === "password") {
    validate({ username: state.user.username, password: input.password });
    const [u] = await store.rows(
      "SELECT password_hash FROM ad_users WHERE id=?",
      [id],
    );
    if (!(await verifyPassword(input.currentPassword, u.password_hash)))
      throw new Error("当前密码错误");
    const hash = await hashPassword(input.password);
    await store.transaction(async (tx) => {
      const [fresh] = await tx.rows(
        "SELECT password_hash FROM ad_users WHERE id=? FOR UPDATE",
        [id],
      );
      if (fresh.password_hash !== u.password_hash)
        throw new Error("密码已变更，请重新登录");
      await tx.rows("UPDATE ad_users SET password_hash=? WHERE id=?", [
        hash,
        id,
      ]);
      await tx.rows("DELETE FROM ad_sessions WHERE user_id=?", [id]);
    });
    return { ok: true };
  }
  if (action === "revoke") {
    await store.rows(
      "DELETE FROM ad_sessions WHERE user_id=? AND token_hash<>?",
      [id, tokenHash(token)],
    );
    return { ok: true };
  }
  if (action === "logout") {
    await store.rows("DELETE FROM ad_sessions WHERE token_hash=?", [
      tokenHash(token),
    ]);
    return { ok: true };
  }
  throw new Error("未知账号操作");
}
