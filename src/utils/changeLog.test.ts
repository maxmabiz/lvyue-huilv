import { describe, expect, it } from 'vitest';
import { CURRENT_OPERATOR } from '@/constants';
import { createInitialSnapshot } from '@/mock/seed';
import {
  buildChangeLog,
  isPairConfigLog,
  pairConfigLogs,
  pairStatusChangeAction,
  pairStatusChangeDetail,
  sourceQuoteChangeDetail,
  sortChangeLogs,
} from '@/utils/changeLog';

describe('配置变更日志', () => {
  it('启用停用记录状态从哪改到哪', () => {
    expect(pairStatusChangeAction(true)).toBe('启用');
    expect(pairStatusChangeAction(false)).toBe('停用');
    expect(pairStatusChangeDetail(true)).toBe('状态由停用改为启用');
    expect(pairStatusChangeDetail(false)).toBe('状态由启用改为停用');
    expect(sourceQuoteChangeDetail('reuters', true)).toBe('Reuters 改为用于当天报价');
    expect(sourceQuoteChangeDetail('investing', false)).toBe('英为财经 改为不用于当天报价');
  });

  it('初始快照按时间倒序提供启用停用日志，不含更改数据源', () => {
    const snapshot = createInitialSnapshot();
    expect(snapshot.changeLogs.length).toBeGreaterThan(0);
    expect(snapshot.changeLogs).toEqual(sortChangeLogs(snapshot.changeLogs));
    expect(snapshot.changeLogs.every((log) => isPairConfigLog(log))).toBe(true);
    expect(snapshot.changeLogs.some((log) => log.action === '启用')).toBe(true);
    expect(snapshot.changeLogs.some((log) => log.action === '停用')).toBe(true);
    expect(snapshot.changeLogs.some((log) => log.action.includes('数据源') || log.detail.includes('数据源'))).toBe(
      false,
    );
    expect(pairConfigLogs(snapshot.changeLogs, 'USDCNY').length).toBeGreaterThan(0);
    expect(pairConfigLogs(snapshot.changeLogs, 'USDCNY', 'reuters').every((log) => !log.source || log.source === 'reuters')).toBe(
      true,
    );
    expect(pairConfigLogs(snapshot.changeLogs, 'USDCNY', 'investing').some((log) => log.source === 'investing')).toBe(
      true,
    );
  });

  it('货币对配置日志可按数据源收窄', () => {
    const logs = [
      buildChangeLog({
        pairId: 'USDCNY',
        pairLabel: 'USD/CNY',
        source: 'reuters',
        action: '启用',
        detail: pairStatusChangeDetail(true),
        changedAt: '2026-08-18 12:00:00',
      }),
      buildChangeLog({
        pairId: 'USDCNY',
        pairLabel: 'USD/CNY',
        source: 'investing',
        action: '停用',
        detail: pairStatusChangeDetail(false),
        changedAt: '2026-08-18 11:30:00',
      }),
    ];
    const reuters = pairConfigLogs(logs, 'USDCNY', 'reuters');
    expect(reuters).toHaveLength(1);
    expect(reuters[0].source).toBe('reuters');
  });

  it('更改报价数据源会出现在货币对日志里', () => {
    const logs = [
      buildChangeLog({
        pairId: 'USDCNY',
        pairLabel: 'USD/CNY',
        action: '启用',
        detail: pairStatusChangeDetail(true),
        changedAt: '2026-08-18 12:00:00',
      }),
      buildChangeLog({
        pairId: 'USDCNY',
        pairLabel: 'USD/CNY',
        source: 'investing',
        action: '更改数据源',
        detail: '报价数据源由 Reuters 改为 英为财经',
        changedAt: '2026-08-18 11:00:00',
      }),
    ];
    const visible = pairConfigLogs(logs, 'USDCNY');
    expect(visible).toHaveLength(2);
    expect(visible.some((log) => log.action === '更改数据源')).toBe(true);
  });

  it('新日志默认记当前操作人', () => {
    const log = buildChangeLog({
      pairId: 'USDCNY',
      pairLabel: 'USD/CNY',
      action: '启用',
      detail: pairStatusChangeDetail(true),
      changedAt: '2026-08-18 12:00:00',
    });
    expect(log.operator).toBe(CURRENT_OPERATOR);
    expect(log.detail).toBe('状态由停用改为启用');
  });
});
