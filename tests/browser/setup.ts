import { request } from "@playwright/test";
import { mkdir } from "node:fs/promises";
export default async function setup() {
  const client = await request.newContext({ baseURL: "http://127.0.0.1:4318" });
  try {
    const response = await client.post("/api/auth/login", {
      data: { username: "audit_test_owner", password: "Synthetic-only-pass!" },
    });
    if (!response.ok()) throw new Error("测试账号登录失败");
    await mkdir("artifacts/e2e", { recursive: true });
    await client.storageState({ path: "artifacts/e2e/auth-state.json" });
  } finally {
    await client.dispose();
  }
}
