import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Text, useTextScale } from './textScale';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme, type NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Bell, Building2, Ellipsis, Files, Inbox, LayoutGrid } from 'lucide-react-native';
import { BackendProvider, type Backend } from '@argolet/client';
import { createMobileBackend } from './backend';
import { SessionProvider, useSession } from './session';
import { C, font } from './theme';
import { Button, Loading, Notice, T } from './ui';
import * as A from './screens/auth';
import * as M from './screens/main';
import * as X from './screens/modules';
import { FinanceToolsScreen } from './screens/tools';
import { FinanceBooksScreen } from './screens/books';

type TabParams = { Overview: undefined; Inbox: undefined; Documents: undefined; More: undefined };
type RootParams = {
  Login: undefined;
  Register: { invite?: string } | undefined;
  Verify: { contact: string; devCode?: string | undefined };
  Reset: undefined;
  Workspaces: undefined;
  CreateOrg: undefined;
  Invite: { code?: string } | undefined;
  Connect: undefined;
  Server: undefined;
  Main: NavigatorScreenParams<TabParams> | undefined;
  Capture: undefined;
  Review: { id: string };
  Reconcile: undefined;
  ReconDetail: { id: string };
  Match: { id: string };
  Approval: { id: string };
  Close: undefined;
  DecisionPack: undefined;
  Evidence: { id: string };
  Verification: { id: string };
  Assistant: undefined;
  Notifications: undefined;
  Ingestion: undefined;
  DailyClose: undefined;
  Inventory: undefined;
  Purchasing: undefined;
  Books: undefined;
  Clients: undefined;
  Sales: undefined;
  Projects: undefined;
  Finance: undefined;
  FinanceTools: undefined;
  FinanceBooks: undefined;
  Scenarios: undefined;
  Assets: undefined;
  Logistics: undefined;
  LogisticsFinance: undefined;
  Group: undefined;
  Intercompany: undefined;
  Members: undefined;
  Settings: undefined;
  Security: undefined;
};
export type ScreenProps<K extends keyof RootParams> = NativeStackScreenProps<RootParams, K>;

const Stack = createNativeStackNavigator<RootParams>();
const Tab = createBottomTabNavigator<TabParams>();

