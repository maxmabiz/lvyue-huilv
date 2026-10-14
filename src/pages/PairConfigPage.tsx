import { useMemo, useState } from 'react';
import { App, Button, Card, DatePicker, Form, Modal, Radio, Select, Space, Table, Tooltip, Typography } from 'antd';
import { CalculatorOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import BufferConfigModal from '@/components/BufferConfigModal';
import ChangeLogDrawer from '@/components/ChangeLogDrawer';
import { EnabledTag, SourceTag } from '@/components/StatusTags';
import { RATE_SOURCE_LABEL } from '@/constants';
import { useRateStore } from '@/store/RateStore';
import { RATE_SOURCE_IDS, type BufferConfig, type EnrichedPair, type RateSource } from '@/types';
import { customDayQuoteCount, isCustomDayQuote } from '@/utils/buffer';
import { formatDateTime, isTradingDay } from '@/utils/date';
import { pairConfigLogs } from '@/utils/changeLog';
import { firstQuoteDate, latestQuoteDate } from '@/utils/officialQuote';
import { combinedBufferOf, formatPercent } from '@/utils/rateCalc';
import { connectedSources, pairOptionsForSource } from '@/utils/source';

const { Title, Paragraph } = Typography;

interface Filters {
  pair?: string;
  source?: RateSource;
  enabled?: boolean;
}

export default function PairConfigPage() {
  const { message } = App.useApp();
  const {
    pairs,
    officialQuotes,
    changeLogs,
    unlockedQuoteDate,
    globalBuffer,
    calculating,
    recalculate,
    saveGlobalBuffer,
    setPairEnabled,
    scheduleQuoteSource,
    cancelQuoteSourceSchedule,
  } = useRateStore();
  const [form] = Form.useForm();
  const [switchForm] = Form.useForm();
  const [filters, setFilters] = useState<Filters>({});
  const [disablingRow, setDisablingRow] = useState<EnrichedPair | null>(null);
  const [switchingSource, setSwitchingSource] = useState<{ row: EnrichedPair; source: RateSource } | null>(null);
  const [logRow, setLogRow] = useState<EnrichedPair | null>(null);
  const [bufferOpen, setBufferOpen] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const watchedSource = Form.useWatch('source', form) as RateSource | undefined;

  const latestDate = unlockedQuoteDate ?? latestQuoteDate(officialQuotes);
  const enabledPairCount = useMemo(() => pairs.filter((pair) => pair.enabled).length, [pairs]);
  const openDayExceptionCount = customDayQuoteCount(officialQuotes, latestDate);
  const pairById = useMemo(() => new Map(pairs.map((item) => [item.id, item])), [pairs]);
  const globalPreviewQuotes = useMemo(
    () =>
      officialQuotes.filter((item) => {
        if (item.quoteDate !== latestDate || isCustomDayQuote(item)) return false;
        return Boolean(pairById.get(item.pairId)?.feeds[item.quoteSource]?.enabled);
      }),
    [officialQuotes, latestDate, pairById],
  );

  const pairOptions = useMemo(() => {
    const source = watchedSource ?? filters.source;
    return pairOptionsForSource(pairs, source).filter((option) => {
      if (!source) return true;
      const pair = pairs.find((item) => item.pair === option.value);
      return Boolean(pair?.feeds[source]?.enabled);
    });
  }, [pairs, watchedSource, filters.source]);
  const rows = useMemo(
    () => [...pairs].sort((a, b) => a.pair.localeCompare(b.pair)),
    [pairs],
  );

  const pairLogs = useMemo(
    () => (logRow ? pairConfigLogs(changeLogs, logRow.id) : []),
    [changeLogs, logRow],
  );

  const filtered = useMemo(() => {
    return rows.filter((item) => {
      if (filters.pair && item.pair !== filters.pair) return false;
      if (filters.source && !item.feeds[filters.source]?.enabled) return false;
      if (filters.enabled !== undefined && item.enabled !== filters.enabled) return false;
      return true;
    });
  }, [filters, rows]);

  const handleToggle = (row: EnrichedPair, enabled: boolean) => {
    const result = setPairEnabled(row.id, enabled);
    if (!result.ok) {
      message.error(result.error || '操作失败');
      return;
    }
    if (!enabled) setDisablingRow(null);
    message.success(
      enabled ? `已启用 ${row.pairLabel}` : `已停用 ${row.pairLabel}，历史行情与历史报价仍保留`,
    );
  };

  const handleScheduleQuoteSource = (row: EnrichedPair, source: RateSource, effectiveDate: string) => {
    const result = scheduleQuoteSource(row.id, source, effectiveDate);
    if (!result.ok) {
      message.error(result.error || '操作失败');
      return;
    }
    setSwitchingSource(null);
    switchForm.resetFields();
    const label = RATE_SOURCE_LABEL[source];
    message.success(
      result.applied
        ? `已从 ${effectiveDate} 起将 ${row.pairLabel} 改为 ${label}`
        : `已预约 ${row.pairLabel} 自 ${effectiveDate} 起改为 ${label}，当天报价不变`,
    );
  };

  const handleCancelSchedule = (row: EnrichedPair) => {
    const result = cancelQuoteSourceSchedule(row.id);
    if (!result.ok) {
      message.error(result.error || '操作失败');
      return;
    }
    message.success(`已取消 ${row.pairLabel} 的数据源预约`);
  };

  const handleSaveGlobal = (config: BufferConfig) => {
    saveGlobalBuffer(config);
    setBufferOpen(false);
    message.success('已保存全局缓冲因子。点击「重新计算」后，当天跟随全局的报价才会更新');
  };

  const handleRecalculate = () => {
    recalculate();
    setRecalcOpen(false);
    message.success(
      openDayExceptionCount
        ? `已按 ${latestDate} 行情重算跟随全局的报价；${openDayExceptionCount} 个当日例外未改动`
        : latestDate
          ? `已按 ${latestDate} 行情重算 ${enabledPairCount} 个货币对的报价。`
          : '已按当前市场数据和缓冲因子重新计算',
    );
  };

  const columns: ColumnsType<EnrichedPair> = [
    { title: '货币对', dataIndex: 'pairLabel', width: 96 },
    {
      title: '数据来源',
      key: 'sources',
      width: 280,
      render: (_, record) => (
        <div className="source-cell">
          <Radio.Group
            className="source-pick"
            value={record.quoteSource}
            onChange={(event) => {
              const source = event.target.value as RateSource;
              if (source === record.quoteSource) return;
              setSwitchingSource({ row: record, source });
            }}
          >
            {connectedSources(record).map((source) => (
              <Radio key={source} value={source}>
                <SourceTag source={source} />
              </Radio>
            ))}
          </Radio.Group>
          {record.pendingQuoteSource && record.pendingEffectiveDate ? (
            <div className="source-pending">
              将于 {record.pendingEffectiveDate} 改为 {RATE_SOURCE_LABEL[record.pendingQuoteSource]}
              <Button type="link" size="small" onClick={() => handleCancelSchedule(record)}>
                取消预约
              </Button>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: (
        <Tooltip title="更换数据源时手填的生效报价日。预约未到期显示预约日，到期或当天切换后仍保留。">
          <span>生效报价日</span>
        </Tooltip>
      ),
      key: 'quoteSourceEffectiveDate',
      width: 128,
      render: (_, record) => {
        if (record.pendingEffectiveDate) return `${record.pendingEffectiveDate}（预约）`;
        return record.quoteSourceEffectiveDate ?? '-';
      },
    },
    { title: '基准货币', dataIndex: 'currency1', width: 88 },
    { title: '计价货币', dataIndex: 'currency2', width: 88 },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 72,
      render: (enabled: boolean) => <EnabledTag enabled={enabled} />,
    },
    {
      title: (
        <Tooltip title="该货币对已存档官方报价中最早的行情日，用于看清从哪天开始报；不是预约生效日。">
          <span>首次报价日</span>
        </Tooltip>
      ),
      key: 'firstQuoteDate',
      width: 112,
      render: (_, record) => firstQuoteDate(officialQuotes, record.id) ?? '-',
    },
    {
      title: '最近修改时间',
      dataIndex: 'configUpdatedAt',
      width: 168,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'action',
      width: 128,
      render: (_, record) => (
        <Space size={8}>
          {record.enabled ? (
            <Button type="link" onClick={() => setDisablingRow(record)}>
              停用
            </Button>
          ) : (
            <Button type="link" onClick={() => handleToggle(record, true)}>
              启用
            </Button>
          )}
          <Button type="link" onClick={() => setLogRow(record)}>
            日志
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-wrap">
      <div className="page-header page-header-split">
        <div className="page-header-main">
          <Title level={3}>货币对配置</Title>
          <Paragraph className="page-desc">
            每个货币对一条配置，只能选择一个数据源。更换数据源须手填生效报价日，到期后才换。
          </Paragraph>
        </div>
        <div className="page-toolbar-cluster">
          <div className="page-toolbar-fact">
            <span className="k">综合缓冲因子</span>
            <span className="v">{formatPercent(combinedBufferOf(globalBuffer))}</span>
          </div>
          {openDayExceptionCount > 0 ? (
            <div className="page-toolbar-fact">
              <span className="k">单独配置</span>
              <span className="v">{openDayExceptionCount} 条</span>
            </div>
          ) : null}
          <Button icon={<SettingOutlined />} onClick={() => setBufferOpen(true)}>
            缓冲因子配置
          </Button>
          <Button
            type="primary"
            icon={<CalculatorOutlined />}
            loading={calculating}
            disabled={!enabledPairCount}
            onClick={() => setRecalcOpen(true)}
          >
            重新计算
          </Button>
        </div>
      </div>

      <Card className="page-card" variant="outlined">
        <Form className="filter-bar" form={form} layout="inline" colon={false} onFinish={setFilters}>
          <Form.Item name="pair" label="货币对">
            <Select allowClear placeholder="全部" style={{ width: 148 }} options={pairOptions} />
          </Form.Item>
          <Form.Item name="source" label="数据来源">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 120 }}
              options={RATE_SOURCE_IDS.map((source) => ({
                value: source,
                label: RATE_SOURCE_LABEL[source],
              }))}
              onChange={() => form.setFieldValue('pair', undefined)}
            />
          </Form.Item>
          <Form.Item name="enabled" label="状态">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 120 }}
              options={[
                { value: true, label: '启用' },
                { value: false, label: '停用' },
              ]}
            />
          </Form.Item>
          <Form.Item className="filter-actions">
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                查询
              </Button>
              <Button
                onClick={() => {
                  form.resetFields();
                  setFilters({});
                }}
              >
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>

        <Table
          className="compact-table"
          size="middle"
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          tableLayout="fixed"
          scroll={{ x: 1160 }}
          pagination={{
            pageSize: 10,
            showTotal: (total) => `共 ${total} 条`,
            showSizeChanger: false,
            size: 'small',
          }}
        />
      </Card>

      <ChangeLogDrawer
        pairLabel={logRow?.pairLabel}
        logs={pairLogs}
        open={!!logRow}
        onClose={() => setLogRow(null)}
      />
      <Modal
        title={disablingRow ? `停用 ${disablingRow.pairLabel}？` : '停用货币对？'}
        open={!!disablingRow}
        onCancel={() => setDisablingRow(null)}
        onOk={() => {
          if (disablingRow) handleToggle(disablingRow, false);
        }}
        okText="停用"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <Paragraph>停用后该货币对不再出现在当天履约报价中。</Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          已存档的历史报价和已同步行情仍可查阅，不会删除。
        </Paragraph>
      </Modal>
      <Modal
        title={
          switchingSource
            ? `将 ${switchingSource.row.pairLabel} 改为 ${RATE_SOURCE_LABEL[switchingSource.source]}？`
            : '更改数据源？'
        }
        open={!!switchingSource}
        onCancel={() => {
          setSwitchingSource(null);
          switchForm.resetFields();
        }}
        onOk={async () => {
          if (!switchingSource) return;
          const values = await switchForm.validateFields();
          const effectiveDate = (values.effectiveDate as Dayjs).format('YYYY-MM-DD');
          handleScheduleQuoteSource(switchingSource.row, switchingSource.source, effectiveDate);
        }}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
        afterOpenChange={(open) => {
          if (open) switchForm.resetFields();
        }}
      >
        <Form form={switchForm} layout="vertical">
          <Paragraph>
            {switchingSource
              ? `当天报价仍用 ${RATE_SOURCE_LABEL[switchingSource.row.quoteSource]}。从你填写的报价日起，才改用 ${RATE_SOURCE_LABEL[switchingSource.source]}。`
              : '须手填生效报价日，到期后才切换数据源。'}
          </Paragraph>
          <Form.Item
            name="effectiveDate"
            label="生效报价日"
            rules={[{ required: true, message: '请填写生效报价日' }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              placeholder="请选择日期"
              showNow={false}
              defaultPickerValue={latestDate ? dayjs(latestDate) : undefined}
              disabledDate={(current) => {
                if (!current) return false;
                if (latestDate && current.isBefore(latestDate, 'day')) return true;
                return !isTradingDay(current);
              }}
            />
          </Form.Item>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {latestDate
              ? `若填写当前报价日 ${latestDate}，当天就会换；历史日不会改写。`
              : '历史日不会改写。'}
          </Paragraph>
        </Form>
      </Modal>
      <BufferConfigModal
        open={bufferOpen}
        previewQuotes={globalPreviewQuotes}
        initial={globalBuffer}
        exceptionCount={openDayExceptionCount}
        onCancel={() => setBufferOpen(false)}
        onSave={handleSaveGlobal}
      />
      <Modal
        title="重新计算当前报价日？"
        open={recalcOpen}
        onCancel={() => setRecalcOpen(false)}
        onOk={handleRecalculate}
        okText="重算"
        cancelText="取消"
        confirmLoading={calculating}
        destroyOnHidden
      >
        <Paragraph>
          {latestDate
            ? `将按各接入数据源截至 ${latestDate} 的近 7 个交易日均价，重算当天仍跟随全局的报价${
                openDayExceptionCount ? `（不含 ${openDayExceptionCount} 条当日例外）` : ''
              }。`
            : '将按当前市场数据和缓冲因子重算全部已启用货币对。'}
        </Paragraph>
        {latestDate ? (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            仅更新 {latestDate} 的官方报价，已锁定的历史日不会改写。
            {openDayExceptionCount ? ` ${openDayExceptionCount} 个当日例外不会被覆盖。` : ''}
          </Paragraph>
        ) : null}
      </Modal>
    </div>
  );
}
