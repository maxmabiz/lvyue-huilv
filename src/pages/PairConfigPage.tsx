import { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Form, Modal, Radio, Select, Space, Table, Typography } from 'antd';
import { CalculatorOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import BufferConfigModal from '@/components/BufferConfigModal';
import ChangeLogDrawer from '@/components/ChangeLogDrawer';
import { EnabledTag, SourceTag } from '@/components/StatusTags';
import { RATE_SOURCE_LABEL } from '@/constants';
import { useRateStore } from '@/store/RateStore';
import { RATE_SOURCE_IDS, type BufferConfig, type EnrichedPair, type RateSource } from '@/types';
import { customDayQuoteCount, isCustomDayQuote } from '@/utils/buffer';
import { formatDateTime } from '@/utils/date';
import { pairConfigLogs } from '@/utils/changeLog';
import { latestQuoteDate } from '@/utils/officialQuote';
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
    setQuoteSource,
  } = useRateStore();
  const [form] = Form.useForm();
  const [switchForm] = Form.useForm();
  const [filters, setFilters] = useState<Filters>({});
  const [disablingRow, setDisablingRow] = useState<EnrichedPair | null>(null);
  const [switchingRow, setSwitchingRow] = useState<EnrichedPair | null>(null);
  const [logRow, setLogRow] = useState<EnrichedPair | null>(null);
  const [bufferOpen, setBufferOpen] = useState(false);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const watchedSource = Form.useWatch('source', form) as RateSource | undefined;
  const switchSource = Form.useWatch('source', switchForm) as RateSource | undefined;

  useEffect(() => {
    if (!switchingRow) {
      switchForm.resetFields();
      return;
    }
    switchForm.setFieldsValue({
      source: connectedSources(switchingRow).find((source) => source !== switchingRow.quoteSource),
    });
  }, [switchingRow, switchForm]);

  const latestDate = unlockedQuoteDate ?? latestQuoteDate(officialQuotes);
  const enabledPairCount = useMemo(() => pairs.filter((pair) => pair.enabled).length, [pairs]);
  const openDayExceptionCount = customDayQuoteCount(officialQuotes, latestDate);
  const pairById = useMemo(() => new Map(pairs.map((item) => [item.id, item])), [pairs]);
  const globalPreviewQuotes = useMemo(
    () =>
      officialQuotes.filter((item) => {
        if (item.quoteDate !== latestDate || isCustomDayQuote(item)) return false;
        return Boolean(pairById.get(item.pairId)?.enabled);
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

  const handleQuoteSource = (row: EnrichedPair, source: RateSource) => {
    const result = setQuoteSource(row.id, source);
    if (!result.ok) {
      message.error(result.error || '操作失败');
      return;
    }
    setSwitchingRow(null);
    switchForm.resetFields();
    message.success(
      `已将 ${row.pairLabel} 改为 ${RATE_SOURCE_LABEL[source]}，已生成报价不变，下次报价起生效`,
    );
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

  const otherSource = (row: EnrichedPair) =>
    connectedSources(row).find((source) => source !== row.quoteSource);

  const nextSourceLabel = switchSource
    ? RATE_SOURCE_LABEL[switchSource]
    : switchingRow
      ? RATE_SOURCE_LABEL[switchingRow.quoteSource]
      : '所选数据源';

  const columns: ColumnsType<EnrichedPair> = [
    { title: '货币对', dataIndex: 'pairLabel', width: 96 },
    {
      title: '数据来源',
      key: 'sources',
      width: 108,
      render: (_, record) => <SourceTag source={record.quoteSource} />,
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
      title: '最近修改时间',
      dataIndex: 'configUpdatedAt',
      width: 168,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <Space size={8}>
          {otherSource(record) ? (
            <Button type="link" onClick={() => setSwitchingRow(record)}>
              更改
            </Button>
          ) : null}
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
          <Title level={3}>报价配置</Title>
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
          scroll={{ x: 888 }}
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
        title={switchingRow ? `更改 ${switchingRow.pairLabel} 数据源` : '更改数据源'}
        open={!!switchingRow}
        onCancel={() => {
          setSwitchingRow(null);
          switchForm.resetFields();
        }}
        onOk={async () => {
          if (!switchingRow) return;
          const values = await switchForm.validateFields();
          handleQuoteSource(switchingRow, values.source as RateSource);
        }}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
        afterOpenChange={(open) => {
          if (!open) switchForm.resetFields();
        }}
      >
        <Form form={switchForm} layout="vertical">
          <Paragraph>
            当前数据源：{switchingRow ? RATE_SOURCE_LABEL[switchingRow.quoteSource] : '-'}
          </Paragraph>
          <Form.Item
            name="source"
            label="改为"
            rules={[{ required: true, message: '请选择数据源' }]}
          >
            <Radio.Group className="source-pick">
              {(switchingRow ? connectedSources(switchingRow) : []).map((source) => (
                <Radio key={source} value={source} disabled={source === switchingRow?.quoteSource}>
                  <SourceTag source={source} />
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            已生成的报价不会改写。下次出报价起用 {nextSourceLabel}。
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
            仅更新 {latestDate} 的官方报价价格，已锁定的历史日和当天数据源都不会因改源而改写。
            {openDayExceptionCount ? ` ${openDayExceptionCount} 个当日例外不会被覆盖。` : ''}
          </Paragraph>
        ) : null}
      </Modal>
    </div>
  );
}
