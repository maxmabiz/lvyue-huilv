import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import { CURRENT_OPERATOR, HISTORY_CALENDAR_DAYS, HISTORY_SEED_DAYS } from '@/constants';
import type {
  AppSnapshot,
  BufferConfig,
  ConfigChangeLog,
  DateRange,
  EnrichedPair,
  FxPairState,
  OfficialQuote,
  PairConfigInput,
  RateDailyRow,
  RateSource,
  SourceFeed,
} from '@/types';
import { RATE_SOURCE_IDS } from '@/types';
import { createInitialSnapshot, createConfiguredPair, mockBarForDate } from '@/mock/seed';
import { calendarDaysInRange, lastNCalendarDays, nowText, tradingBars } from '@/utils/date';
import { openQuoteDate, rebuildOpenDayQuotes, buildOfficialQuote, upsertQuote } from '@/utils/officialQuote';
import { applyGlobalBuffer } from '@/utils/buffer';
import {
  averageFromHistory,
  barHasVolatilityWarning,
  computeQuotes,
  tradingDayChangeRatio,
} from '@/utils/rateCalc';
import { buildChangeLog, pairStatusChangeAction, pairStatusChangeDetail } from '@/utils/changeLog';
import {
  applyPairEnabled,
  applyQuoteSource,
  connectedSources,
  enabledSources,
  quoteFeed,
  quoteSourceChangeDetail,
} from '@/utils/source';

interface RateStoreValue {
  sourceSync: AppSnapshot['sourceSync'];
  lastCalculatedAt: string;
  globalBuffer: BufferConfig;
  pairs: EnrichedPair[];
  officialQuotes: OfficialQuote[];
  changeLogs: ConfigChangeLog[];
  unlockedQuoteDate?: string;
  dailyRows: RateDailyRow[];
  syncing: boolean;
  calculating: boolean;
  syncAll: (range: DateRange, sources: RateSource[]) => Promise<{ ok: boolean; error?: string }>;
  recalculate: () => void;
  saveGlobalBuffer: (config: BufferConfig) => void;
  savePairBuffer: (id: string, source: RateSource, config: BufferConfig) => void;
  restorePairBuffer: (id: string, source: RateSource) => void;
  addPair: (input: PairConfigInput) => { ok: boolean; error?: string };
  setPairEnabled: (id: string, enabled: boolean) => { ok: boolean; error?: string };
  setQuoteSource: (id: string, source: RateSource) => { ok: boolean; error?: string };
}

const RateStoreContext = createContext<RateStoreValue | null>(null);

function enrich(pair: FxPairState, globalBuffer: BufferConfig): EnrichedPair {
  const feed = quoteFeed(pair);
  const quotes = computeQuotes(tradingBars(feed.history), globalBuffer);
  return {
    ...pair,
    ...quotes,
    updateDate: feed.dataDate,
  };
}

function historyEndingAt(history: SourceFeed['history'], dataDate: string) {
  return tradingBars(history.filter((bar) => bar.date <= dataDate));
}

