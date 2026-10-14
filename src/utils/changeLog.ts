import { CURRENT_OPERATOR, RATE_SOURCE_LABEL } from '@/constants';
import type { ConfigChangeLog, RateSource } from '@/types';

export function pairStatusChangeDetail(enabled: boolean): string {
  return enabled ? '状态由停用改为启用' : '状态由启用改为停用';
}

export function pairStatusChangeAction(enabled: boolean): string {
  return enabled ? '启用' : '停用';
}

export function sourceQuoteChangeDetail(source: RateSource, enabled: boolean): string {
  return enabled
    ? `${RATE_SOURCE_LABEL[source]} 改为用于当天报价`
    : `${RATE_SOURCE_LABEL[source]} 改为不用于当天报价`;
}

export function buildChangeLog(input: {
  id?: string;
  pairId: string;
  pairLabel: string;
  source?: ConfigChangeLog['source'];
  action: string;
  detail: string;
  changedAt: string;
  operator?: string;
}): ConfigChangeLog {
  const stamp = input.changedAt.replace(/\D/g, '');
  return {
    id: input.id ?? `cl-${input.pairId}-${stamp}-${Date.now().toString(36)}`,
    pairId: input.pairId,
    pairLabel: input.pairLabel,
    source: input.source,
    action: input.action,
    detail: input.detail,
    changedAt: input.changedAt,
    operator: input.operator ?? CURRENT_OPERATOR,
  };
}

export function sortChangeLogs(logs: ConfigChangeLog[]): ConfigChangeLog[] {
  return [...logs].sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.id.localeCompare(a.id));
}

export function isPairConfigLog(_log: Pick<ConfigChangeLog, 'action' | 'detail'>): boolean {
  return true;
}

export function pairConfigLogs(
  logs: ConfigChangeLog[],
  pairId: string,
  source?: RateSource,
): ConfigChangeLog[] {
  return logs.filter((log) => {
    if (log.pairId !== pairId || !isPairConfigLog(log)) return false;
    if (!source) return true;
    return !log.source || log.source === source;
  });
}
