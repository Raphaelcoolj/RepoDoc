import GeneratedDocModel, { IGeneratedDoc } from '../models/GeneratedDoc';
import { Types } from 'mongoose';

export function getRegenLockTtlMinutes(): number {
  const raw = process.env.REGEN_LOCK_TTL_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export async function acquireLock(
  docId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<IGeneratedDoc | null> {
  const staleBefore = new Date(Date.now() - getRegenLockTtlMinutes() * 60_000);
  return GeneratedDocModel.findOneAndUpdate(
    {
      _id: docId,
      $or: [
        { status: { $ne: 'generating' } },
        { lockedAt: { $lt: staleBefore } },
        { lockedAt: { $exists: false }, status: 'generating' },
      ],
    },
    { $set: { status: 'generating', lockedAt: new Date(), lockedBy: userId } },
    { returnDocument: 'after' }
  );
}

export async function releaseLock(
  docId: Types.ObjectId,
  userId: Types.ObjectId
): Promise<void> {
  await GeneratedDocModel.updateOne(
    { _id: docId, lockedBy: userId },
    {
      $set: { status: 'ready' },
      $unset: { lockedAt: '', lockedBy: '' },
    }
  );
}
