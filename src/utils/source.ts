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

export function applyQuoteSource(pair: FxPairState, source: RateSource, updatedAt: string): FxPairState {
  if (!pair.feeds[source]?.connected) return pair;
  const quoting = pair.enabled;
  let next: FxPairState = { ...pair, quoteSource: source, configUpdatedAt: updatedAt };
  for (const item of connectedSources(pair)) {
    next = applySourceEnabled(next, item, quoting && item === source, updatedAt);
  }
  return {
    ...next,
    quoteSource: source,
    configUpdatedAt: updatedAt,
  };
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

export function quoteSourceChangeDetail(from: RateSource, to: RateSource): string {
  return `报价数据源由 ${RATE_SOURCE_LABEL[from]} 改为 ${RATE_SOURCE_LABEL[to]}，已生成报价不变，下次报价起生效`;
}
