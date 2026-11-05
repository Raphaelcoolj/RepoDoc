import { auth } from '@/auth';
import Link from 'next/link';
import Image from 'next/image';
import { signOut } from '@/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="glass sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <Link href="/dashboard" className="text-lg font-bold gradient-text">
          GramDoc
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          <Link href="/dashboard" className="text-slate-300 hover:text-white transition-colors">
            Dashboard
          </Link>
          <Link href="/settings" className="text-slate-300 hover:text-white transition-colors">
            Settings
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          {session?.user?.image && (
            <Image
              src={session.user.image}
              alt={session.user.name ?? 'User'}
              width={32}
              height={32}
              className="rounded-full ring-2 ring-brand-500"
            />
          )}
          <span className="hidden sm:block text-sm text-slate-300">
            {session?.user?.name}
          </span>
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/' });
            }}
          >
            <button
              type="submit"
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex-1 px-4 md:px-8 py-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
