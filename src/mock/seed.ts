import Decimal from 'decimal.js';
import type { DailyBar, FxPairState, AppSnapshot, BufferConfig, ConfigChangeLog, RateSource, SourceFeed } from '@/types';
import {
  CURRENT_OPERATOR,
  DEFAULT_FEE,
  DEFAULT_VOLATILITY_BUFFER,
  HISTORY_CALENDAR_DAYS,
  HISTORY_SEED_DAYS,
  INITIAL_CALCULATED_AT,
  INITIAL_DATA_DATE,
  INITIAL_SYNC_AT,
  INITIAL_SYNC_RANGE_END,
  INITIAL_SYNC_RANGE_START,
  suggestInvestingCode,
  suggestReutersCode,
} from '@/constants';
import { EXCEL_OHLC, type ExcelPair, type OhlcQuote } from '@/mock/excelBars';
import { isTradingDay, lastNCalendarDays, lastNTradingDays } from '@/utils/date';
import { seedOfficialQuotes } from '@/utils/officialQuote';
import { previousTradingClose } from '@/utils/rateCalc';
import { buildChangeLog, pairStatusChangeDetail, sortChangeLogs } from '@/utils/changeLog';

export interface PairSeed {
  currency1: string;
  currency2: string;
  reutersCode: string;
  avg7: string;
  expectedQuote1: string;
  expectedQuote2: string;
}

export const PAIR_SEEDS: PairSeed[] = [
  { currency1: 'USD', currency2: 'CNY', reutersCode: 'USDCNY=', avg7: '6.7541', expectedQuote1: '6.4', expectedQuote2: '7.1' },
  { currency1: 'EUR', currency2: 'CNY', reutersCode: 'EURCNY=', avg7: '7.7694', expectedQuote1: '7.3', expectedQuote2: '8.2' },
  { currency1: 'GBP', currency2: 'CNY', reutersCode: 'GBPCNY=', avg7: '9.0688', expectedQuote1: '8.6', expectedQuote2: '9.6' },
  { currency1: 'EUR', currency2: 'USD', reutersCode: 'EUR=', avg7: '1.1504', expectedQuote1: '1.0', expectedQuote2: '1.3' },
  { currency1: 'GBP', currency2: 'USD', reutersCode: 'GBP=', avg7: '1.3428', expectedQuote1: '1.2', expectedQuote2: '1.5' },
  { currency1: 'USD', currency2: 'HKD', reutersCode: 'USDHKD=', avg7: '7.8426', expectedQuote1: '7.4', expectedQuote2: '8.3' },
  { currency1: 'EUR', currency2: 'GBP', reutersCode: 'EURGBP=', avg7: '0.8565', expectedQuote1: '0.8', expectedQuote2: '0.9' },
  { currency1: 'EUR', currency2: 'HKD', reutersCode: 'EURHKD=', avg7: '9.0226', expectedQuote1: '8.5', expectedQuote2: '9.5' },
];

const AVG_OFFSETS = ['-0.0042', '-0.0018', '0.0026', '-0.0031', '0.0038', '-0.0009'];
const HALF_SPREADS = ['0.0040', '0.0032', '0.0046', '0.0035', '0.0044', '0.0034', '0.0038'];

export function toDailyBar(date: string, quote: OhlcQuote): DailyBar {
  return {
    date,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.close,
  };
}

export function buildHistory(endDate: string, targetAvg: string): DailyBar[] {
  const dates = lastNTradingDays(endDate, 7);
  const target = new Decimal(targetAvg);
  const firstSix = AVG_OFFSETS.map((offset) => target.plus(offset));
  const sumSix = firstSix.reduce((acc, item) => acc.plus(item), new Decimal(0));
  const seventh = target.mul(7).minus(sumSix);
  const avgs = [...firstSix, seventh];

  return dates.map((date, index) => {
    const avg = avgs[index];
    const half = new Decimal(HALF_SPREADS[index]);
    const high = avg.plus(half);
    const low = avg.minus(half);
    const open = Decimal.max(low, avg.minus(half.mul('0.35')));
    const close = Decimal.min(high, avg.plus(half.mul('0.25')));
    return {
      date,
      open: open.toFixed(6),
      high: high.toFixed(6),
      low: low.toFixed(6),
      close: close.toFixed(6),
    };
  });
}

