export interface UsageEntry {
  provider: string;
  operation?: string;
  model?: string;
  sessionId?: string;
  turnId?: string | number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  estimatedCostUsd?: number;
  characters?: number;
  audioSeconds?: number;
  audioBytes?: number;
  elapsedMs?: number;
  firstTextMs?: number;
  firstAudioMs?: number;
  firstScheduledMs?: number;
  queuedSeconds?: number;
  interruptionStopMs?: number;
  speechEndToFirstScheduledMs?: number;
  playbackDelayMs?: number;
  underruns?: number;
  live?: boolean;
  outcome?: string;
  error?: string;
  requestId?: string;
  [key: string]: unknown;
}

const ledger = typeof process !== 'undefined' ? (process.env.EXPATIA_USAGE_FILE || '.runtime/provider-usage.jsonl') : '.runtime/provider-usage.jsonl';
const allowed = new Set(['provider', 'operation', 'model', 'sessionId', 'turnId', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens', 'totalTokens', 'costUsd', 'estimatedCostUsd', 'characters', 'audioSeconds', 'audioBytes', 'elapsedMs', 'firstTextMs', 'firstAudioMs', 'firstScheduledMs', 'queuedSeconds', 'interruptionStopMs', 'speechEndToFirstScheduledMs', 'playbackDelayMs', 'underruns', 'live', 'outcome', 'error', 'requestId']);
const memoryLedger: UsageEntry[] = [];
let diskWrites = Promise.resolve();

/** Append one request's returned usage, never a cumulative counter or transcript. */
export function recordUsage(entry: UsageEntry): void {
  const clean: Record<string, unknown> = { at: new Date().toISOString() };
  for (const [key, value] of Object.entries(entry)) {
    if (allowed.has(key) && value !== undefined && value !== null && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')) clean[key] = typeof value === 'string' ? value.slice(0, 180) : value;
  }
  memoryLedger.push(clean as UsageEntry); if (memoryLedger.length > 2000) memoryLedger.shift();
  if ('WebSocketPair' in globalThis) return;
  diskWrites = diskWrites.then(async () => {
    try {
      const fs = await import('node:fs/promises');
      await fs.mkdir(ledger.slice(0, ledger.lastIndexOf('/')) || '.', { recursive: true });
      await fs.appendFile(ledger, `${JSON.stringify(clean)}\n`, { mode: 0o600 });
    } catch { /* Accounting must not break gameplay on a read-only deployment. */ }
  });
}
export const appendUsage = recordUsage;
export function flushUsage() { return diskWrites; }
export function usageEntries(sessionId?: string) { return memoryLedger.filter(entry => !sessionId || entry.sessionId === sessionId).map(entry => ({ ...entry })); }

export function usageSummary(sessionId?: string) {
  const totals = { calls: 0, liveCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, totalTokens: 0, unreportedTokenCalls: 0, returnedCostUsd: 0, estimatedCostUsd: 0, voiceCharacters: 0, audioSeconds: 0 };
  const providers: Record<string, number> = {};
  try {
    for (const item of memoryLedger) {
      if (sessionId && item.sessionId !== sessionId) continue;
      totals.calls++;
      totals.liveCalls += item.live ? 1 : 0;
      if (['openrouter', 'jev'].includes(item.provider) && item.inputTokens === undefined && item.outputTokens === undefined) totals.unreportedTokenCalls++;
      providers[item.provider] = (providers[item.provider] || 0) + 1;
      totals.inputTokens += item.inputTokens || 0;
      totals.outputTokens += item.outputTokens || 0;
      totals.cachedInputTokens += item.cachedInputTokens || 0;
      totals.reasoningTokens += item.reasoningTokens || 0;
      totals.totalTokens += item.totalTokens ?? ((item.inputTokens || 0) + (item.outputTokens || 0));
      totals.returnedCostUsd += item.costUsd || 0;
      totals.estimatedCostUsd += item.estimatedCostUsd || 0;
      totals.voiceCharacters += item.characters || 0;
      totals.audioSeconds += item.audioSeconds || 0;
    }
  } catch { /* An empty ledger has zero recorded requests. */ }
  return { ...totals, providers, scope: 'Requests recorded since this runtime started (isolate-local on Workers). Returned provider costs and estimates are separate; development chat tokens excluded.', billingUnitsUnavailable: ['ElevenLabs billed credits (key lacks user_read)'] };
}
