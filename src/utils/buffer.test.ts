import { describe, expect, it } from 'vitest';
import { createInitialSnapshot } from '@/mock/seed';
import { applyGlobalBuffer, customDayQuoteCount, openDayFollowerPairIds } from '@/utils/buffer';
import { buildOfficialQuote, rebuildOpenDayQuotes, upsertQuote } from '@/utils/officialQuote';

describe('全局默认 + 当天例外缓冲', () => {
  it('种子报价默认不是当天例外', () => {
    const snapshot = createInitialSnapshot();
    expect(snapshot.officialQuotes.every((quote) => quote.bufferCustom === false)).toBe(true);
    expect(customDayQuoteCount(snapshot.officialQuotes, '2026-08-18')).toBe(0);
  });

  it('单独配置只改当天有效报价，不改货币对、不改历史日', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY');
    expect(pair).toBeDefined();
    const custom = { volatilityBuffer: '0.10', fee: '0.05' };
    const afterCustom = upsertQuote(
      snapshot.officialQuotes,
      buildOfficialQuote(pair!, '2026-08-18', '2026-08-18 10:00:00', custom, true, 'reuters'),
    );
    const usdOpen = afterCustom.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18' && quote.quoteSource === 'reuters',
    );
    const usdInvesting = afterCustom.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18' && quote.quoteSource === 'investing',
    );
    const usdLocked = afterCustom.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-17' && quote.quoteSource === 'reuters',
    );

    expect(usdOpen).toMatchObject({
      combinedBuffer: '0.1500',
      bufferCustom: true,
      calculatedAt: '2026-08-18 10:00:00',
    });
    expect(usdInvesting).toEqual(
      snapshot.officialQuotes.find(
        (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18' && quote.quoteSource === 'investing',
      ),
    );
    expect(usdLocked).toEqual(
      snapshot.officialQuotes.find(
        (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-17' && quote.quoteSource === 'reuters',
      ),
    );
    expect(pair).toMatchObject({
      volatilityBuffer: snapshot.globalBuffer.volatilityBuffer,
      fee: snapshot.globalBuffer.fee,
    });
  });

  it('重算只更新当天跟随项，不覆盖当天例外，也不改历史日', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY')!;
    const custom = { volatilityBuffer: '0.10', fee: '0.05' };
    const afterCustom = upsertQuote(
      snapshot.officialQuotes,
      buildOfficialQuote(pair, '2026-08-18', '2026-08-18 10:00:00', custom, true, 'reuters'),
    );

    const nextGlobal = { volatilityBuffer: '0.08', fee: '0.02' };
    const nextPairs = applyGlobalBuffer(snapshot.pairs, nextGlobal);
    const followerIds = openDayFollowerPairIds(nextPairs, afterCustom, '2026-08-18');
    expect(followerIds).not.toContain('USDCNY');
    expect(followerIds).toContain('EURUSD');
    expect(customDayQuoteCount(afterCustom, '2026-08-18')).toBe(1);

    const next = rebuildOpenDayQuotes(
      nextPairs,
      afterCustom,
      '2026-08-18 12:00:00',
      followerIds,
      nextGlobal,
      true,
    );
    const usdReuters = next.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18' && quote.quoteSource === 'reuters',
    );
    const eurOpen = next.find(
      (quote) => quote.pair === 'EURUSD' && quote.quoteDate === '2026-08-18' && quote.quoteSource === 'reuters',
    );
    const usdLocked = next.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-17' && quote.quoteSource === 'reuters',
    );

    expect(usdReuters).toMatchObject({
      combinedBuffer: '0.1500',
      bufferCustom: true,
      calculatedAt: '2026-08-18 10:00:00',
    });
    expect(eurOpen).toMatchObject({
      combinedBuffer: '0.1000',
      bufferCustom: false,
      calculatedAt: '2026-08-18 12:00:00',
    });
    expect(usdLocked).toEqual(
      snapshot.officialQuotes.find(
        (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-17' && quote.quoteSource === 'reuters',
      ),
    );
  });

  it('恢复跟随全局后当天改用全局默认，例外标记清除', () => {
    const snapshot = createInitialSnapshot();
    const pair = snapshot.pairs.find((item) => item.id === 'USDCNY')!;
    const afterCustom = upsertQuote(
      snapshot.officialQuotes,
      buildOfficialQuote(pair, '2026-08-18', '2026-08-18 10:00:00', { volatilityBuffer: '0.10', fee: '0.05' }, true, 'reuters'),
    );
    const nextGlobal = { volatilityBuffer: '0.08', fee: '0.02' };
    const next = upsertQuote(
      afterCustom,
      buildOfficialQuote(pair, '2026-08-18', '2026-08-18 12:00:00', nextGlobal, false, 'reuters'),
    );
    const usdOpen = next.find(
      (quote) => quote.pair === 'USDCNY' && quote.quoteDate === '2026-08-18' && quote.quoteSource === 'reuters',
    );
    expect(usdOpen).toMatchObject({
      combinedBuffer: '0.1000',
      bufferCustom: false,
      calculatedAt: '2026-08-18 12:00:00',
    });
  });
});
