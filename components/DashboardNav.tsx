'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { signOutAction } from '@/lib/actions';

interface Props {
  user: {
    name?: string | null;
    image?: string | null;
  };
}

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings', label: 'Settings' },
] as const;

export default function DashboardNav({ user }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <header className="glass sticky top-0 z-50 px-4 sm:px-6 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/dashboard"
          className="text-lg font-bold gradient-text shrink-0"
        >
          GramDoc
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-slate-300 hover:text-white transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 min-w-0">
          {user.image && (
            <Image
              src={user.image}
              alt={user.name ?? 'User'}
              width={32}
              height={32}
              className="rounded-full ring-2 ring-brand-500 shrink-0"
            />
          )}
          <span className="hidden sm:block text-sm text-slate-300 truncate">
            {user.name}
          </span>
          <form action={signOutAction} className="hidden md:block">
            <button
              type="submit"
              className="text-xs text-slate-400 hover:text-white transition-colors whitespace-nowrap"
            >
              Sign out
            </button>
          </form>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[#2a2a48] text-slate-300 hover:text-white hover:border-[#4a4a68] transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="md:hidden mt-3 pt-3 border-t border-[#2a2a48] flex flex-col">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="text-sm text-slate-300 hover:text-white transition-colors py-2.5"
            >
              {l.label}
            </Link>
          ))}
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-sm text-slate-400 hover:text-white transition-colors py-2.5 text-left w-full"
            >
              Sign out
            </button>
          </form>
        </nav>
      )}
    </header>
  );
}
