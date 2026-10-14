import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  averageFromHistory,
  barHasVolatilityWarning,
  computeQuotes,
  dailyAverage,
  formatPercent,
  formatSignedPercent,
  hasVolatilityWarning,
  quoteForCurrency1,
  quoteForCurrency2,
  tradingDayChangeRatio,
} from './rateCalc';
import { PAIR_SEEDS, buildHistory } from '@/mock/seed';

const DEFAULT_BUFFER = { volatilityBuffer: '0.04', fee: '0.01' };

describe('履约报价汇率计算', () => {
  it('单日平均汇率 =（最高 + 最低）÷ 2', () => {
    expect(dailyAverage('6.7600', '6.7482').toFixed(4)).toBe('6.7541');
  });

  it('USD/CNY 示例：6.7541、5% → 6.4 / 7.1', () => {
    const avg7 = new Decimal('6.7541');
    const buffer = new Decimal('0.05');
    expect(quoteForCurrency1(avg7, buffer).toFixed(1)).toBe('6.4');
    expect(quoteForCurrency2(avg7, buffer).toFixed(1)).toBe('7.1');
  });

  it('向上/向下取整不是四舍五入', () => {
    const avg7 = new Decimal('1.3428');
    const buffer = new Decimal('0.05');
    expect(avg7.mul('1.05').toFixed(6)).toBe('1.409940');
    expect(quoteForCurrency2(avg7, buffer).toFixed(1)).toBe('1.5');
    expect(quoteForCurrency1(avg7, buffer).toFixed(1)).toBe('1.2');
  });

  it('Mock 八组货币对的近7日均值与报价与需求表一致', () => {
    for (const seed of PAIR_SEEDS) {
      const history = buildHistory('2026-08-07', seed.avg7);
      expect(history).toHaveLength(7);
      expect(history[0]).toEqual(expect.objectContaining({
        open: expect.any(String),
        high: expect.any(String),
        low: expect.any(String),
        close: expect.any(String),
      }));
      expect(averageFromHistory(history).toFixed(4)).toBe(seed.avg7);

      const quotes = computeQuotes(history, DEFAULT_BUFFER);
      expect(quotes.avg7).toBe(seed.avg7);
      expect(formatPercent(quotes.combinedBuffer)).toBe('5%');
      expect(quotes.quoteCcy1).toBe(seed.expectedQuote1);
      expect(quotes.quoteCcy2).toBe(seed.expectedQuote2);
    }
  });

  it('市场汇率波动达到 1% 时触发预警', () => {
    expect(hasVolatilityWarning('9.0724', '8.9600')).toBe(true);
    expect(hasVolatilityWarning('6.7541', '6.7480')).toBe(false);
  });

  it('预警对比上一交易日收盘，周末复制收盘不误报', () => {
    const bar = (date: string, close: string) => ({
      date,
      open: close,
      high: close,
      low: close,
      close,
    });
    const history = [
      bar('2026-08-13', '9.0000'),
      bar('2026-08-14', '9.1080'),
      bar('2026-08-15', '9.1080'),
      bar('2026-08-16', '9.1080'),
      bar('2026-08-17', '9.1100'),
    ];
    expect(barHasVolatilityWarning(history, '2026-08-14', '9.1080')).toBe(true);
    expect(barHasVolatilityWarning(history, '2026-08-15', '9.1080')).toBe(false);
    expect(barHasVolatilityWarning(history, '2026-08-17', '9.1100')).toBe(false);
    expect(formatSignedPercent(tradingDayChangeRatio(history, '2026-08-14', '9.1080'))).toBe('+1.20%');
    expect(formatSignedPercent(tradingDayChangeRatio(history, '2026-08-15', '9.1080'))).toBe('0.00%');
  });

  it('涨跌幅展示为带符号百分比', () => {
    expect(formatSignedPercent('0.012')).toBe('+1.20%');
    expect(formatSignedPercent('-0.0035')).toBe('-0.35%');
    expect(formatSignedPercent('0')).toBe('0.00%');
    expect(formatSignedPercent(null)).toBe('-');
  });
});

describe('汇率数据最近10天模拟', () => {
  it('列表展开为 8 个货币对 × 2 个数据源 × 10 个自然日，且包含 2026-08-18', async () => {
    const { createInitialSnapshot } = await import('@/mock/seed');
    const { tradingBars } = await import('@/utils/date');
    const { flattenDailyRows } = await import('@/store/RateStore');
    const { quoteFeed, quoteHistory } = await import('@/utils/source');

    const snapshot = createInitialSnapshot();
    const pairs = snapshot.pairs.map((pair) => {
      const feed = quoteFeed(pair);
      const quotes = computeQuotes(tradingBars(quoteHistory(pair)), {
        volatilityBuffer: pair.volatilityBuffer,
        fee: pair.fee,
      });
      return {
        ...pair,
        ...quotes,
        updateDate: feed.dataDate,
      };
    });

    const rows = flattenDailyRows(pairs);
    const dates = [...new Set(rows.map((row) => row.dataDate))].sort();

    expect(rows).toHaveLength(160);
    expect(dates[0]).toBe('2026-08-09');
    expect(dates[dates.length - 1]).toBe('2026-08-18');
    expect(rows.filter((row) => row.dataDate === '2026-08-18')).toHaveLength(16);
    expect(rows[0].dataDate).toBe('2026-08-18');

    const usdToday = rows.find((row) => row.pair === 'USDCNY' && row.dataDate === '2026-08-18' && row.source === 'reuters');
    expect(usdToday).toMatchObject({
      open: '6.7484',
      high: '6.7511',
      low: '6.7463',
      close: '6.7491',
      sourceCode: 'USDCNY=',
    });

    const usdInvesting = rows.find((row) => row.pair === 'USDCNY' && row.dataDate === '2026-08-18' && row.source === 'investing');
    expect(usdInvesting?.sourceCode).toBe('usd-cny');
    expect(usdInvesting?.close).not.toBe(usdToday?.close);

    const gbpJump = rows.find((row) => row.pair === 'GBPCNY' && row.dataDate === '2026-08-18' && row.source === 'reuters');
    expect(gbpJump?.hasVolatilityWarning).toBe(true);
    expect(formatSignedPercent(gbpJump?.changeRatio)).toBe('+1.20%');
    const usdQuiet = rows.find((row) => row.pair === 'USDCNY' && row.dataDate === '2026-08-18' && row.source === 'reuters');
    expect(usdQuiet?.hasVolatilityWarning).toBe(false);
  });

  it('新增货币对会为两路数据源生成模拟行情且默认启用', async () => {
    const { createConfiguredPair } = await import('@/mock/seed');
    const pair = createConfiguredPair(
      { currency1: 'USD', currency2: 'JPY', reutersCode: 'USDJPY=', investingCode: 'usd-jpy' },
      { volatilityBuffer: '0.04', fee: '0.01' },
    );
    expect(pair.enabled).toBe(true);
    expect(pair.pairLabel).toBe('USD/JPY');
    expect(pair.quoteSource).toBe('reuters');
    expect(pair.feeds.reuters.enabled).toBe(true);
    expect(pair.feeds.investing.enabled).toBe(false);
    expect(pair.feeds.reuters.history.length).toBeGreaterThanOrEqual(10);
    expect(pair.feeds.investing.history.length).toBeGreaterThanOrEqual(10);
  });
});
