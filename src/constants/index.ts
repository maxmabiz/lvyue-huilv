export const SYSTEM_NAME = '履约业务汇率线上化';
export const APP_VERSION = '0.8.0';
export const APP_VERSION_DATE = '2026-10-13';

export const CURRENT_OPERATOR = '张财务';
export const CURRENT_OPERATOR_ROLE = '财务操作员';

export const RATE_SOURCE_LABEL = {
  reuters: 'Reuters',
  investing: '英为财经',
} as const;

export const DEFAULT_VOLATILITY_BUFFER = '0.04';
export const DEFAULT_FEE = '0.01';

export const INITIAL_DATA_DATE = '2026-08-18';
export const INITIAL_SYNC_AT = '2026-08-18 06:00:18';
export const INITIAL_SYNC_RANGE_START = '2026-08-09';
export const INITIAL_SYNC_RANGE_END = '2026-08-18';
export const INITIAL_CALCULATED_AT = '2026-08-18 06:02:06';
export const HISTORY_CALENDAR_DAYS = 10;
/** 内部多留几天，保证列表最早一天仍能凑出近 7 个交易日 */
export const HISTORY_SEED_DAYS = 20;

export const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CNY', 'HKD', 'JPY', 'SGD', 'AUD'] as const;

export function suggestReutersCode(currency1: string, currency2: string): string {
  if (currency1 === 'EUR' && currency2 === 'USD') return 'EUR=';
  if (currency1 === 'GBP' && currency2 === 'USD') return 'GBP=';
  return `${currency1}${currency2}=`;
}

export function suggestInvestingCode(currency1: string, currency2: string): string {
  return `${currency1}-${currency2}`.toLowerCase();
}
