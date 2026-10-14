import { RATE_SOURCE_LABEL } from '@/constants';
import {
  RATE_SOURCE_IDS,
  type DailyBar,
  type FxPairState,
  type RateSource,
  type SourceFeed,
} from '@/types';

export function quoteFeed(pair: Pick<FxPairState, 'feeds' | 'quoteSource'>): SourceFeed {
  return pair.feeds[pair.quoteSource];
}

export function quoteHistory(pair: Pick<FxPairState, 'feeds' | 'quoteSource'>): DailyBar[] {
  return quoteFeed(pair).history;
}

export function sourceHistory(pair: Pick<FxPairState, 'feeds'>, source: RateSource): DailyBar[] {
  return pair.feeds[source].history;
}

export function connectedSources(pair: Pick<FxPairState, 'feeds'>): RateSource[] {
  return RATE_SOURCE_IDS.filter((source) => pair.feeds[source].connected);
}

export function enabledSources(pair: Pick<FxPairState, 'feeds'>): RateSource[] {
  return RATE_SOURCE_IDS.filter((source) => pair.feeds[source].connected && pair.feeds[source].enabled);
}

export function applySourceEnabled(
  pair: FxPairState,
  source: RateSource,
  enabled: boolean,
  updatedAt: string,
): FxPairState {
  const feed = pair.feeds[source];
  if (!feed.connected || feed.enabled === enabled) return pair;
  const nextFeeds = {
    ...pair.feeds,
    [source]: {
      ...feed,
      enabled,
      configUpdatedAt: updatedAt,
    },
  };
  return {
    ...pair,
    feeds: nextFeeds,
    enabled: enabledSources({ feeds: nextFeeds }).length > 0,
    configUpdatedAt: updatedAt,
  };
}

export function applyQuoteSource(
  pair: FxPairState,
  source: RateSource,
  updatedAt: string,
  effectiveDate?: string,
): FxPairState {
  if (!pair.feeds[source]?.connected) return pair;
  const quoting = pair.enabled;
  let next: FxPairState = { ...pair, quoteSource: source, configUpdatedAt: updatedAt };
  for (const item of connectedSources(pair)) {
    next = applySourceEnabled(next, item, quoting && item === source, updatedAt);
  }
  return {
    ...next,
    quoteSource: source,
    quoteSourceEffectiveDate: effectiveDate ?? pair.quoteSourceEffectiveDate,
    pendingQuoteSource: undefined,
    pendingEffectiveDate: undefined,
    configUpdatedAt: updatedAt,
  };
}

export interface DueQuoteSourceSwitch {
  pairId: string;
  pairLabel: string;
  from: RateSource;
  to: RateSource;
  effectiveDate: string;
}

export function scheduleQuoteSource(
  pair: FxPairState,
  source: RateSource,
  effectiveDate: string,
  asOfDate: string | undefined,
  updatedAt: string,
): { pair: FxPairState; applied: boolean } {
  if (!pair.feeds[source]?.connected) return { pair, applied: false };
  if (source === pair.quoteSource) {
    return {
      pair: {
        ...pair,
        pendingQuoteSource: undefined,
        pendingEffectiveDate: undefined,
        configUpdatedAt: updatedAt,
      },
      applied: false,
    };
  }
  if (asOfDate && effectiveDate <= asOfDate) {
    return { pair: applyQuoteSource(pair, source, updatedAt, effectiveDate), applied: true };
  }
  return {
    pair: {
      ...pair,
      pendingQuoteSource: source,
      pendingEffectiveDate: effectiveDate,
      configUpdatedAt: updatedAt,
    },
    applied: false,
  };
}

export function applyDueQuoteSources(
  pairs: FxPairState[],
  asOfDate: string | undefined,
  updatedAt: string,
): { pairs: FxPairState[]; applied: DueQuoteSourceSwitch[] } {
  if (!asOfDate) return { pairs, applied: [] };
  const applied: DueQuoteSourceSwitch[] = [];
  const next = pairs.map((pair) => {
    if (!pair.pendingQuoteSource || !pair.pendingEffectiveDate) return pair;
    if (pair.pendingEffectiveDate > asOfDate) return pair;
    applied.push({
      pairId: pair.id,
      pairLabel: pair.pairLabel,
      from: pair.quoteSource,
      to: pair.pendingQuoteSource,
      effectiveDate: pair.pendingEffectiveDate,
    });
    return applyQuoteSource(pair, pair.pendingQuoteSource, updatedAt, pair.pendingEffectiveDate);
  });
  return { pairs: next, applied };
}

export function pendingQuoteSourceDetail(from: RateSource, to: RateSource, effectiveDate: string): string {
  return `预约自 ${effectiveDate} 起报价数据源由 ${RATE_SOURCE_LABEL[from]} 改为 ${RATE_SOURCE_LABEL[to]}`;
}

export function applyPendingQuoteSourceDetail(from: RateSource, to: RateSource, effectiveDate: string): string {
  return `自 ${effectiveDate} 起报价数据源由 ${RATE_SOURCE_LABEL[from]} 改为 ${RATE_SOURCE_LABEL[to]}`;
}

export function cancelPendingQuoteSourceDetail(to: RateSource, effectiveDate: string): string {
  return `取消预约：原定 ${effectiveDate} 改为 ${RATE_SOURCE_LABEL[to]}`;
}

export function applyPairEnabled(pair: FxPairState, enabled: boolean, updatedAt: string): FxPairState {
  if (enabled) {
    const source = pair.feeds[pair.quoteSource]?.connected ? pair.quoteSource : connectedSources(pair)[0];
    if (!source) return pair;
    return applyQuoteSource({ ...pair, enabled: true }, source, updatedAt);
  }
  return connectedSources(pair).reduce(
    (next, source) => applySourceEnabled(next, source, false, updatedAt),
    pair,
  );
}

export function pairOptionsForSource(
  pairs: Array<Pick<FxPairState, 'pair' | 'pairLabel' | 'feeds'>>,
  source?: RateSource,
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const pair of pairs) {
    if (source && !pair.feeds[source].connected) continue;
    seen.set(pair.pair, pair.pairLabel);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}

export function quoteSourceChangeDetail(from: RateSource, to: RateSource, effectiveDate?: string): string {
  if (effectiveDate) {
    return `自 ${effectiveDate} 起报价数据源由 ${RATE_SOURCE_LABEL[from]} 改为 ${RATE_SOURCE_LABEL[to]}`;
  }
  return `报价数据源由 ${RATE_SOURCE_LABEL[from]} 改为 ${RATE_SOURCE_LABEL[to]}`;
}
