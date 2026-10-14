import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@/mock/seed';
import {
  applyPairEnabled,
  applyQuoteSource,
  applySourceEnabled,
  enabledSources,
  pairOptionsForSource,
  quoteSourceChangeDetail,
} from '@/utils/source';

describe('数据源文案', () => {
  it('更改报价数据源记录从哪一路改到哪一路', () => {
    expect(quoteSourceChangeDetail('reuters', 'investing')).toBe(
      '报价数据源由 Reuters 改为 英为财经，已生成报价不变，下次报价起生效',
    );
    expect(quoteSourceChangeDetail('investing', 'reuters')).toBe(
      '报价数据源由 英为财经 改为 Reuters，已生成报价不变，下次报价起生效',
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

});
