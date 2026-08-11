import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return drizzle(env.DB, { schema });
}

export async function getBootstrapAdminEmail() {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as { BOOTSTRAP_ADMIN_EMAIL?: string };
  return runtimeEnv.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
}