export function mockBarForDate(date: string, baseAvg: Decimal): DailyBar {
  const closeJitter = new Decimal(1).plus((Math.random() * 0.003 - 0.0014).toFixed(6));
  const openJitter = new Decimal(1).plus((Math.random() * 0.0024 - 0.0012).toFixed(6));
  const close = baseAvg.mul(closeJitter);
  const open = baseAvg.mul(openJitter);
  const high = Decimal.max(open, close).plus('0.0038');
  const low = Decimal.min(open, close).minus('0.0032');
  return {
    date,
    open: open.toFixed(6),
    high: high.toFixed(6),
    low: low.toFixed(6),
    close: close.toFixed(6),
  };
}

export function buildHistoryFromExcel(pair: ExcelPair, endDate: string, calendarDays = HISTORY_CALENDAR_DAYS): DailyBar[] {
  const dates = lastNCalendarDays(endDate, calendarDays);
  const tradingDates = dates.filter((date) => isTradingDay(date));
  const source = EXCEL_OHLC[pair].slice(-Math.max(tradingDates.length, 1));
  const byDate = new Map<string, DailyBar>();
  tradingDates.forEach((date, index) => {
    const quote = source[index] ?? source[source.length - 1];
    byDate.set(date, toDailyBar(date, quote));
  });

  let previousClose = source[0]?.close ?? '0';
  return dates.map((date) => {
    const existing = byDate.get(date);
    if (existing) {
      previousClose = existing.close;
      return existing;
    }
    const closed = toDailyBar(date, {
      open: previousClose,
      high: previousClose,
      low: previousClose,
      close: previousClose,
    });
    return closed;
  });
}

export function buildSimulatedHistory(endDate: string, targetAvg: string, calendarDays = HISTORY_SEED_DAYS): DailyBar[] {
  const dates = lastNCalendarDays(endDate, calendarDays);
  const tradingHistory = buildHistory(endDate, targetAvg);
  const byDate = new Map(tradingHistory.map((bar) => [bar.date, bar]));
  let previousClose = tradingHistory[0]?.close ?? targetAvg;

  return dates.map((date) => {
    const existing = byDate.get(date);
    if (existing) {
      previousClose = existing.close;
      return existing;
    }
    return toDailyBar(date, {
      open: previousClose,
      high: previousClose,
      low: previousClose,
      close: previousClose,
    });
  });
}

const TYPICAL_AVG: Record<string, string> = {
  USDCNY: '7.1200',
  EURCNY: '8.0500',
  GBPCNY: '9.0800',
  EURUSD: '1.1500',
  GBPUSD: '1.3400',
  USDHKD: '7.8400',
  EURGBP: '0.8600',
  EURHKD: '9.0200',
  USDJPY: '148.50',
  EURJPY: '170.20',
  GBPJPY: '198.40',
  AUDUSD: '0.6600',
  USDSGD: '1.3500',
};

export function typicalAvgFor(currency1: string, currency2: string): string {
  return TYPICAL_AVG[`${currency1}${currency2}`] ?? '1.0000';
}

/** 原型演示：在可见窗口内造一个超过 1% 的交易日，预警随行情滚动而不是写死基准 */
const DEMO_JUMP_PAIR = 'GBPCNY';
const DEMO_JUMP_DATE = '2026-08-18';
const DEMO_JUMP_RATIO = '1.012';

