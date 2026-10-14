import { useMemo, useState } from 'react';
import { Button, Card, DatePicker, Form, Select, Space, Table, Tooltip, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import CalcRuleModal from '@/components/CalcRuleModal';
import { CustomBufferTag, EffectiveTag, LockedTag, SourceTag } from '@/components/StatusTags';
import { RATE_SOURCE_LABEL } from '@/constants';
import { useRateStore } from '@/store/RateStore';
import { RATE_SOURCE_IDS, type OfficialQuote, type RateSource } from '@/types';
import { isCustomDayQuote } from '@/utils/buffer';
import { formatDateTime } from '@/utils/date';
import { isQuoteLocked, latestQuoteDate } from '@/utils/officialQuote';
import { formatPercent, formatRate } from '@/utils/rateCalc';

const { Title, Paragraph } = Typography;

type QuoteStatusFilter = 'effective' | 'locked';

interface Filters {
  currency1?: string;
  currency2?: string;
  pair?: string;
  source?: RateSource;
  quoteDate?: string;
  status?: QuoteStatusFilter;
}

export default function BusinessRatesPage() {
  const { pairs, officialQuotes, unlockedQuoteDate } = useRateStore();
  const [form] = Form.useForm();
  const [filters, setFilters] = useState<Filters>({});
  const [ruleQuote, setRuleQuote] = useState<OfficialQuote | null>(null);
  const watchedSource = Form.useWatch('source', form) as RateSource | undefined;

  const latestDate = unlockedQuoteDate ?? latestQuoteDate(officialQuotes);

  const quoteDates = useMemo(
    () => [...new Set(officialQuotes.map((item) => item.quoteDate))].sort(),
    [officialQuotes],
  );

  const pairById = useMemo(() => new Map(pairs.map((item) => [item.id, item])), [pairs]);

  const selectedQuoteDate = filters.quoteDate === undefined ? latestDate : filters.quoteDate || undefined;

  const currencies1 = [...new Set(officialQuotes.map((item) => item.currency1))];
  const currencies2 = [...new Set(officialQuotes.map((item) => item.currency2))];
  const pairOptions = useMemo(() => {
    const source = watchedSource ?? filters.source;
    const seen = new Map<string, string>();
    for (const item of officialQuotes) {
      if (source && item.quoteSource !== source) continue;
      seen.set(item.pair, item.pairLabel);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [officialQuotes, watchedSource, filters.source]);

  const filtered = useMemo(() => {
    return officialQuotes.filter((item) => {
      if (filters.currency1 && item.currency1 !== filters.currency1) return false;
      if (filters.currency2 && item.currency2 !== filters.currency2) return false;
      if (filters.pair && item.pair !== filters.pair) return false;
      if (filters.source && item.quoteSource !== filters.source) return false;
      if (selectedQuoteDate && item.quoteDate !== selectedQuoteDate) return false;
      if (filters.status === 'effective' && isQuoteLocked(item.quoteDate, unlockedQuoteDate)) return false;
      if (filters.status === 'locked' && !isQuoteLocked(item.quoteDate, unlockedQuoteDate)) return false;
      if (item.quoteDate === latestDate && !pairById.get(item.pairId)?.enabled) return false;
      return true;
    });
  }, [filters, officialQuotes, selectedQuoteDate, pairById, latestDate, unlockedQuoteDate]);

  const columns: ColumnsType<OfficialQuote> = [
    { title: '报价数据日', dataIndex: 'quoteDate', width: 108 },
    { title: '货币对', dataIndex: 'pairLabel', width: 96 },
    {
      title: '数据来源',
      dataIndex: 'quoteSource',
      width: 100,
      render: (source: OfficialQuote['quoteSource']) => <SourceTag source={source} />,
    },
    {
      title: '7日均价',
      dataIndex: 'avg7',
      align: 'right',
      width: 100,
      render: (value: string) => <span className="num-cell">{formatRate(value, 4)}</span>,
    },
    {
      title: '综合缓冲',
      dataIndex: 'combinedBuffer',
      align: 'right',
      width: 112,
      render: (value: string, record) => {
        const custom = isCustomDayQuote(record);
        return (
          <span className="buffer-cell">
            <span className={`buffer-value${custom ? ' is-custom' : ''}`}>{formatPercent(value)}</span>
            {custom ? <CustomBufferTag /> : null}
          </span>
        );
      },
    },
    {
      title: (
        <Tooltip title="客户以基准货币（货币对左侧，如 USD/CNY 中的 USD）结算时使用的报价，按均价下浮后向下取整">
          <span>基准货币报价</span>
        </Tooltip>
      ),
      dataIndex: 'quoteCcy1',
      align: 'right',
      width: 112,
      render: (value: string, record) => (
        <Tooltip title={`${record.currency1} 结算`}>
          <span className="num-cell quote-cell">{formatRate(value, 1)}</span>
        </Tooltip>
      ),
    },
    {
      title: (
        <Tooltip title="客户以计价货币（货币对右侧，如 USD/CNY 中的 CNY）结算时使用的报价，按均价上浮后向上取整">
          <span>计价货币报价</span>
        </Tooltip>
      ),
      dataIndex: 'quoteCcy2',
      align: 'right',
      width: 112,
      render: (value: string, record) => (
        <Tooltip title={`${record.currency2} 结算`}>
          <span className="num-cell quote-cell">{formatRate(value, 1)}</span>
        </Tooltip>
      ),
    },
    {
      title: '计算时间',
      dataIndex: 'calculatedAt',
      width: 156,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '状态',
      key: 'status',
      width: 88,
      render: (_, record) =>
        isQuoteLocked(record.quoteDate, unlockedQuoteDate) ? <LockedTag /> : <EffectiveTag />,
    },
    {
      title: '操作',
      key: 'action',
      width: 88,
      render: (_, record) => (
        <Button type="link" onClick={() => setRuleQuote(record)}>
          计算规则
        </Button>
      ),
    },
  ];

  return (
    <div className="page-wrap">
      <div className="page-header">
        <Title level={3}>履约报价汇率</Title>
        <Paragraph className="page-desc">
          官方报价按行情日存档，本页只读查询。缓冲因子与重算在「报价配置」。
        </Paragraph>
      </div>

      <Card className="page-card" variant="outlined">
        <Form
          className="filter-bar business-rates-filters"
          form={form}
          layout="inline"
          colon={false}
          initialValues={{ quoteDate: latestDate ? dayjs(latestDate) : undefined }}
          onFinish={(values: {
            currency1?: string;
            currency2?: string;
            pair?: string;
            source?: RateSource;
            quoteDate?: Dayjs;
            status?: QuoteStatusFilter;
          }) => {
            setFilters({
              currency1: values.currency1,
              currency2: values.currency2,
              pair: values.pair,
              source: values.source,
              quoteDate: values.quoteDate ? values.quoteDate.format('YYYY-MM-DD') : '',
              status: values.status,
            });
          }}
        >
          <div className="filter-fields">
            <Form.Item name="quoteDate" label="报价日期">
              <DatePicker
                className="filter-control"
                allowClear
                disabledDate={(date) => !quoteDates.includes(date.format('YYYY-MM-DD'))}
              />
            </Form.Item>
            <Form.Item name="pair" label="货币对">
              <Select allowClear placeholder="全部" className="filter-control" options={pairOptions} />
            </Form.Item>
            <Form.Item name="source" label="数据来源">
              <Select
                allowClear
                placeholder="全部"
                className="filter-control"
                options={RATE_SOURCE_IDS.map((source) => ({
                  value: source,
                  label: RATE_SOURCE_LABEL[source],
                }))}
                onChange={() => form.setFieldValue('pair', undefined)}
              />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                allowClear
                placeholder="全部"
                className="filter-control"
                options={[
                  { value: 'effective', label: '有效' },
                  { value: 'locked', label: '已锁定' },
                ]}
              />
            </Form.Item>
            <Form.Item name="currency1" label="基准货币">
              <Select
                allowClear
                placeholder="全部"
                className="filter-control"
                options={currencies1.map((item) => ({ value: item, label: item }))}
              />
            </Form.Item>
            <Form.Item name="currency2" label="计价货币">
              <Select
                allowClear
                placeholder="全部"
                className="filter-control"
                options={currencies2.map((item) => ({ value: item, label: item }))}
              />
            </Form.Item>
          </div>
          <div className="filter-actions">
            <Space>
              <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                查询
              </Button>
              <Button
                onClick={() => {
                  form.resetFields();
                  form.setFieldsValue({ quoteDate: latestDate ? dayjs(latestDate) : undefined });
                  setFilters({});
                }}
              >
                重置
              </Button>
            </Space>
          </div>
        </Form>

        <Table
          className="compact-table business-rates-table"
          size="middle"
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          tableLayout="fixed"
          scroll={{ x: 1064 }}
          pagination={{
            pageSize: 20,
            showTotal: (total) => `共 ${total} 条`,
            showSizeChanger: false,
            size: 'small',
          }}
        />
      </Card>

      <CalcRuleModal open={!!ruleQuote} quote={ruleQuote} onClose={() => setRuleQuote(null)} />
    </div>
  );
}
