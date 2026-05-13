'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  freeRemaining: number;
  hasByok: boolean;
}

function isValidGithubUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/.test(url.trim());
}

export default function RepoForm({ freeRemaining, hasByok }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [phase, setPhase] = useState('');

  const canGenerate = hasByok || freeRemaining > 0;

  const PHASES = [
    'Fetching repository metadata…',
    'Downloading source files…',
    'Analyzing with AI models…',
    'Generating architecture diagram…',
    'Uploading documentation…',
    'Almost done…',
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    if (!isValidGithubUrl(url)) {
      setErrorMsg('Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)');
      setStatus('error');
      return;
    }

    if (!canGenerate) {
      setErrorMsg('Daily free limit reached. Add your API keys in Settings for unlimited access.');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    // Cycle through loading phases for UX
    let phaseIdx = 0;
    setPhase(PHASES[0]);
    const phaseInterval = setInterval(() => {
      phaseIdx = Math.min(phaseIdx + 1, PHASES.length - 1);
      setPhase(PHASES[phaseIdx]);
    }, 8000);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: url }),
      });

      clearInterval(phaseInterval);

      const data = await res.json() as { slug?: string; error?: string; limitReached?: boolean };

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Generation failed. Please try again.');
        setStatus('error');
        return;
      }

      if (data.slug) {
        router.push(`/doc/${data.slug}`);
      }
    } catch {
      clearInterval(phaseInterval);
      setErrorMsg('Network error. Please check your connection and try again.');
      setStatus('error');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-slate-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </div>
          <input
            id="repo-url"
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setStatus('idle'); setErrorMsg(''); }}
            placeholder="https://github.com/owner/repository"
            className="w-full bg-[#16162a] border border-[#2a2a48] focus:border-brand-500 text-slate-200 placeholder:text-slate-600 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none transition-colors"
            disabled={status === 'loading'}
          />
        </div>
        <button
          type="submit"
          id="generate-btn"
          disabled={status === 'loading' || !url.trim()}
          className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3.5 rounded-xl font-semibold text-sm transition-all hover:scale-[1.02] whitespace-nowrap"
        >
          {status === 'loading' ? 'Generating…' : 'Generate Docs →'}
        </button>
      </div>

      {/* Loading progress */}
      {status === 'loading' && (
        <div className="bg-[#1e1e38] rounded-xl p-4 border border-[#2a2a48]">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-slate-300">{phase}</p>
          </div>
          <div className="mt-3 h-1 bg-[#2a2a48] rounded-full overflow-hidden">
            <div className="h-full bg-brand-500 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            This may take 30–60 seconds for the first generation. Cached results are instant.
          </p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && errorMsg && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-sm text-red-400">{errorMsg}</p>
        </div>
      )}

      {!hasByok && (
        <p className="text-xs text-slate-500">
          Free tier: {freeRemaining}/3 generations remaining today. 
          {freeRemaining === 0 && ' Add API keys in Settings for unlimited access.'}
        </p>
      )}
    </form>
  );
}