export function flattenDailyRows(pairs: EnrichedPair[]): RateDailyRow[] {
  const rows: RateDailyRow[] = [];
  for (const pair of pairs) {
    for (const source of RATE_SOURCE_IDS) {
      const feed = pair.feeds[source];
      if (!feed.history.length) continue;
      const sorted = [...feed.history].sort((a, b) => a.date.localeCompare(b.date));
      const displayStart = lastNCalendarDays(feed.dataDate || sorted[sorted.length - 1].date, HISTORY_CALENDAR_DAYS)[0];
      const visible = sorted.filter((bar) => bar.date >= displayStart);
      visible.forEach((bar) => {
        const change = tradingDayChangeRatio(sorted, bar.date, bar.close);
        rows.push({
          id: `${pair.id}-${source}-${bar.date}`,
          pairId: pair.id,
          pair: pair.pair,
          pairLabel: pair.pairLabel,
          source,
          sourceCode: feed.code,
          dataDate: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          changeRatio: change ? change.toFixed(8) : null,
          latestMarketRate: bar.close,
          lastSyncAt: feed.lastSyncAt,
          syncStatus: feed.syncStatus,
          hasVolatilityWarning: barHasVolatilityWarning(sorted, bar.date, bar.close),
          history: historyEndingAt(sorted, bar.date),
        });
      });
    }
  }
  return rows.sort(
    (a, b) =>
      b.dataDate.localeCompare(a.dataDate) ||
      a.pair.localeCompare(b.pair) ||
      a.source.localeCompare(b.source),
  );
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function applySuccessfulSync(feed: SourceFeed, syncedAt: string, rangeDays: string[]): SourceFeed {
  const baseAvg = averageFromHistory(tradingBars(feed.history));
  const byDate = new Map(feed.history.map((bar) => [bar.date, bar]));
  for (const date of rangeDays) {
    byDate.set(date, mockBarForDate(date, baseAvg));
  }
  const history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_SEED_DAYS);
  const latestBar = history[history.length - 1];
  return {
    ...feed,
    history,
    latestMarketRate: latestBar.close,
    dataDate: latestBar.date,
    lastSyncAt: syncedAt,
    syncStatus: '正常',
  };
}

function validatePairConfig(input: {
  reutersCode: string;
  investingCode: string;
  reutersConnected: boolean;
  investingConnected: boolean;
  quoteSource: RateSource;
}): { ok: true } | { ok: false; error: string } {
  if (!input.reutersConnected && !input.investingConnected) {
    return { ok: false, error: '请至少接入一个数据源' };
  }
  if (input.reutersConnected && !input.reutersCode.trim()) {
    return { ok: false, error: '请填写 Reuters 代码' };
  }
  if (input.investingConnected && !input.investingCode.trim()) {
    return { ok: false, error: '请填写英为财经代码' };
  }
  if (input.quoteSource === 'reuters' && !input.reutersConnected) {
    return { ok: false, error: '报价数据源必须是已接入的数据源' };
  }
  if (input.quoteSource === 'investing' && !input.investingConnected) {
    return { ok: false, error: '报价数据源必须是已接入的数据源' };
  }
  return { ok: true };
}

const syncFailCount: Record<RateSource, number> = {
  reuters: 0,
  investing: 0,
};