export function applyDemoVolatilityJump(pair: string, history: DailyBar[]): DailyBar[] {
  if (pair !== DEMO_JUMP_PAIR) return history;
  const previous = previousTradingClose(history, DEMO_JUMP_DATE);
  const index = history.findIndex((bar) => bar.date === DEMO_JUMP_DATE);
  if (!previous || index < 0) return history;
  const close = new Decimal(previous).mul(DEMO_JUMP_RATIO);
  const bar = history[index];
  const high = Decimal.max(new Decimal(bar.high), close);
  const next = [...history];
  next[index] = {
    ...bar,
    close: close.toFixed(6),
    high: high.toFixed(6),
  };
  return next;
}

export function shiftBarsForInvesting(history: DailyBar[]): DailyBar[] {
  return history.map((bar, index) => {
    const factor = new Decimal('1.00055').plus(new Decimal((index % 5) - 2).mul('0.00012'));
    const open = new Decimal(bar.open).mul(factor);
    const close = new Decimal(bar.close).mul(factor);
    const high = Decimal.max(open, close, new Decimal(bar.high).mul(factor));
    const low = Decimal.min(open, close, new Decimal(bar.low).mul(factor));
    return {
      date: bar.date,
      open: open.toFixed(6),
      high: high.toFixed(6),
      low: low.toFixed(6),
      close: close.toFixed(6),
    };
  });
}

export function emptyFeed(code = ''): SourceFeed {
  return {
    code,
    connected: false,
    enabled: false,
    lastSyncAt: '',
    syncStatus: '正常',
    latestMarketRate: '0',
    dataDate: '',
    history: [],
    configUpdatedAt: '',
  };
}

export function feedFromHistory(
  code: string,
  history: DailyBar[],
  connected = true,
): SourceFeed {
  const latestBar = history[history.length - 1];
  return {
    code: code.trim(),
    connected,
    enabled: connected,
    lastSyncAt: connected && history.length ? INITIAL_SYNC_AT : '',
    syncStatus: '正常',
    latestMarketRate: latestBar?.close ?? '0',
    dataDate: latestBar?.date ?? '',
    history,
    configUpdatedAt: connected ? INITIAL_CALCULATED_AT : '',
  };
}

export function buildPairMarketHistory(currency1: string, currency2: string): DailyBar[] {
  const pair = `${currency1}${currency2}`;
  const excelKey = pair as ExcelPair;
  const history = excelKey in EXCEL_OHLC
    ? buildHistoryFromExcel(excelKey, INITIAL_DATA_DATE, HISTORY_SEED_DAYS)
    : buildSimulatedHistory(INITIAL_DATA_DATE, typicalAvgFor(currency1, currency2));
  return applyDemoVolatilityJump(pair, history);
}

export interface CreatePairInput {
  currency1: string;
  currency2: string;
  reutersCode: string;
  investingCode: string;
  reutersConnected?: boolean;
  investingConnected?: boolean;
  quoteSource?: RateSource;
}

export function createConfiguredPair(
  input: CreatePairInput,
  buffer: BufferConfig,
  syncedAt = nowLike(),
): FxPairState {
  const currency1 = input.currency1.trim().toUpperCase();
  const currency2 = input.currency2.trim().toUpperCase();
  const reutersConnected = input.reutersConnected ?? true;
  const investingConnected = input.investingConnected ?? true;
  const quoteSource = input.quoteSource ?? 'reuters';
  const market = buildPairMarketHistory(currency1, currency2);

  return {
    id: `${currency1}${currency2}`,
    currency1,
    currency2,
    pair: `${currency1}${currency2}`,
    pairLabel: `${currency1}/${currency2}`,
    quoteSource,
    feeds: {
      reuters: reutersConnected
        ? {
            ...feedFromHistory(input.reutersCode || suggestReutersCode(currency1, currency2), market),
            enabled: quoteSource === 'reuters',
          }
        : emptyFeed(input.reutersCode),
      investing: investingConnected
        ? {
            ...feedFromHistory(
              input.investingCode || suggestInvestingCode(currency1, currency2),
              shiftBarsForInvesting(market),
            ),
            enabled: quoteSource === 'investing',
          }
        : emptyFeed(input.investingCode),
    },
    volatilityBuffer: buffer.volatilityBuffer,
    fee: buffer.fee,
    enabled: true,
    configUpdatedAt: syncedAt,
  };
}

