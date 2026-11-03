import { decrypt } from './crypto';
import type { IUser } from '../models/User';

export const FREE_TIER_DAILY_LIMIT = 3;

export interface ByokResolution {
  hasByok: boolean;
  userApiKeys: { name: string; key: string }[];
}

export async function resolveByokKeys(dbUser: IUser): Promise<ByokResolution> {
  const hasByok = Boolean(
    dbUser.apiKeys?.provider1?.key || dbUser.apiKeys?.provider2?.key
  );

  const userApiKeys: { name: string; key: string }[] = [];
  if (hasByok) {
    for (const slot of ['provider1', 'provider2'] as const) {
      const entry = dbUser.apiKeys?.[slot];
      if (entry?.key) {
        try {
          userApiKeys.push({ name: entry.name, key: decrypt(entry.key) });
        } catch {
          // Skip malformed encrypted keys
        }
      }
    }
  }

  return { hasByok, userApiKeys };
}

export function checkQuota(dbUser: IUser, hasByok: boolean): boolean {
  if (hasByok) return true;

  const now = new Date();
  const resetAt = new Date(dbUser.freeDocsResetAt);
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (now.getTime() - resetAt.getTime() >= oneDayMs) {
    dbUser.freeDocsUsed = 0;
    dbUser.freeDocsResetAt = now;
  }

  return dbUser.freeDocsUsed < FREE_TIER_DAILY_LIMIT;
}

export async function incrementQuota(
  dbUser: IUser,
  hasByok: boolean
): Promise<void> {
  if (hasByok) return;
  dbUser.freeDocsUsed += 1;
  await dbUser.save();
}
