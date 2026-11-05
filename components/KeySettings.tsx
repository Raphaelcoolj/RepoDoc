'use client';

import { useEffect, useState, useCallback } from 'react';

const PROVIDERS = ['groq', 'openai', 'anthropic', 'grok', 'gemini', 'deepseek'] as const;
type ProviderName = typeof PROVIDERS[number];

const PROVIDER_LABELS: Record<ProviderName, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  grok: 'Grok (xAI)',
  gemini: 'Gemini (Google)',
  deepseek: 'DeepSeek',
};

interface KeysResponse {
  keys: { provider1: ProviderName | null; provider2: ProviderName | null };
  freeDocsUsed: number;
  freeDocsResetAt: string;
}

interface SlotState {
  name: ProviderName | '';
  key: string;
  saved: boolean;
  loading: boolean;
  error: string;
}

function initSlot(): SlotState {
  return { name: '', key: '', saved: false, loading: false, error: '' };
}

function providerLabel(name: ProviderName | ''): string {
  return name ? PROVIDER_LABELS[name] : '';
}

export default function KeySettings() {
  const [slots, setSlots] = useState<[SlotState, SlotState]>([initSlot(), initSlot()]);
  const [fetching, setFetching] = useState(true);
  const [freeDocsUsed, setFreeDocsUsed] = useState(0);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys');
      const data = await res.json() as KeysResponse;
      setFreeDocsUsed(data.freeDocsUsed);
      setSlots((prev) => {
        const next: [SlotState, SlotState] = [{ ...prev[0] }, { ...prev[1] }];
        for (const [i, slot] of (['provider1', 'provider2'] as const).entries()) {
          if (data.keys[slot]) {
            next[i] = { ...next[i], name: data.keys[slot] as ProviderName, saved: true };
          }
        }
        return next;
      });
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { void fetchKeys(); }, [fetchKeys]);

  const updateSlot = (idx: 0 | 1, field: keyof SlotState, value: string | boolean) => {
    setSlots((prev) => {
      const next: [SlotState, SlotState] = [{ ...prev[0] }, { ...prev[1] }];
      (next[idx] as unknown as Record<string, unknown>)[field] = value;
      return next;
    });
  };

  const handleSave = async (idx: 0 | 1) => {
    const slot = slots[idx];
    if (!slot.name || !slot.key) {
      updateSlot(idx, 'error', 'Both provider and key are required.');
      return;
    }
    updateSlot(idx, 'loading', true);
    updateSlot(idx, 'error', '');

    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: `provider${idx + 1}`, name: slot.name, key: slot.key }),
    });

    if (res.ok) {
      setSlots((prev) => {
        const next: [SlotState, SlotState] = [{ ...prev[0] }, { ...prev[1] }];
        next[idx] = { ...next[idx], saved: true, key: '', loading: false };
        return next;
      });
    } else {
      const data = await res.json() as { error?: string };
      updateSlot(idx, 'error', data.error ?? 'Save failed');
      updateSlot(idx, 'loading', false);
    }
  };

  const handleDelete = async (idx: 0 | 1) => {
    updateSlot(idx, 'loading', true);
    const res = await fetch('/api/keys', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: `provider${idx + 1}` }),
    });
    if (res.ok) {
      setSlots((prev) => {
        const next: [SlotState, SlotState] = [{ ...prev[0] }, { ...prev[1] }];
        next[idx] = initSlot();
        return next;
      });
    }
  };

  if (fetching) {
    return (
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <div key={i} className="h-24 bg-[#1e1e38] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Usage info */}
      <div className="bg-[#16162a] rounded-xl p-4 border border-[#2a2a48] text-sm">
        <p className="text-slate-400">
          Free tier usage today:{' '}
          <span className="text-white font-semibold">{freeDocsUsed}/3</span>
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Adding BYOK keys gives you unlimited generations.
        </p>
      </div>

      {[0, 1].map((idx) => {
        const slot = slots[idx];
        const slotLabel = `API Key Slot ${idx + 1}`;
        return (
          <div key={idx} className="bg-[#1e1e38] rounded-2xl p-4 sm:p-6 border border-[#2a2a48]">
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="text-sm font-medium text-slate-300">{slotLabel}</p>
              {slot.saved && (
                <span className="text-xs text-green-400 bg-green-400/10 px-2.5 py-1 rounded-full">
                  ✓ Active
                </span>
              )}
            </div>

            {slot.saved ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white font-medium">{providerLabel(slot.name)}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Key saved and encrypted</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => updateSlot(idx as 0 | 1, 'saved', false)}
                    className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-[#2a2a48] hover:border-[#4a4a68] transition-colors"
                  >
                    Replace
                  </button>
                  <button
                    onClick={() => handleDelete(idx as 0 | 1)}
                    disabled={slot.loading}
                    className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-500/20 hover:border-red-500/40 transition-colors disabled:opacity-50"
                  >
                    {slot.loading ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Provider</label>
                    <select
                      value={slot.name}
                      onChange={(e) => updateSlot(idx as 0 | 1, 'name', e.target.value)}
                      className="w-full bg-[#16162a] border border-[#2a2a48] text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors"
                    >
                      <option value="">Select provider…</option>
                      {PROVIDERS.map((p) => (
                        <option key={p} value={p}>
                          {PROVIDER_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">API Key</label>
                    <input
                      type="password"
                      placeholder="sk-..."
                      value={slot.key}
                      onChange={(e) => updateSlot(idx as 0 | 1, 'key', e.target.value)}
                      className="w-full bg-[#16162a] border border-[#2a2a48] text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-brand-500 transition-colors placeholder:text-slate-600"
                    />
                  </div>
                </div>

                {slot.error && (
                  <p className="text-xs text-red-400">{slot.error}</p>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => handleSave(idx as 0 | 1)}
                    disabled={slot.loading}
                    className="text-sm bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-5 py-2 rounded-lg font-medium transition-all"
                  >
                    {slot.loading ? 'Saving…' : 'Save Key'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-slate-500 text-center">
        Keys are encrypted at rest with AES-256-CBC. They are never sent to the client in plaintext.
      </p>
    </div>
  );
}