function nowLike() {
  return INITIAL_CALCULATED_AT;
}

function toPairState(seed: PairSeed, buffer: BufferConfig): FxPairState {
  return createConfiguredPair(
    {
      currency1: seed.currency1,
      currency2: seed.currency2,
      reutersCode: seed.reutersCode,
      investingCode: suggestInvestingCode(seed.currency1, seed.currency2),
      quoteSource: 'reuters',
    },
    buffer,
    INITIAL_CALCULATED_AT,
  );
}

export function seedChangeLogs(): ConfigChangeLog[] {
  return sortChangeLogs([
    buildChangeLog({
      pairId: 'USDCNY',
      pairLabel: 'USD/CNY',
      source: 'reuters',
      action: '启用',
      detail: pairStatusChangeDetail(true),
      changedAt: '2026-08-12 10:18:22',
      operator: '李财务',
    }),
    buildChangeLog({
      pairId: 'USDCNY',
      pairLabel: 'USD/CNY',
      source: 'reuters',
      action: '停用',
      detail: pairStatusChangeDetail(false),
      changedAt: '2026-08-11 16:05:40',
      operator: '李财务',
    }),
    buildChangeLog({
      pairId: 'USDCNY',
      pairLabel: 'USD/CNY',
      source: 'investing',
      action: '启用',
      detail: pairStatusChangeDetail(true),
      changedAt: '2026-08-12 10:20:08',
      operator: '李财务',
    }),
    buildChangeLog({
      pairId: 'GBPCNY',
      pairLabel: 'GBP/CNY',
      source: 'investing',
      action: '启用',
      detail: pairStatusChangeDetail(true),
      changedAt: '2026-08-11 09:06:14',
      operator: CURRENT_OPERATOR,
    }),
    buildChangeLog({
      pairId: 'GBPCNY',
      pairLabel: 'GBP/CNY',
      source: 'investing',
      action: '停用',
      detail: pairStatusChangeDetail(false),
      changedAt: '2026-08-10 11:20:03',
      operator: '李财务',
    }),
    buildChangeLog({
      pairId: 'USDHKD',
      pairLabel: 'USD/HKD',
      source: 'reuters',
      action: '启用',
      detail: pairStatusChangeDetail(true),
      changedAt: '2026-08-13 15:40:18',
      operator: CURRENT_OPERATOR,
    }),
    buildChangeLog({
      pairId: 'USDHKD',
      pairLabel: 'USD/HKD',
      source: 'reuters',
      action: '停用',
      detail: pairStatusChangeDetail(false),
      changedAt: '2026-08-13 15:22:51',
      operator: CURRENT_OPERATOR,
    }),
  ]);
}

export function createInitialSnapshot(): AppSnapshot {
  const globalBuffer: BufferConfig = {
    volatilityBuffer: DEFAULT_VOLATILITY_BUFFER,
    fee: DEFAULT_FEE,
  };
  const range = {
    start: INITIAL_SYNC_RANGE_START,
    end: INITIAL_SYNC_RANGE_END,
  };
  const pairs = PAIR_SEEDS.map((seed) => toPairState(seed, globalBuffer));

  return {
    sourceSync: {
      reuters: {
        lastSyncAt: INITIAL_SYNC_AT,
        lastSyncStatus: '正常',
        lastSyncRange: range,
      },
      investing: {
        lastSyncAt: INITIAL_SYNC_AT,
        lastSyncStatus: '正常',
        lastSyncRange: range,
      },
    },
    lastCalculatedAt: INITIAL_CALCULATED_AT,
    globalBuffer,
    pairs,
    officialQuotes: seedOfficialQuotes(pairs),
    changeLogs: seedChangeLogs(),
  };
}
