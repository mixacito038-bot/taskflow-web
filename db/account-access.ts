import { eq, sql } from "drizzle-orm";
import { getBootstrapAdminEmail, getDb } from ".";
import { accounts } from "./schema";

export type SsoIdentity = {
  email: string;
  displayName: string;
};

export type SsoAccount = typeof accounts.$inferSelect;

/**
 * Resolve the platform account bound to the dispatcher-authenticated email.
 *
 * Invited/shared accounts already exist in D1 before their first sign-in. The
 * only account created here is the explicitly configured bootstrap owner when
 * the account store is still empty.
 */
export async function resolveSsoAccount(identity: SsoIdentity): Promise<SsoAccount | null> {
  const db = await getDb();
  const email = normalizeEmail(identity.email);
  if (!email) return null;

  let [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
  const now = new Date().toISOString();
  if (!account) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(accounts);
    const bootstrapAdminEmail = await getBootstrapAdminEmail();
    if (Number(count) > 0 || !bootstrapAdminEmail || email !== bootstrapAdminEmail) return null;

    await db.insert(accounts).values({
      id: `acct-${crypto.randomUUID()}`,
      email,
      displayName: identity.displayName.trim() || email,
      status: "active",
      lastLoginAt: now,
    }).onConflictDoNothing();
    [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
  }

  if (!account) return null;
  const displayName = identity.displayName.trim() || account.displayName || email;
  await db.update(accounts).set({
    displayName,
    lastLoginAt: now,
    updatedAt: now,
  }).where(eq(accounts.id, account.id));

  return { ...account, displayName, lastLoginAt: now, updatedAt: now };
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