export function RateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(() => createInitialSnapshot());
  const [syncing, setSyncing] = useState(false);
  const [calculating, setCalculating] = useState(false);

  const pairs = useMemo(
    () => snapshot.pairs.map((pair) => enrich(pair, snapshot.globalBuffer)),
    [snapshot.pairs, snapshot.globalBuffer],
  );
  const dailyRows = useMemo(() => flattenDailyRows(pairs), [pairs]);

  const syncAll = useCallback(async (range: DateRange, sources: RateSource[]) => {
    if (syncing) return { ok: false, error: '正在同步中' };

    const selected = sources.filter((source) => RATE_SOURCE_IDS.includes(source));
    if (selected.length === 0) {
      return { ok: false, error: '请选择至少一个数据源' };
    }

    const enabledPairs = snapshot.pairs.filter((pair) => enabledSources(pair).length > 0);
    if (enabledPairs.length === 0) {
      return { ok: false, error: '请先启用至少一个货币对' };
    }

    const work = selected.filter((source) =>
      enabledPairs.some((pair) => pair.feeds[source].connected && pair.feeds[source].enabled),
    );
    if (work.length === 0) {
      return { ok: false, error: '所选数据源没有已接入的启用货币对' };
    }

    const rangeDays = calendarDaysInRange(range.start, range.end);
    if (rangeDays.length === 0) {
      return { ok: false, error: '请选择有效时间段' };
    }

    setSyncing(true);
    setSnapshot((prev) => ({
      ...prev,
      sourceSync: {
        ...prev.sourceSync,
        ...Object.fromEntries(
          work.map((source) => [
            source,
            { ...prev.sourceSync[source], lastSyncStatus: '同步中', lastSyncRange: range },
          ]),
        ),
      },
      pairs: prev.pairs.map((pair) => ({
        ...pair,
        feeds: {
          reuters: pair.feeds.reuters.connected && pair.feeds.reuters.enabled && work.includes('reuters')
            ? { ...pair.feeds.reuters, syncStatus: '同步中' }
            : pair.feeds.reuters,
          investing: pair.feeds.investing.connected && pair.feeds.investing.enabled && work.includes('investing')
            ? { ...pair.feeds.investing, syncStatus: '同步中' }
            : pair.feeds.investing,
        },
      })),
    }));
    await wait(1400);

    const syncedAt = nowText();
    const outcome: Record<RateSource, '正常' | '失败'> = {
      reuters: '正常',
      investing: '正常',
    };

    for (const source of work) {
      syncFailCount[source] += 1;
      outcome[source] = syncFailCount[source] % 3 === 0 ? '失败' : '正常';
    }

    const successSources = work.filter((source) => outcome[source] === '正常');
    const anyQuoteUpdated = successSources.length > 0 && snapshot.pairs.some(
      (pair) => enabledSources(pair).some((source) => successSources.includes(source)),
    );

    setSnapshot((prev) => {
      const nextPairs = prev.pairs.map((pair) => ({
        ...pair,
        feeds: {
          reuters: patchFeedAfterSync(pair, 'reuters', work, outcome, syncedAt, rangeDays),
          investing: patchFeedAfterSync(pair, 'investing', work, outcome, syncedAt, rangeDays),
        },
      }));
      const calculatedAt = anyQuoteUpdated ? nowText(dayjs().add(2, 'second')) : prev.lastCalculatedAt;
      const quotePairIds = anyQuoteUpdated
        ? nextPairs
            .filter((pair) =>
              enabledSources(pair).some((source) => successSources.includes(source)),
            )
            .map((pair) => pair.id)
        : [];
      return {
        ...prev,
        lastCalculatedAt: prev.lastCalculatedAt,
        sourceSync: {
          ...prev.sourceSync,
          ...Object.fromEntries(
            work.map((source) => [
              source,
              {
                lastSyncAt: syncedAt,
                lastSyncStatus: outcome[source],
                lastSyncRange: range,
              },
            ]),
          ),
        },
        pairs: nextPairs,
        officialQuotes: quotePairIds.length
          ? rebuildOpenDayQuotes(
              nextPairs,
              prev.officialQuotes,
              calculatedAt,
              quotePairIds,
              prev.globalBuffer,
              true,
              successSources,
            )
          : prev.officialQuotes,
      };
    });
    setSyncing(false);

    if (work.every((source) => outcome[source] === '失败')) {
      return { ok: false };
    }
    if (work.some((source) => outcome[source] === '失败')) {
      return { ok: false, error: '部分数据源同步失败' };
    }
    return { ok: true };
  }, [syncing, snapshot.pairs]);

  const recalculate = useCallback(() => {
    setCalculating(true);
    window.setTimeout(() => {
      setSnapshot((prev) => {
        const calculatedAt = nowText();
        return {
          ...prev,
          lastCalculatedAt: calculatedAt,
          officialQuotes: rebuildOpenDayQuotes(
            prev.pairs,
            prev.officialQuotes,
            calculatedAt,
            undefined,
            prev.globalBuffer,
            true,
          ),
        };
      });
      setCalculating(false);
    }, 400);
  }, []);

  const saveGlobalBuffer = useCallback((config: BufferConfig) => {
    setSnapshot((prev) => ({
      ...prev,
      globalBuffer: config,
      pairs: applyGlobalBuffer(prev.pairs, config),
    }));
  }, []);

  const savePairBuffer = useCallback((id: string, source: RateSource, config: BufferConfig) => {
    setSnapshot((prev) => {
      const unlocked = openQuoteDate(prev.pairs);
      const pair = prev.pairs.find((item) => item.id === id);
      if (!unlocked || !pair?.feeds[source]?.enabled) return prev;
      const calculatedAt = nowText();
      return {
        ...prev,
        officialQuotes: upsertQuote(
          prev.officialQuotes,
          buildOfficialQuote(pair, unlocked, calculatedAt, config, true, source),
        ),
      };
    });
  }, []);

  const restorePairBuffer = useCallback((id: string, source: RateSource) => {
    setSnapshot((prev) => {
      const unlocked = openQuoteDate(prev.pairs);
      const pair = prev.pairs.find((item) => item.id === id);
      if (!unlocked || !pair?.feeds[source]?.enabled) return prev;
      const calculatedAt = nowText();
      return {
        ...prev,
        officialQuotes: upsertQuote(
          prev.officialQuotes,
          buildOfficialQuote(pair, unlocked, calculatedAt, prev.globalBuffer, false, source),
        ),
      };
    });
  }, []);

  const addPair = useCallback((input: PairConfigInput) => {
    const currency1 = input.currency1.trim().toUpperCase();
    const currency2 = input.currency2.trim().toUpperCase();
    if (!currency1 || !currency2) return { ok: false, error: '请选择基准货币和计价货币' };
    if (currency1 === currency2) return { ok: false, error: '基准货币和计价货币不能相同' };

    const checked = validatePairConfig(input);
    if (!checked.ok) return checked;

    const id = `${currency1}${currency2}`;
    const exists = snapshot.pairs.some((pair) => pair.id === id);
    if (exists) return { ok: false, error: '该货币对已存在，可直接启用' };

    const reutersCode = input.reutersCode.trim();
    const investingCode = input.investingCode.trim();
    if (input.reutersConnected && snapshot.pairs.some((pair) => pair.feeds.reuters.code === reutersCode)) {
      return { ok: false, error: 'Reuters 代码已被其他货币对使用' };
    }
    if (input.investingConnected && snapshot.pairs.some((pair) => pair.feeds.investing.code === investingCode)) {
      return { ok: false, error: '英为财经代码已被其他货币对使用' };
    }

    setSnapshot((prev) => {
      const calculatedAt = nowText();
      const nextPairs = [
        ...prev.pairs,
        createConfiguredPair(
          {
            currency1,
            currency2,
            reutersCode,
            investingCode,
            reutersConnected: input.reutersConnected,
            investingConnected: input.investingConnected,
            quoteSource: input.quoteSource,
          },
          prev.globalBuffer,
          calculatedAt,
        ),
      ];
      return {
        ...prev,
        pairs: nextPairs,
        officialQuotes: rebuildOpenDayQuotes(nextPairs, prev.officialQuotes, calculatedAt, [id], prev.globalBuffer),
      };
    });
    return { ok: true };
  }, [snapshot.pairs]);

  const setPairEnabled = useCallback((id: string, enabled: boolean) => {
    const target = snapshot.pairs.find((pair) => pair.id === id);
    if (!target) return { ok: false, error: '货币对不存在' };
    const connected = connectedSources(target);
    if (!connected.length) return { ok: false, error: '该货币对未接入数据源' };
    const quoting = enabledSources(target);
    const already = enabled
      ? Boolean(target.enabled && quoting.length === 1 && quoting[0] === target.quoteSource)
      : !target.enabled && quoting.length === 0;
    if (already) return { ok: true };

    setSnapshot((prev) => {
      const pair = prev.pairs.find((item) => item.id === id);
      if (!pair) return prev;
      const sources = connectedSources(pair);
      if (!sources.length) return prev;
      const current = enabledSources(pair);
      const unchanged = enabled
        ? Boolean(pair.enabled && current.length === 1 && current[0] === pair.quoteSource)
        : !pair.enabled && current.length === 0;
      if (unchanged) return prev;
      const calculatedAt = nowText();
      const nextPair = applyPairEnabled(pair, enabled, calculatedAt);
      const nextPairs = prev.pairs.map((item) => (item.id === id ? nextPair : item));
      const log = buildChangeLog({
        pairId: id,
        pairLabel: pair.pairLabel,
        action: pairStatusChangeAction(enabled),
        detail: pairStatusChangeDetail(enabled),
        changedAt: calculatedAt,
        operator: CURRENT_OPERATOR,
      });
      return {
        ...prev,
        lastCalculatedAt: prev.lastCalculatedAt,
        pairs: nextPairs,
        officialQuotes: enabled
          ? rebuildOpenDayQuotes(nextPairs, prev.officialQuotes, calculatedAt, [id], prev.globalBuffer)
          : prev.officialQuotes,
        changeLogs: [log, ...prev.changeLogs],
      };
    });
    return { ok: true };
  }, [snapshot.pairs]);

  const setQuoteSource = useCallback((id: string, source: RateSource) => {
    const target = snapshot.pairs.find((pair) => pair.id === id);
    if (!target) return { ok: false, error: '货币对不存在' };
    if (!target.feeds[source]?.connected) return { ok: false, error: '该货币对未接入此数据源' };
    if (target.quoteSource === source) return { ok: true };

    setSnapshot((prev) => {
      const pair = prev.pairs.find((item) => item.id === id);
      if (!pair || !pair.feeds[source]?.connected || pair.quoteSource === source) return prev;
      const calculatedAt = nowText();
      const from = pair.quoteSource;
      const nextPair = applyQuoteSource(pair, source, calculatedAt);
      const nextPairs = prev.pairs.map((item) => (item.id === id ? nextPair : item));
      const log = buildChangeLog({
        pairId: id,
        pairLabel: pair.pairLabel,
        source,
        action: '更改数据源',
        detail: quoteSourceChangeDetail(from, source),
        changedAt: calculatedAt,
        operator: CURRENT_OPERATOR,
      });
      return {
        ...prev,
        lastCalculatedAt: prev.lastCalculatedAt,
        pairs: nextPairs,
        officialQuotes: prev.officialQuotes,
        changeLogs: [log, ...prev.changeLogs],
      };
    });
    return { ok: true };
  }, [snapshot.pairs]);

  const unlockedQuoteDate = useMemo(() => openQuoteDate(snapshot.pairs), [snapshot.pairs]);

  const value = useMemo<RateStoreValue>(
    () => ({
      sourceSync: snapshot.sourceSync,
      lastCalculatedAt: snapshot.lastCalculatedAt,
      globalBuffer: snapshot.globalBuffer,
      pairs,
      officialQuotes: snapshot.officialQuotes,
      changeLogs: snapshot.changeLogs,
      unlockedQuoteDate,
      dailyRows,
      syncing,
      calculating,
      syncAll,
      recalculate,
      saveGlobalBuffer,
      savePairBuffer,
      restorePairBuffer,
      addPair,
      setPairEnabled,
      setQuoteSource,
    }),
    [
      snapshot.sourceSync,
      snapshot.lastCalculatedAt,
      snapshot.globalBuffer,
      snapshot.officialQuotes,
      snapshot.changeLogs,
      unlockedQuoteDate,
      pairs,
      dailyRows,
      syncing,
      calculating,
      syncAll,
      recalculate,
      saveGlobalBuffer,
      savePairBuffer,
      restorePairBuffer,
      addPair,
      setPairEnabled,
      setQuoteSource,
    ],
  );

  return <RateStoreContext.Provider value={value}>{children}</RateStoreContext.Provider>;
}

function patchFeedAfterSync(
  pair: FxPairState,
  source: RateSource,
  work: RateSource[],
  outcome: Record<RateSource, '正常' | '失败'>,
  syncedAt: string,
  rangeDays: string[],
): SourceFeed {
  const feed = pair.feeds[source];
  if (!work.includes(source) || !feed.connected || !feed.enabled) return feed;
  if (outcome[source] === '失败') {
    return { ...feed, lastSyncAt: syncedAt, syncStatus: '失败' };
  }
  return applySuccessfulSync(feed, syncedAt, rangeDays);
}

export function useRateStore() {
  const ctx = useContext(RateStoreContext);
  if (!ctx) {
    throw new Error('useRateStore 必须在 RateProvider 内使用');
  }
  return ctx;
}
