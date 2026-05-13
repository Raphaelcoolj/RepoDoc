'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PROVIDERS = ['openai', 'anthropic', 'grok', 'gemini', 'deepseek'] as const;
type ProviderName = typeof PROVIDERS[number];

interface Slot {
  name: ProviderName | '';
  key: string;
}

export default function OnboardingClient({ userId }: { userId: string }) {
  const router = useRouter();
  const [slots, setSlots] = useState<[Slot, Slot]>([
    { name: '', key: '' },
    { name: '', key: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateSlot = (idx: 0 | 1, field: keyof Slot, value: string) => {
    setSlots((prev) => {
      const next: [Slot, Slot] = [{ ...prev[0] }, { ...prev[1] }];
      (next[idx] as unknown as Record<string, string>)[field] = value;
      return next;
    });
  };

  const markComplete = async () => {
    await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complete: true }) });
  };

  const handleSkip = async () => {
    setSaving(true);
    await markComplete();
    window.location.href = '/dashboard';
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    for (let i = 0; i < 2; i++) {
      const slot = slots[i];
      if (!slot.name && !slot.key) continue;
      if (!slot.name || !slot.key) {
        setError(`Slot ${i + 1}: both provider and key are required.`);
        setSaving(false);
        return;
      }

      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: `provider${i + 1}`, name: slot.name, key: slot.key }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Failed to save key');
        setSaving(false);
        return;
      }
    }

    await markComplete();
    window.location.href = '/dashboard';
  };

  return (
    <div className="space-y-6">
      {[0, 1].map((idx) => (
        <div key={idx} className="bg-[#1e1e38]/60 rounded-2xl p-6 border border-[#2a2a48]">
          <p className="text-sm font-medium text-slate-300 mb-4">
            API Key Slot {idx + 1}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Provider</label>
              <select
                value={slots[idx].name}
                onChange={(e) => updateSlot(idx as 0 | 1, 'name', e.target.value)}
                className="w-full bg-[#16162a] border border-[#2a2a48] text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors"
              >
                <option value="">Select provider...</option>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">API Key</label>
              <input
                type="password"
                placeholder="sk-..."
                value={slots[idx].key}
                onChange={(e) => updateSlot(idx as 0 | 1, 'key', e.target.value)}
                className="w-full bg-[#16162a] border border-[#2a2a48] text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors placeholder:text-slate-600"
              />
            </div>
          </div>
        </div>
      ))}

      {error && (
        <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <button
          onClick={handleSkip}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-50"
        >
          Skip for now
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-7 py-2.5 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm font-medium transition-all disabled:opacity-50 hover:scale-[1.02]"
        >
          {saving ? 'Saving...' : 'Save & Continue →'}
        </button>
      </div>

      <p className="text-center text-xs text-slate-500 pt-2">
        Keys are encrypted at rest with AES-256-CBC and never exposed to the client.
      </p>
    </div>
  );
}
