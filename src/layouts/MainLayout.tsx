import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Layout, Menu, Tag, Typography, theme } from 'antd';
import { LineChartOutlined, UserOutlined } from '@ant-design/icons';
import { APP_VERSION, APP_VERSION_DATE, CURRENT_OPERATOR, CURRENT_OPERATOR_ROLE, SYSTEM_NAME } from '@/constants';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  const menuItems = [
    {
      key: 'fund-platform',
      icon: <LineChartOutlined />,
      label: '资金中台',
      children: [
        {
          key: 'rate-mgmt',
          label: SYSTEM_NAME,
          children: [
            { key: '/pairs', label: '报价配置' },
            { key: '/data', label: '汇率数据' },
            { key: '/business-rates', label: '履约报价' },
          ],
        },
      ],
    },
  ];

  return (
    <Layout className="app-shell">
      <Sider
        className="app-sider"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={228}
        theme="dark"
      >
        <div className={`app-logo${collapsed ? ' is-collapsed' : ''}`}>
          <span className="app-logo-mark">汇</span>
          {collapsed ? null : <span className="app-logo-text">{SYSTEM_NAME}</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={['fund-platform', 'rate-mgmt']}
          items={menuItems}
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
          }}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <div className="app-header-title">
            <Text strong>资金中台</Text>
            <span className="app-header-divider" />
            <Text type="secondary">{SYSTEM_NAME}</Text>
            <Tag className="app-version" bordered={false} color="blue">
              v{APP_VERSION}
            </Tag>
            <Text type="secondary" className="app-version-date">
              {APP_VERSION_DATE}
            </Text>
          </div>
          <div className="app-user">
            <Avatar icon={<UserOutlined />} size={28} style={{ background: token.colorPrimary }} />
            <div className="app-user-meta">
              <span className="name">{CURRENT_OPERATOR}</span>
              <span className="role">{CURRENT_OPERATOR_ROLE}</span>
            </div>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
