import { auth } from '@/auth';
import { connectDB } from '@/lib/db';
import UserModel from '@/models/User';
import { redirect } from 'next/navigation';
import OnboardingClient from './OnboardingClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Setup',
  description: 'Add your API keys to get unlimited documentation generations.',
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  await connectDB();
  const dbUser = await UserModel.findById(session.user.id).lean();

  if (dbUser?.onboardingComplete) redirect('/dashboard');

  return (
    <main className="min-h-screen flex items-center justify-center hero-glow px-4 py-12">
      <div className="glass rounded-3xl p-10 w-full max-w-2xl glow-border">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black gradient-text mb-2">Welcome to GramDoc 👋</h1>
          <p className="text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
            You can optionally add up to 2 of your own AI provider API keys for
            unlimited documentation generations. This step is completely optional — you
            can skip it and use the free tier (3 docs/day).
          </p>
        </div>

        <OnboardingClient userId={session.user.id} />
      </div>
    </main>
  );
}