function ContextHeader({ onBell }: { onBell: () => void }) {
  const { ctx } = useSession();
  const insets = useSafeAreaInsets();
  const scope = ctx?.scope.entityId === '*' ? 'Tất cả cơ sở' : (ctx?.scope.label.replace('Cơ sở ', '') ?? '');
  const legal =
    ctx?.entities.find((e) => e.kind === 'LEGAL_ENTITY' && ctx.entities.some((s) => s.parentId === e.id))
      ?.shortName ?? ctx?.tenant.name;
  return (
    <View
      style={{
        paddingTop: insets.top + 8,
        paddingHorizontal: 16,
        paddingBottom: 8,
        backgroundColor: C.bg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Building2 size={20} color={C.muted} />
      <Text style={{ flex: 1, fontSize: 13, color: C.text, fontFamily: font }} numberOfLines={1}>
        {legal}, {scope}
      </Text>
      <Pressable onPress={onBell} accessibilityLabel="Thông báo" hitSlop={10}>
        <Bell size={22} color={C.muted} />
        {ctx && ctx.counts.unreadNotifications > 0 && (
          <View
            style={{
              position: 'absolute',
              top: -1,
              right: -1,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: C.action,
            }}
          />
        )}
      </Pressable>
    </View>
  );
}

function Tabs({ navigation }: ScreenProps<'Main'>) {
  const { ctx } = useSession();
  const insets = useSafeAreaInsets();
  const k = useTextScale();
  return (
    <Tab.Navigator
      screenOptions={{
        header: () => <ContextHeader onBell={() => navigation.navigate('Notifications')} />,
        tabBarActiveTintColor: C.action,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: { fontSize: 12 * k, lineHeight: 16 * k, fontFamily: font },
        tabBarStyle: {
          borderTopColor: C.line,
          height: Math.round(64 + 30 * (k - 1)) + Math.max(insets.bottom, 8),
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
      }}
    >
      <Tab.Screen
        name="Overview"
        component={M.OverviewScreen}
        options={{ title: 'Tổng quan', tabBarIcon: ({ color }) => <LayoutGrid size={20} color={color} /> }}
      />
      <Tab.Screen
        name="Inbox"
        component={M.InboxScreen}
        options={{
          title: 'Công việc',
          tabBarBadge: ctx?.counts.inbox || undefined,
          tabBarIcon: ({ color }) => <Inbox size={20} color={color} />,
        }}
      />
      <Tab.Screen
        name="Documents"
        component={M.DocumentsScreen}
        options={{ title: 'Chứng từ', tabBarIcon: ({ color }) => <Files size={20} color={color} /> }}
      />
      <Tab.Screen
        name="More"
        component={M.MoreScreen}
        options={{ title: 'Thêm', tabBarIcon: ({ color }) => <Ellipsis size={20} color={color} /> }}
      />
    </Tab.Navigator>
  );
}

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: C.bg,
    primary: C.action,
    card: '#fff',
    text: C.text,
    border: C.line,
  },
};

function Navigator() {
  const { status } = useSession();
  const k = useTextScale();
  if (status === 'loading') return <Loading />;
  const header = {
    headerShadowVisible: false,
    headerStyle: { backgroundColor: C.bg },
    headerTintColor: C.brand,
    headerTitleStyle: { fontFamily: font, fontWeight: '700' as const, fontSize: 17 * k },
    headerBackTitle: 'Quay lại',
  };
  return (
    <Stack.Navigator screenOptions={header}>
      {status === 'anon' ? (
        <Stack.Group navigationKey="anon">
          <Stack.Screen name="Login" component={A.LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Register" component={A.RegisterScreen} options={{ title: '' }} />
          <Stack.Screen name="Verify" component={A.VerifyScreen} options={{ title: '' }} />
          <Stack.Screen name="Reset" component={A.ResetScreen} options={{ title: '' }} />
          <Stack.Screen name="Server" component={A.ServerScreen} options={{ title: 'Máy chủ' }} />
        </Stack.Group>
      ) : status === 'no-workspace' ? (
        <Stack.Group navigationKey="no-workspace">
          <Stack.Screen name="Workspaces" component={A.WorkspacesScreen} options={{ headerShown: false }} />
          <Stack.Screen name="CreateOrg" component={A.CreateOrgScreen} options={{ title: '' }} />
          <Stack.Screen name="Invite" component={A.InviteScreen} options={{ title: '' }} />
        </Stack.Group>
      ) : (
        <Stack.Group navigationKey="ready">
          <Stack.Screen name="Main" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="Connect" component={A.ConnectScreen} options={{ title: '' }} />
          <Stack.Screen
            name="Workspaces"
            component={A.WorkspacesScreen}
            options={{ title: 'Không gian làm việc' }}
          />
          <Stack.Screen name="CreateOrg" component={A.CreateOrgScreen} options={{ title: '' }} />
          <Stack.Screen name="Invite" component={A.InviteScreen} options={{ title: '' }} />
          <Stack.Screen name="Capture" component={M.CaptureScreen} options={{ title: '' }} />
          <Stack.Screen name="Review" component={M.ReviewScreen} options={{ title: 'Kiểm tra chứng từ' }} />
          <Stack.Screen name="Reconcile" component={M.ReconcileScreen} options={{ title: '' }} />
          <Stack.Screen
            name="ReconDetail"
            component={M.ReconDetailScreen}
            options={{ title: 'Chi tiết đối soát' }}
          />
          <Stack.Screen name="Match" component={M.MatchScreen} options={{ title: 'Ghép giao dịch' }} />
          <Stack.Screen name="Approval" component={M.ApprovalScreen} options={{ title: 'Phê duyệt hồ sơ' }} />
          <Stack.Screen name="Close" component={M.CloseScreen} options={{ title: 'Chốt kỳ dữ liệu' }} />
          <Stack.Screen
            name="DecisionPack"
            component={M.DecisionPackScreen}
            options={{ title: 'Bộ hồ sơ quyết định' }}
          />
          <Stack.Screen
            name="Evidence"
            component={M.EvidenceScreen}
            options={{ title: 'Bằng chứng & lịch sử' }}
          />
          <Stack.Screen
            name="Verification"
            component={M.VerificationScreen}
            options={{ title: 'Kiểm tra toàn vẹn' }}
          />
          <Stack.Screen
            name="Assistant"
            component={M.AssistantScreen}
            options={{ title: 'Trợ lý ARGOLET' }}
          />
          <Stack.Screen
            name="Notifications"
            component={M.NotificationsScreen}
            options={{ title: 'Thông báo' }}
          />
          <Stack.Screen name="Ingestion" component={M.IngestionScreen} options={{ title: 'Nhập dữ liệu' }} />
          <Stack.Screen
            name="DailyClose"
            component={X.DailyCloseScreen}
            options={{ title: 'Chốt ca & chốt ngày' }}
          />
          <Stack.Screen
            name="Inventory"
            component={X.InventoryScreen}
            options={{ title: 'Kho & giá thành' }}
          />
          <Stack.Screen
            name="Purchasing"
            component={X.PurchasingScreen}
            options={{ title: 'Mua hàng & công nợ' }}
          />
          <Stack.Screen name="Books" component={X.BooksScreen} options={{ title: 'Sổ sách & thuế' }} />
          <Stack.Screen
            name="Clients"
            component={X.ClientsScreen}
            options={{ title: 'Không gian khách hàng' }}
          />
          <Stack.Screen name="Sales" component={X.SalesScreen} options={{ title: 'Bán hàng & thu nợ' }} />
          <Stack.Screen
            name="Projects"
            component={X.ProjectsScreen}
            options={{ title: 'Dự án & công việc' }}
          />
          <Stack.Screen
            name="Finance"
            component={X.FinanceScreen}
            options={{ title: 'Phân tích tài chính' }}
          />
          <Stack.Screen
            name="FinanceTools"
            component={FinanceToolsScreen}
            options={{ title: 'Công cụ tính toán' }}
          />
          <Stack.Screen
            name="FinanceBooks"
            component={FinanceBooksScreen}
            options={{ title: 'Sổ sách & chỉ số' }}
          />
          <Stack.Screen
            name="Scenarios"
            component={X.ScenariosScreen}
            options={{ title: 'So sánh kịch bản' }}
          />
          <Stack.Screen name="Assets" component={X.AssetsScreen} options={{ title: 'Tài sản & đo lường' }} />
          <Stack.Screen
            name="Logistics"
            component={X.LogisticsScreen}
            options={{ title: 'Hồ sơ logistics' }}
          />
          <Stack.Screen
            name="LogisticsFinance"
            component={X.LogisticsFinanceScreen}
            options={{ title: 'Tài chính logistics' }}
          />
          <Stack.Screen name="Group" component={X.GroupScreen} options={{ title: 'Điều hành tập đoàn' }} />
          <Stack.Screen
            name="Intercompany"
            component={X.IntercompanyScreen}
            options={{ title: 'Đối soát nội bộ' }}
          />
          <Stack.Screen
            name="Members"
            component={X.MembersScreen}
            options={{ title: 'Thành viên & phân quyền' }}
          />
          <Stack.Screen
            name="Settings"
            component={X.SettingsScreen}
            options={{ title: 'Cài đặt & tích hợp' }}
          />
          <Stack.Screen
            name="Security"
            component={X.SecurityScreen}
            options={{ title: 'Bảo mật tài khoản' }}
          />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError(null);
    createMobileBackend().then(setBackend, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Không khởi động được'),
    );
  }, [attempt]);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {!backend ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#fff',
            padding: 24,
          }}
        >
          <Image
            source={require('../assets/logo.jpg')}
            style={{ width: 180, height: 120 }}
            resizeMode="contain"
            accessibilityLabel="ARGOLET"
          />
          {error ? (
            <View style={{ alignSelf: 'stretch' }}>
              <Notice tone="danger">{error}</Notice>
              <Button title="Thử lại" variant="primary" onPress={() => setAttempt((n) => n + 1)} />
            </View>
          ) : (
            <Text style={[T.small, { marginTop: 16 }]}>Đang khởi động</Text>
          )}
        </View>
      ) : (
        <BackendProvider backend={backend}>
          <NavigationContainer theme={theme}>
            <SessionProvider>
              <Navigator />
            </SessionProvider>
          </NavigationContainer>
        </BackendProvider>
      )}
    </SafeAreaProvider>
  );
}
