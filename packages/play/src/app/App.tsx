import {
  Component,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type ComponentType,
} from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  ConfigProvider,
  Layout,
  Menu,
  Result,
  Row,
  Segmented,
  Space,
  Spin,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  ExperimentOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { getDemos } from "../common/registry.js";
import type { DemoEntry } from "../common/registry.js";
import {
  createThemeConfig,
  loadThemeMode,
  THEME_STORAGE_KEY,
  type PlayThemeMode,
} from "./theme.js";
import { useHashRoute } from "./useHashRoute.js";

const { Content, Header, Sider } = Layout;

export function AppShell() {
  const route = useHashRoute();
  const [mode, setMode] = useState<PlayThemeMode>(() => loadThemeMode());
  const [collapsed, setCollapsed] = useState(false);

  const demos = useMemo(() => getDemos(), []);
  const activeDemo = demos.find((demo) => demo.name === route);

  const menuItems: MenuProps["items"] = [
    { key: "home", icon: <AppstoreOutlined />, label: "概览" },
    ...demos.map((demo) => ({
      key: demo.name,
      icon: <ExperimentOutlined />,
      label: demo.name,
    })),
  ];

  const navigate = (key: string): void => {
    location.hash = key === "home" ? "#/" : `#/${key}`;
  };

  return (
    <ConfigProvider theme={createThemeConfig(mode)}>
      <AntdApp>
        <Layout style={{ height: "100vh" }}>
          <Sider
            theme="dark"
            collapsible
            collapsed={collapsed}
            onCollapse={setCollapsed}
            width={232}
            style={{ background: "#0f172a" }}
          >
            <div
              style={{
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: "linear-gradient(135deg, #818cf8, #4f46e5)",
                  flexShrink: 0,
                }}
              />
              {!collapsed && (
                <span
                  style={{
                    color: "#e2e8f0",
                    fontSize: 15,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  Marcus Play
                </span>
              )}
            </div>
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[route === "" ? "home" : route]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
              style={{ background: "transparent", borderInlineEnd: "none" }}
            />
          </Sider>
          <Layout style={{ minHeight: 0, overflow: "hidden" }}>
            <Header
              style={{
                padding: "0 24px",
                height: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: mode === "dark" ? "#0f172a" : "#ffffff",
                borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
              }}
            >
              <Typography.Text strong style={{ fontSize: 16 }}>
                {route === "" ? "概览" : (activeDemo?.label ?? route)}
              </Typography.Text>
              <Segmented<PlayThemeMode>
                value={mode}
                onChange={(value) => {
                  setMode(value);
                  localStorage.setItem(THEME_STORAGE_KEY, value);
                }}
                options={[
                  { value: "light", icon: <SunOutlined /> },
                  { value: "dark", icon: <MoonOutlined /> },
                ]}
              />
            </Header>
            <Content
              className="play-scroll"
              style={{
                overflow: "auto",
                minHeight: 0,
                padding: 24,
              }}
            >
              <div style={{ maxWidth: 1200, margin: "0 auto" }}>
                {route === "" ? (
                  <HomePage onOpen={navigate} />
                ) : (
                  <DemoPage
                    key={route}
                    name={route}
                    onBack={() => navigate("home")}
                  />
                )}
              </div>
            </Content>
          </Layout>
        </Layout>
      </AntdApp>
    </ConfigProvider>
  );
}

function HomePage({ onOpen }: { onOpen: (name: string) => void }) {
  const demos = getDemos();
  return (
    <Space orientation="vertical" size={24} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 4 }}>
          Play
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Marcus Monorepo 本地联调沙箱：按需加载 demo，验证各包的
          API、性能与降级行为。
        </Typography.Paragraph>
      </div>
      {demos.length === 0 ? (
        <Alert
          type="info"
          showIcon
          message="还没有注册任何 demo"
          description="在 src/demos/<pkg>/index.ts 里调用 registerDemo() 后即可在此显示。"
        />
      ) : (
        <Row gutter={[16, 16]}>
          {demos.map((demo) => (
            <Col xs={24} md={12} xl={8} key={demo.name}>
              <Card
                hoverable
                style={{ height: "100%" }}
                onClick={() => onOpen(demo.name)}
              >
                <Card.Meta
                  avatar={
                    <ExperimentOutlined
                      style={{ fontSize: 26, color: "#6366f1" }}
                    />
                  }
                  title={demo.label}
                  description={demo.description ?? "暂无描述"}
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Space>
  );
}

function DemoPage({ name, onBack }: { name: string; onBack: () => void }) {
  const demo = getDemos().find((d) => d.name === name);
  if (!demo) {
    return (
      <Result
        status="404"
        title="Demo 不存在"
        subTitle={`路由 #/${name} 没有对应的 demo 注册。`}
        extra={
          <Button type="primary" onClick={onBack}>
            返回概览
          </Button>
        }
      />
    );
  }

  return <DemoDetail demo={demo} onBack={onBack} />;
}

function DemoDetail({ demo, onBack }: { demo: DemoEntry; onBack: () => void }) {
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
        返回概览
      </Button>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          {demo.label}
        </Typography.Title>
        {demo.description && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {demo.description}
          </Typography.Paragraph>
        )}
      </div>
      <DemoErrorBoundary>
        <LazyDemo load={demo.load} />
      </DemoErrorBoundary>
    </Space>
  );
}

/**
 * 按需加载 demo 实现：load() 返回 { default: ComponentType }。
 * 用 state 驱动加载（而非渲染期 lazy()），符合 React Compiler 的
 * static-components 约束；卸载时通过 cancelled 标志丢弃过期结果。
 */
function LazyDemo({
  load,
}: {
  load: () => Promise<{ default: ComponentType }>;
}) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((mod) => {
        if (!cancelled) setComponent(() => mod.default);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (loadError) {
    return (
      <Alert
        type="error"
        showIcon
        message="Demo 加载失败"
        description={loadError.message}
      />
    );
  }
  if (!Component) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "64px 0",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }
  return <Component />;
}

/** 隔离 demo 的加载/渲染异常，避免单个 demo 崩溃拖垮整个 play。 */
class DemoErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Alert
          type="error"
          showIcon
          message="Demo 加载/渲染失败"
          description={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}
