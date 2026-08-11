import { eq } from "drizzle-orm";
import { getDb } from ".";
import { accountCredentials, accounts } from "./schema";

/**
 * 自有账号密码登录：平台管理员为医院成员分配登录账号与初始密码，
 * 成员用账号密码建立应用会话，不再依赖外部统一身份网关。
 *
 * 口径：
 * - 密码使用 PBKDF2-SHA256（默认 210000 轮）加随机盐存储，仅存哈希；
 * - 连续 5 次失败锁定 15 分钟，与 MFA 锁定策略一致；
 * - 初始密码默认标记“首次登录需修改”。
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_PBKDF2_ITERATIONS = 210000;
export const PASSWORD_LOCK_THRESHOLD = 5;
export const PASSWORD_LOCK_MS = 15 * 60 * 1000;
const PASSWORD_ALGORITHM = "pbkdf2-sha256";
const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

type CredentialRow = typeof accountCredentials.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

export class PasswordAuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly lockedUntil: string | null;

  constructor(code: string, status = 400, lockedUntil: string | null = null) {
    super(code);
    this.name = "PasswordAuthError";
    this.code = code;
    this.status = status;
    this.lockedUntil = lockedUntil;
  }
}

export function passwordAuthError(error: unknown) {
  if (error instanceof PasswordAuthError) {
    return Response.json({
      error: error.code,
      ...(error.lockedUntil ? { lockedUntil: error.lockedUntil } : {}),
    }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "password_auth_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): string[] {
  const username = normalizeUsername(value);
  const errors: string[] = [];
  if (!USERNAME_PATTERN.test(username)) {
    errors.push("登录账号需以字母开头，3—64 位小写字母、数字或 . _ - 组合");
  }
  return errors;
}

export function validatePasswordStrength(password: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) errors.push(`密码长度不能少于 ${PASSWORD_MIN_LENGTH} 位`);
  if (password.length > PASSWORD_MAX_LENGTH) errors.push(`密码长度不能超过 ${PASSWORD_MAX_LENGTH} 位`);
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) errors.push("密码需同时包含字母和数字");
  if (/\s/.test(password)) errors.push("密码不能包含空白字符");
  return errors;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function derivePasswordHash(password: string, saltHex: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex) as unknown as BufferSource, iterations },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

async function hashesMatch(left: string, right: string): Promise<boolean> {
  // 双方再做一次 SHA-256 后比较，规避逐字符早退的时序差异。
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return bytesToHex(new Uint8Array(leftDigest)) === bytesToHex(new Uint8Array(rightDigest));
}

export type UpsertCredentialInput = {
  accountId: string;
  username: string;
  password: string;
  mustChangePassword?: boolean;
};

export async function upsertAccountCredential(input: UpsertCredentialInput): Promise<{ username: string }> {
  const username = normalizeUsername(input.username);
  const usernameErrors = validateUsername(username);
  if (usernameErrors.length) throw new PasswordAuthError("invalid_username", 400);
  const passwordErrors = validatePasswordStrength(input.password);
  if (passwordErrors.length) throw new PasswordAuthError("weak_password", 400);

  const db = await getDb();
  const [existingOwner] = await db.select({ accountId: accountCredentials.accountId })
    .from(accountCredentials)
    .where(eq(accountCredentials.username, username))
    .limit(1);
  if (existingOwner && existingOwner.accountId !== input.accountId) {
    throw new PasswordAuthError("username_taken", 409);
  }

  const salt = randomSaltHex();
  const passwordHash = await derivePasswordHash(input.password, salt, PASSWORD_PBKDF2_ITERATIONS);
  const now = new Date().toISOString();
  const mustChange = input.mustChangePassword ?? true;
  const [current] = await db.select().from(accountCredentials)
    .where(eq(accountCredentials.accountId, input.accountId))
    .limit(1);
  if (current) {
    await db.update(accountCredentials).set({
      username,
      passwordHash,
      passwordSalt: salt,
      iterations: PASSWORD_PBKDF2_ITERATIONS,
      algorithm: PASSWORD_ALGORITHM,
      mustChangePassword: mustChange,
      failedAttempts: 0,
      lockedUntil: null,
      passwordUpdatedAt: now,
      updatedAt: now,
    }).where(eq(accountCredentials.accountId, input.accountId));
  } else {
    await db.insert(accountCredentials).values({
      accountId: input.accountId,
      username,
      passwordHash,
      passwordSalt: salt,
      iterations: PASSWORD_PBKDF2_ITERATIONS,
      algorithm: PASSWORD_ALGORITHM,
      mustChangePassword: mustChange,
      failedAttempts: 0,
      lockedUntil: null,
      passwordUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { username };
}

export type PasswordLoginResult = {
  account: AccountRow;
  credential: CredentialRow;
};

/**
 * 密码模式冷启动：环境变量提供 BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD /
 * BOOTSTRAP_ADMIN_EMAIL 时，首次用该账号密码登录会自动创建管理员账号与凭据
 * （标记首次登录需改密）。医院成员关系仍由 tenant-context 的引导逻辑按
 * BOOTSTRAP_ADMIN_EMAIL 授予，本函数不授予任何权限。
 */
