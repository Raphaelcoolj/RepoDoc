import { Types } from 'mongoose';
import GeneratedDocModel from '../models/GeneratedDoc';
import { destroyPublicId } from './cloudinary';

const MAX_LAST_ERROR_LENGTH = 400;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]'],
  [/\b(ghp_|github_pat_|gho_|ghs_|ghu_)[A-Za-z0-9_]{10,}/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{10,}/g, '[redacted]'],
  [/\b(xox[baprs]-)[A-Za-z0-9-]{10,}/g, '$1[redacted]'],
];

export function sanitizeError(error: unknown): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    try {
      message = JSON.stringify(error) ?? 'Unknown error';
    } catch {
      message = 'Unknown error';
    }
  }

  for (const [pattern, replacement] of SECRET_PATTERNS) {
    message = message.replace(pattern, replacement);
  }

  if (message.length > MAX_LAST_ERROR_LENGTH) {
    message = `${message.slice(0, MAX_LAST_ERROR_LENGTH)}…`;
  }
  return message;
}

export interface PromoteParams {
  docId: Types.ObjectId;
  preCurrentPublicId: string;
  prePreviousPublicIds: string[];
  cloudinaryUrl: string;
  newPublicId: string;
  commitSha: string;
  etag?: string;
  pipelineVersion: number;
}

export interface PromoteResult {
  version: number;
  droppedPublicIds: string[];
}

export async function promoteDoc(params: PromoteParams): Promise<PromoteResult> {
  const newPrevious = params.preCurrentPublicId ? [params.preCurrentPublicId] : [];
  const droppedPublicIds = params.prePreviousPublicIds.filter(
    (id) => id && id !== params.preCurrentPublicId && id !== params.newPublicId
  );

  const unset: Record<string, string> = {
    lastError: '',
    lockedAt: '',
    lockedBy: '',
  };
  if (params.etag === undefined) {
    unset.etag = '';
  }

  const updated = await GeneratedDocModel.findOneAndUpdate(
    { _id: params.docId },
    {
      $set: {
        cloudinaryUrl: params.cloudinaryUrl,
        currentPublicId: params.newPublicId,
        previousPublicIds: newPrevious,
        commitSha: params.commitSha,
        lastKnownHeadSha: params.commitSha,
        commitsBehind: 0,
        pipelineVersion: params.pipelineVersion,
        status: 'ready' as const,
        lastRegeneratedAt: new Date(),
        failureCount: 0,
        ...(params.etag !== undefined ? { etag: params.etag } : {}),
      },
      $unset: unset,
      $inc: { version: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!updated) {
    throw new Error('promote failed: document not found');
  }

  for (const id of droppedPublicIds) {
    await destroyPublicId(id);
  }

  return { version: updated.version, droppedPublicIds };
}

export async function recordRegenFailure(
  docId: Types.ObjectId,
  userId: Types.ObjectId,
  error: unknown
): Promise<void> {
  await GeneratedDocModel.updateOne(
    { _id: docId, lockedBy: userId },
    {
      $set: {
        status: 'ready' as const,
        lastRegenAttemptAt: new Date(),
        lastError: sanitizeError(error),
      },
      $inc: { failureCount: 1 },
      $unset: { lockedAt: '', lockedBy: '' },
    }
  );
}
