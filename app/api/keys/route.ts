import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { connectDB } from '@/lib/db';
import UserModel from '@/models/User';
import { encrypt, decrypt } from '@/lib/crypto';

const ALLOWED_PROVIDERS = ['openai', 'anthropic', 'grok', 'gemini', 'deepseek'] as const;
type ProviderName = typeof ALLOWED_PROVIDERS[number];

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();
  const user = await UserModel.findById(session.user.id).lean();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Return provider names only — never expose encrypted keys to client
  const keys = {
    provider1: user.apiKeys?.provider1?.name ?? null,
    provider2: user.apiKeys?.provider2?.name ?? null,
  };

  return NextResponse.json({
    keys,
    freeDocsUsed: user.freeDocsUsed,
    freeDocsResetAt: user.freeDocsResetAt,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as { slot?: unknown; name?: unknown; key?: unknown };
  const slot = body.slot as 'provider1' | 'provider2';
  const name = body.name as ProviderName;
  const key = body.key as string;

  if (!['provider1', 'provider2'].includes(slot)) {
    return NextResponse.json({ error: 'Invalid slot. Must be provider1 or provider2.' }, { status: 400 });
  }
  if (!ALLOWED_PROVIDERS.includes(name)) {
    return NextResponse.json({ error: `Invalid provider. Allowed: ${ALLOWED_PROVIDERS.join(', ')}` }, { status: 400 });
  }
  if (typeof key !== 'string' || key.trim().length === 0) {
    return NextResponse.json({ error: 'API key is required' }, { status: 400 });
  }

  const encryptedKey = encrypt(key.trim());

  await connectDB();
  await UserModel.findByIdAndUpdate(session.user.id, {
    $set: { [`apiKeys.${slot}`]: { name, key: encryptedKey } },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json() as { slot?: unknown };
  const slot = body.slot as 'provider1' | 'provider2';

  if (!['provider1', 'provider2'].includes(slot)) {
    return NextResponse.json({ error: 'Invalid slot.' }, { status: 400 });
  }

  await connectDB();
  await UserModel.findByIdAndUpdate(session.user.id, {
    $unset: { [`apiKeys.${slot}`]: '' },
  });

  return NextResponse.json({ success: true });
}

// Verify key is readable (internal test endpoint)
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();
  const user = await UserModel.findById(session.user.id);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const results: Record<string, boolean> = {};
  for (const slot of ['provider1', 'provider2'] as const) {
    const entry = user.apiKeys?.[slot];
    if (entry?.key) {
      try {
        decrypt(entry.key);
        results[slot] = true;
      } catch {
        results[slot] = false;
      }
    }
  }

  return NextResponse.json({ results });
}
