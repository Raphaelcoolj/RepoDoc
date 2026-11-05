import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import KeySettings from '@/components/KeySettings';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Manage your BYOK API keys for unlimited documentation generations.',
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  return (
    <div className="max-w-2xl mx-auto space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-white">Settings</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Manage your BYOK API keys. Add up to 2 providers for unlimited generations.
        </p>
      </div>

      <div className="glass rounded-2xl p-5 sm:p-8">
        <h2 className="text-lg font-bold text-white mb-6">API Keys</h2>
        <KeySettings />
      </div>

      <div className="glass rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg font-bold text-white mb-2">Account</h2>
        <div className="flex items-center gap-4 mt-4 min-w-0">
          {session.user.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={session.user.image} alt="Avatar" className="w-12 h-12 rounded-full ring-2 ring-brand-500" />
          )}
          <div className="min-w-0">
            <p className="text-white font-medium truncate">{session.user.name}</p>
            <p className="text-sm text-slate-400 truncate">{session.user.email}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
