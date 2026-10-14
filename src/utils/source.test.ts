import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@/mock/seed';
import {
  applyDueQuoteSources,
  applyPairEnabled,
  applyPendingQuoteSourceDetail,
  applyQuoteSource,
  applySourceEnabled,
  cancelPendingQuoteSourceDetail,
  enabledSources,
  pairOptionsForSource,
  pendingQuoteSourceDetail,
  quoteSourceChangeDetail,
  scheduleQuoteSource,
} from '@/utils/source';

describe('数据源文案', () => {
  it('更改报价数据源记录从哪一路改到哪一路', () => {
    expect(quoteSourceChangeDetail('reuters', 'investing')).toBe('报价数据源由 Reuters 改为 英为财经');
    expect(quoteSourceChangeDetail('investing', 'reuters')).toBe('报价数据源由 英为财经 改为 Reuters');
    expect(quoteSourceChangeDetail('reuters', 'investing', '2026-08-19')).toBe(
      '自 2026-08-19 起报价数据源由 Reuters 改为 英为财经',
    );
    expect(pendingQuoteSourceDetail('reuters', 'investing', '2026-08-19')).toBe(
      '预约自 2026-08-19 起报价数据源由 Reuters 改为 英为财经',
    );
    expect(applyPendingQuoteSourceDetail('reuters', 'investing', '2026-08-19')).toBe(
      '自 2026-08-19 起报价数据源由 Reuters 改为 英为财经',
    );
    expect(cancelPendingQuoteSourceDetail('investing', '2026-08-19')).toBe(
      '取消预约：原定 2026-08-19 改为 英为财经',
    );
  });
});

describe('货币对与数据源', () => {
  it('已接入且启用的数据源都会出报价', () => {
    const snapshot = createInitialSnapshot();
    expect(enabledSources(snapshot.pairs[0])).toEqual(['reuters']);
  });

  it('货币对选项可按数据来源收窄', () => {
    const snapshot = createInitialSnapshot();
    const all = pairOptionsForSource(snapshot.pairs);
    const reuters = pairOptionsForSource(snapshot.pairs, 'reuters');
    expect(all).toHaveLength(snapshot.pairs.length);
    expect(reuters).toHaveLength(snapshot.pairs.length);
  });

  it('停用货币对时已接入的各数据源一并停报', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY');
    expect(pair).toBeDefined();
    const off = applyPairEnabled(pair!, false, '2026-08-18 12:00:00');

    expect(off.enabled).toBe(false);
    expect(off.feeds.reuters.enabled).toBe(false);
    expect(off.feeds.investing.enabled).toBe(false);
    expect(enabledSources(off)).toEqual([]);

    const on = applyPairEnabled(off, true, '2026-08-18 12:01:00');
    expect(on.enabled).toBe(true);
    expect(enabledSources(on)).toEqual(['reuters']);
    expect(on.feeds.investing.enabled).toBe(false);
  });

  it('每个货币对只能选一个数据源出报价', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY');
    expect(pair).toBeDefined();
    const next = applyQuoteSource(pair!, 'investing', '2026-08-18 12:00:00');

    expect(next.quoteSource).toBe('investing');
    expect(next.feeds.investing.enabled).toBe(true);
    expect(next.feeds.reuters.enabled).toBe(false);
    expect(enabledSources(next)).toEqual(['investing']);
  });

  it('关掉当前报价源后货币对停用', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY');
    expect(pair).toBeDefined();
    const next = applySourceEnabled(pair!, 'reuters', false, '2026-08-18 12:00:00');

    expect(next.feeds.reuters.enabled).toBe(false);
    expect(next.feeds.investing.enabled).toBe(false);
    expect(next.enabled).toBe(false);
    expect(enabledSources(next)).toEqual([]);
  });

  it('预约未来报价日只记下待切换，当天数据源不变', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY');
    expect(pair).toBeDefined();
    const scheduled = scheduleQuoteSource(pair!, 'investing', '2026-08-19', '2026-08-18', '2026-08-18 12:00:00');

    expect(scheduled.applied).toBe(false);
    expect(scheduled.pair.quoteSource).toBe('reuters');
    expect(scheduled.pair.feeds.reuters.enabled).toBe(true);
    expect(scheduled.pair.feeds.investing.enabled).toBe(false);
    expect(scheduled.pair.pendingQuoteSource).toBe('investing');
    expect(scheduled.pair.pendingEffectiveDate).toBe('2026-08-19');
    expect(scheduled.pair.quoteSourceEffectiveDate).toBeUndefined();
  });

  it('手填当前报价日立即切换并清掉预约', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY');
    expect(pair).toBeDefined();
    const pending = scheduleQuoteSource(pair!, 'investing', '2026-08-19', '2026-08-18', '2026-08-18 12:00:00').pair;
    const applied = scheduleQuoteSource(pending, 'investing', '2026-08-18', '2026-08-18', '2026-08-18 12:01:00');

    expect(applied.applied).toBe(true);
    expect(applied.pair.quoteSource).toBe('investing');
    expect(applied.pair.feeds.investing.enabled).toBe(true);
    expect(applied.pair.feeds.reuters.enabled).toBe(false);
    expect(applied.pair.pendingQuoteSource).toBeUndefined();
    expect(applied.pair.pendingEffectiveDate).toBeUndefined();
    expect(applied.pair.quoteSourceEffectiveDate).toBe('2026-08-18');
  });

  it('到期日到达后才把预约数据源落到当天报价', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY');
    expect(pair).toBeDefined();
    const pending = scheduleQuoteSource(pair!, 'investing', '2026-08-19', '2026-08-18', '2026-08-18 12:00:00').pair;

    const notDue = applyDueQuoteSources([pending], '2026-08-18', '2026-08-18 18:00:00');
    expect(notDue.applied).toEqual([]);
    expect(notDue.pairs[0].quoteSource).toBe('reuters');
    expect(notDue.pairs[0].pendingQuoteSource).toBe('investing');

    const due = applyDueQuoteSources([pending], '2026-08-19', '2026-08-19 06:00:00');
    expect(due.applied).toEqual([
      {
        pairId: 'USDCNY',
        pairLabel: pair!.pairLabel,
        from: 'reuters',
        to: 'investing',
        effectiveDate: '2026-08-19',
      },
    ]);
    expect(due.pairs[0].quoteSource).toBe('investing');
    expect(due.pairs[0].pendingQuoteSource).toBeUndefined();
    expect(due.pairs[0].quoteSourceEffectiveDate).toBe('2026-08-19');
    expect(enabledSources(due.pairs[0])).toEqual(['investing']);
  });
});