export async function maybeBootstrapAdminCredential(usernameInput: string, password: string): Promise<void> {
  const username = normalizeUsername(usernameInput);
  if (!username || !password) return;

  let bootstrapUsername = "";
  let bootstrapPassword = "";
  let bootstrapEmail = "";
  try {
    const { env } = await import("cloudflare:workers");
    const runtimeEnv = env as unknown as Record<string, unknown>;
    bootstrapUsername = typeof runtimeEnv.BOOTSTRAP_ADMIN_USERNAME === "string" ? runtimeEnv.BOOTSTRAP_ADMIN_USERNAME.trim().toLowerCase() : "";
    bootstrapPassword = typeof runtimeEnv.BOOTSTRAP_ADMIN_PASSWORD === "string" ? runtimeEnv.BOOTSTRAP_ADMIN_PASSWORD : "";
    bootstrapEmail = typeof runtimeEnv.BOOTSTRAP_ADMIN_EMAIL === "string" ? runtimeEnv.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase() : "";
  } catch {
    return;
  }
  if (!bootstrapUsername || !bootstrapPassword || !bootstrapEmail) return;
  if (username !== bootstrapUsername || password !== bootstrapPassword) return;

  const db = await getDb();
  const [existingCredential] = await db.select({ accountId: accountCredentials.accountId })
    .from(accountCredentials)
    .where(eq(accountCredentials.username, username))
    .limit(1);
  if (existingCredential) return;

  await db.insert(accounts)
    .values({ id: `acct-${crypto.randomUUID()}`, email: bootstrapEmail, displayName: "平台管理员", status: "active" })
    .onConflictDoNothing();
  const [account] = await db.select().from(accounts).where(eq(accounts.email, bootstrapEmail)).limit(1);
  if (!account || account.status !== "active") return;
  const [accountCredential] = await db.select({ accountId: accountCredentials.accountId })
    .from(accountCredentials)
    .where(eq(accountCredentials.accountId, account.id))
    .limit(1);
  if (accountCredential) return;
  await upsertAccountCredential({ accountId: account.id, username, password, mustChangePassword: true });
}

export async function verifyPasswordLogin(usernameInput: string, password: string): Promise<PasswordLoginResult> {
  const username = normalizeUsername(usernameInput);
  if (!username || !password) throw new PasswordAuthError("invalid_credentials", 401);

  const db = await getDb();
  const [credential] = await db.select().from(accountCredentials)
    .where(eq(accountCredentials.username, username))
    .limit(1);
  if (!credential) {
    // 账号不存在也执行一次同代价哈希，避免用响应时间探测账号是否存在。
    await derivePasswordHash(password, randomSaltHex(), PASSWORD_PBKDF2_ITERATIONS);
    throw new PasswordAuthError("invalid_credentials", 401);
  }

  const now = Date.now();
  if (credential.lockedUntil && Date.parse(credential.lockedUntil) > now) {
    throw new PasswordAuthError("credential_locked", 423, credential.lockedUntil);
  }

  const candidateHash = await derivePasswordHash(password, credential.passwordSalt, credential.iterations);
  if (!(await hashesMatch(candidateHash, credential.passwordHash))) {
    const failedAttempts = credential.failedAttempts + 1;
    const lockedUntil = failedAttempts >= PASSWORD_LOCK_THRESHOLD
      ? new Date(now + PASSWORD_LOCK_MS).toISOString()
      : null;
    await db.update(accountCredentials).set({
      failedAttempts: lockedUntil ? 0 : failedAttempts,
      lockedUntil,
      updatedAt: new Date(now).toISOString(),
    }).where(eq(accountCredentials.accountId, credential.accountId));
    if (lockedUntil) throw new PasswordAuthError("credential_locked", 423, lockedUntil);
    throw new PasswordAuthError("invalid_credentials", 401);
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.id, credential.accountId)).limit(1);
  if (!account) throw new PasswordAuthError("invalid_credentials", 401);
  if (account.status !== "active") throw new PasswordAuthError("account_disabled", 403);

  if (credential.failedAttempts > 0 || credential.lockedUntil) {
    await db.update(accountCredentials).set({
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(now).toISOString(),
    }).where(eq(accountCredentials.accountId, credential.accountId));
  }
  return { account, credential };
}

export async function changeAccountPassword(accountId: string, currentPassword: string, newPassword: string): Promise<void> {
  const db = await getDb();
  const [credential] = await db.select().from(accountCredentials)
    .where(eq(accountCredentials.accountId, accountId))
    .limit(1);
  if (!credential) throw new PasswordAuthError("credential_not_found", 404);

  const currentHash = await derivePasswordHash(currentPassword, credential.passwordSalt, credential.iterations);
  if (!(await hashesMatch(currentHash, credential.passwordHash))) {
    throw new PasswordAuthError("invalid_credentials", 401);
  }
  const passwordErrors = validatePasswordStrength(newPassword);
  if (passwordErrors.length) throw new PasswordAuthError("weak_password", 400);
  if (currentPassword === newPassword) throw new PasswordAuthError("password_unchanged", 400);

  const salt = randomSaltHex();
  const passwordHash = await derivePasswordHash(newPassword, salt, PASSWORD_PBKDF2_ITERATIONS);
  const now = new Date().toISOString();
  await db.update(accountCredentials).set({
    passwordHash,
    passwordSalt: salt,
    iterations: PASSWORD_PBKDF2_ITERATIONS,
    algorithm: PASSWORD_ALGORITHM,
    mustChangePassword: false,
    failedAttempts: 0,
    lockedUntil: null,
    passwordUpdatedAt: now,
    updatedAt: now,
  }).where(eq(accountCredentials.accountId, accountId));
}

export async function getAccountCredentialSummary(accountId: string): Promise<{
  username: string;
  mustChangePassword: boolean;
  passwordUpdatedAt: string;
} | null> {
  const db = await getDb();
  const [credential] = await db.select({
    username: accountCredentials.username,
    mustChangePassword: accountCredentials.mustChangePassword,
    passwordUpdatedAt: accountCredentials.passwordUpdatedAt,
  }).from(accountCredentials).where(eq(accountCredentials.accountId, accountId)).limit(1);
  return credential ?? null;
}
