export const dynamic = "force-dynamic";

/**
 * 数据准备中心隐藏入口的口令核验。
 *
 * 入口口令只是操作捷径的“门铃”，不是安全边界：即使口令通过，
 * /api/data-workbench 仍会在服务端逐一校验登录身份、医院成员关系与
 * connector.manage / data.* 权限。口令可通过环境变量
 * DATA_WORKBENCH_ENTRY_PASSWORD 覆盖，未配置时使用默认值。
 */
const DEFAULT_ENTRY_PASSWORD = "yonghong";
const MAX_PASSWORD_LENGTH = 128;

async function resolveEntryPassword(): Promise<string> {
  try {
    const { env } = await import("cloudflare:workers");
    const value = (env as unknown as Record<string, unknown>).DATA_WORKBENCH_ENTRY_PASSWORD;
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // 非 Worker 运行时（本地测试等）没有 cloudflare:workers，使用默认口令。
  }
  return DEFAULT_ENTRY_PASSWORD;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 通过哈希后比较，避免逐字符早退造成的时序差异。
async function passwordMatches(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([sha256Hex(candidate), sha256Hex(expected)]);
  return candidateHash === expectedHash;
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const password = payload && typeof payload === "object" && typeof (payload as { password?: unknown }).password === "string"
    ? (payload as { password: string }).password.trim()
    : "";
  if (!password || password.length > MAX_PASSWORD_LENGTH) {
    return Response.json({ error: "invalid_entry_password" }, { status: 403 });
  }
  const expected = await resolveEntryPassword();
  if (!(await passwordMatches(password, expected))) {
    return Response.json({ error: "invalid_entry_password" }, { status: 403 });
  }
  return Response.json({ ok: true }, {
    headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
