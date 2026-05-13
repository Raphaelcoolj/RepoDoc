import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import GeneratedDocModel from '@/models/GeneratedDoc';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  }

  await connectDB();
  const doc = await GeneratedDocModel.findOne({ slug }).lean();
  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Increment view count
  await GeneratedDocModel.updateOne({ slug }, { $inc: { viewCount: 1 } });

  return NextResponse.json({
    repoUrl: doc.repoUrl,
    repoName: doc.repoName,
    repoOwner: doc.repoOwner,
    cloudinaryUrl: doc.cloudinaryUrl,
    viewCount: doc.viewCount + 1,
    createdAt: doc.createdAt,
  });
}
