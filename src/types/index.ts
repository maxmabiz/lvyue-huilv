export type SyncStatus = '正常' | '同步中' | '失败';

export type RateSource = 'reuters' | 'investing';

export const RATE_SOURCE_IDS: RateSource[] = ['reuters', 'investing'];

export interface DailyBar {
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface SourceFeed {
  code: string;
  connected: boolean;
  enabled: boolean;
  lastSyncAt: string;
  syncStatus: SyncStatus;
  latestMarketRate: string;
  dataDate: string;
  history: DailyBar[];
  configUpdatedAt: string;
}

export interface FxPairState {
  id: string;
  currency1: string;
  currency2: string;
  pair: string;
  pairLabel: string;
  quoteSource: RateSource;
  feeds: Record<RateSource, SourceFeed>;
  volatilityBuffer: string;
  fee: string;
  enabled: boolean;
  configUpdatedAt: string;
}

export interface ComputedQuotes {
  avg7: string;
  combinedBuffer: string;
  quoteCcy1: string;
  quoteCcy2: string;
}

export interface EnrichedPair extends FxPairState, ComputedQuotes {
  updateDate: string;
}

export interface OfficialQuote {
  id: string;
  pairId: string;
  currency1: string;
  currency2: string;
  pair: string;
  pairLabel: string;
  quoteDate: string;
  quoteSource: RateSource;
  avg7: string;
  combinedBuffer: string;
  volatilityBuffer: string;
  fee: string;
  quoteCcy1: string;
  quoteCcy2: string;
  calculatedAt: string;
  history: DailyBar[];
  /** 当天是否单独配置过缓冲；不影响下一报价日 */
  bufferCustom: boolean;
}

export interface RateDailyRow {
  id: string;
  pairId: string;
  pair: string;
  pairLabel: string;
  source: RateSource;
  sourceCode: string;
  dataDate: string;
  open: string;
  high: string;
  low: string;
  close: string;
  changeRatio: string | null;
  latestMarketRate: string;
  lastSyncAt: string;
  syncStatus: SyncStatus;
  hasVolatilityWarning: boolean;
  history: DailyBar[];
}

export interface BufferConfig {
  volatilityBuffer: string;
  fee: string;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface SourceSyncState {
  lastSyncAt: string;
  lastSyncStatus: SyncStatus;
  lastSyncRange?: DateRange;
}

export interface AppSnapshot {
  sourceSync: Record<RateSource, SourceSyncState>;
  lastCalculatedAt: string;
  globalBuffer: BufferConfig;
  pairs: FxPairState[];
  officialQuotes: OfficialQuote[];
  changeLogs: ConfigChangeLog[];
}

export interface ConfigChangeLog {
  id: string;
  pairId: string;
  pairLabel: string;
  source?: RateSource;
  action: string;
  detail: string;
  changedAt: string;
  operator: string;
}

export interface PairConfigInput {
  currency1: string;
  currency2: string;
  reutersCode: string;
  investingCode: string;
  reutersConnected: boolean;
  investingConnected: boolean;
  quoteSource: RateSource;
}
