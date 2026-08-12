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

/**
 * 进程内粗粒度限速，仅为挡住脚本对入口口令的匿名爆破。
 *
 * 说明：这是“尽力而为”而非强安全边界——Worker 会横向扩展成多个 isolate，
 * 模块级 Map 只在同一 isolate 内共享，攻击者仍可能被分散到不同 isolate。
 * 真正的边界仍在 /api/data-workbench 的登录身份、医院成员关系与 data.* 权限校验，
 * 入口口令本身只是操作捷径。同一来源 1 分钟内失败超过 10 次即返回 429。
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_FAILURES = 10;
const failureBuckets = new Map<string, { count: number; resetAt: number }>();

function clientRateKey(request: Request): string {
  const forwarded = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "";
  return forwarded || "shared";
}

function isRateLimited(key: string, now: number): boolean {
  const bucket = failureBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) return false;
  return bucket.count > RATE_LIMIT_MAX_FAILURES;
}

function recordFailure(key: string, now: number): void {
  const bucket = failureBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    failureBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  bucket.count += 1;
}

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
  const now = Date.now();
  const rateKey = clientRateKey(request);
  if (isRateLimited(rateKey, now)) {
    return Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });
  }

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
    recordFailure(rateKey, now);
    return Response.json({ error: "invalid_entry_password" }, { status: 403 });
  }
  const expected = await resolveEntryPassword();
  if (!(await passwordMatches(password, expected))) {
    recordFailure(rateKey, now);
    return Response.json({ error: "invalid_entry_password" }, { status: 403 });
  }
  return Response.json({ ok: true }, {
    headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
