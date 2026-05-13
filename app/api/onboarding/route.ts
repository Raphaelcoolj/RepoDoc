import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { connectDB } from '@/lib/db';
import UserModel from '@/models/User';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { complete?: boolean };
  if (!body.complete) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  await connectDB();
  await UserModel.findByIdAndUpdate(session.user.id, { onboardingComplete: true });

  return NextResponse.json({ success: true });
}
