import { describe, expect, it } from 'vitest';
import { HISTORY_CALENDAR_DAYS, INITIAL_DATA_DATE } from '@/constants';
import { isTradingDay, lastNCalendarDays } from '@/utils/date';
import { createInitialSnapshot } from '@/mock/seed';
import {
  firstQuoteDate,
  isQuoteLocked,
  openQuoteDate,
  rebuildOpenDayQuotes,
  seedOfficialQuotes,
} from '@/utils/officialQuote';

describe('官方报价按日冻结', () => {
  it('初始快照按可见窗口交易日存档', () => {
    const snapshot = createInitialSnapshot();
    const tradingDays = lastNCalendarDays(INITIAL_DATA_DATE, HISTORY_CALENDAR_DAYS).filter(isTradingDay);

    expect(openQuoteDate(snapshot.pairs)).toBe('2026-08-18');
    expect(snapshot.officialQuotes).toHaveLength(snapshot.pairs.length * tradingDays.length);
    expect(tradingDays[tradingDays.length - 1]).toBe('2026-08-18');
    expect(snapshot.officialQuotes.every((quote) => tradingDays.includes(quote.quoteDate))).toBe(true);
    expect(snapshot.officialQuotes.filter((quote) => quote.quoteDate === '2026-08-18')).toHaveLength(8);
    expect(isQuoteLocked('2026-08-17', '2026-08-18')).toBe(true);
    expect(isQuoteLocked('2026-08-18', '2026-08-18')).toBe(false);
  });

  it('改缓冲只重写未锁定日，历史报价保持快照', () => {
    const snapshot = createInitialSnapshot();
    const locked = snapshot.officialQuotes.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-17' && quote.quoteSource === 'reuters',
    );
    const open = snapshot.officialQuotes.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18' && quote.quoteSource === 'reuters',
    );
    expect(locked).toBeDefined();
    expect(open).toBeDefined();

    const nextPairs = snapshot.pairs.map((pair) => ({
      ...pair,
      volatilityBuffer: '0.10',
      fee: '0.05',
    }));
    const next = rebuildOpenDayQuotes(nextPairs, snapshot.officialQuotes, '2026-08-18 12:00:00');

    const lockedAfter = next.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-17' && quote.quoteSource === 'reuters',
    );
    const openAfter = next.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18' && quote.quoteSource === 'reuters',
    );

    expect(lockedAfter).toMatchObject({
      quoteCcy1: locked?.quoteCcy1,
      quoteCcy2: locked?.quoteCcy2,
      combinedBuffer: locked?.combinedBuffer,
      calculatedAt: locked?.calculatedAt,
    });
    expect(openAfter?.combinedBuffer).toBe('0.1500');
    expect(openAfter?.quoteCcy1).not.toBe(open?.quoteCcy1);
    expect(openAfter?.calculatedAt).toBe('2026-08-18 12:00:00');
    expect(next.filter((quote) => quote.quoteDate !== '2026-08-18')).toEqual(
      snapshot.officialQuotes.filter((quote) => quote.quoteDate !== '2026-08-18'),
    );
  });

  it('重新计算只更新最新报价日', () => {
    const snapshot = createInitialSnapshot();
    const next = rebuildOpenDayQuotes(snapshot.pairs, snapshot.officialQuotes, '2026-08-18 15:30:00');
    const latest = next.filter((quote) => quote.quoteDate === '2026-08-18');
    const history = next.filter((quote) => quote.quoteDate !== '2026-08-18');

    expect(latest.every((quote) => quote.calculatedAt === '2026-08-18 15:30:00')).toBe(true);
    expect(history).toEqual(snapshot.officialQuotes.filter((quote) => quote.quoteDate !== '2026-08-18'));
  });

  it('停用货币对时保留已存档报价', () => {
    const snapshot = createInitialSnapshot();
    const quotes = seedOfficialQuotes(snapshot.pairs);
    const disabled = snapshot.pairs.map((pair) =>
      pair.id === 'USDCNY' ? { ...pair, enabled: false } : pair,
    );
    const next = rebuildOpenDayQuotes(disabled, quotes, '2026-08-18 16:00:00');
    expect(next.some((quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18')).toBe(true);
    expect(next.find((quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-17')?.calculatedAt).toBe(
      quotes.find((quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-17')?.calculatedAt,
    );
    expect(firstQuoteDate(next, 'USDCNY')).toBe('2026-08-10');
  });

  it('首次报价日取该对已存档官方报价中最早的行情日', () => {
    const snapshot = createInitialSnapshot();
    expect(firstQuoteDate(snapshot.officialQuotes, 'USDCNY')).toBe('2026-08-10');
    expect(firstQuoteDate(snapshot.officialQuotes, 'USDCNY', 'reuters')).toBe('2026-08-10');
    expect(firstQuoteDate(snapshot.officialQuotes, 'EURUSD')).toBe('2026-08-10');
    expect(firstQuoteDate([], 'USDCNY')).toBeUndefined();
  });

  it('每个货币对当天只出选定数据源的报价', () => {
    const snapshot = createInitialSnapshot();
    const usdcnyOpen = snapshot.officialQuotes.filter(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18',
    );
    const sources = usdcnyOpen.map((quote) => quote.quoteSource).sort();

    expect(sources).toEqual(['reuters']);
    expect(new Set(usdcnyOpen.map((quote) => quote.id)).size).toBe(1);
    expect(
      snapshot.officialQuotes.every((quote) => quote.id === `${quote.pairId}-${quote.quoteSource}-${quote.quoteDate}`),
    ).toBe(true);
  });
});
