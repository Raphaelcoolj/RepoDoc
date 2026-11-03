'use client';

import { useEffect, useState } from 'react';

type FreshnessStatus =
  | 'up_to_date'
  | 'behind'
  | 'regenerating'
  | 'unknown'
  | 'source_unavailable';

interface Freshness {
  status: FreshnessStatus;
  commitsBehind?: number;
}

interface Props {
  slug: string;
}

const POLL_INTERVAL_MS = 8_000;

export default function DocFreshnessBanner({ slug }: Props) {
  const [freshness, setFreshness] = useState<Freshness | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const res = await fetch(`/api/doc/${slug}/freshness`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as Freshness;
        if (cancelled) return;
        setFreshness(data);
        if (data.status === 'regenerating') {
          timer = setTimeout(load, POLL_INTERVAL_MS);
        }
      } catch {
        // Network hiccup: leave the banner hidden.
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  if (!freshness || freshness.status === 'up_to_date') return null;

  if (freshness.status === 'regenerating') {
    return (
      <div
        role="status"
        className="mb-6 bg-sky-900/20 border border-sky-500/30 rounded-xl px-4 py-3 flex items-center gap-3"
      >
        <span className="w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin shrink-0" />
        <p className="text-sm text-sky-300">
          Regenerating documentation from the latest commits — this page will
          update shortly.
        </p>
      </div>
    );
  }

  if (freshness.status === 'behind') {
    const count = freshness.commitsBehind;
    return (
      <div
        role="status"
        className="mb-6 bg-amber-900/20 border border-amber-500/30 rounded-xl px-4 py-3"
      >
        <p className="text-sm text-amber-300">
          {typeof count === 'number' && count > 0
            ? `This documentation is ${count} commit${count === 1 ? '' : 's'} behind the latest changes.`
            : 'This documentation is behind the latest changes.'}{' '}
          Re-submit the repository URL on the home page to refresh it.
        </p>
      </div>
    );
  }

  if (freshness.status === 'source_unavailable') {
    return (
      <div
        role="status"
        className="mb-6 bg-[#1e1e38] border border-[#2a2a48] rounded-xl px-4 py-3"
      >
        <p className="text-sm text-slate-400">
          The source repository is no longer available. Showing the last
          generated documentation.
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mb-6 bg-[#1e1e38] border border-[#2a2a48] rounded-xl px-4 py-3"
    >
      <p className="text-sm text-slate-400">
        Couldn&apos;t verify documentation freshness right now.
      </p>
    </div>
  );
}
