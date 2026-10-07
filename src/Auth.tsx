import {AvatarContent,avatarFromFile} from './Avatar';
import {Paged} from './Pagination';
import {BrandMark} from './Brand';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import {
  Orbit,
  ShieldCheck,
  LogOut,
  LockKeyhole,
  UserRound,
  Monitor,
  LoaderCircle,
} from "lucide-react";
import { request } from "./api";
import { ThemeSelector } from "./Theme";
import { useUnsavedChanges } from "./workspace/shared";
const SettingsPage = lazy(() => import("./workspace/SettingsPage"));
type User = {
  avatar?:string;
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
};
type Status = {
  available: boolean;
  message?:string;
  initialized: boolean;
  setupAllowed: boolean;
  user: User | null;
};
const Context = createContext<{
  user: User | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}>({ user: null, refresh: async () => {}, logout: async () => {} });
export const useAccount = () => useContext(Context);
export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation(),
    navigate = useNavigate(),
    [state, setState] = useState<Status>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [remember, setRemember] = useState(false),
    [notice, setNotice] = useState("");
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  const refresh = async () => {
    try {
      setState(await request<Status>("/api/auth/status"));
      setError("");
    } catch {
      setError("无法连接本地服务，请检查服务后重试");
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const expired = () => {
      setState((v) => (v ? { ...v, user: null } : v));
      setPassword("");
    };
    window.addEventListener("agentdock:unauthorized", expired);
    return () => {
      clearInterval(timer);
      window.removeEventListener("agentdock:unauthorized", expired);
    };
  }, []);
  const logout = async () => {
    if (
      document.querySelector('[data-dirty="true"]') &&
      !confirm("修改尚未保存，退出会放弃修改，是否继续？")
    )
      return;
    await request("/api/auth/logout", { method: "POST" });
    setState((v) => (v ? { ...v, user: null } : v));
    setPassword("");
  };
  const create = Boolean(state?.available && !state.initialized);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (create) {
        if (password !== confirmPassword) throw new Error("两次密码不一致");
        await request("/api/auth/create", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
      }
      await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password, remember }),
      });
      setPassword("");
      setConfirmPassword("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (demo || state?.user)
    return (
      <Context.Provider value={{ user: state?.user || null, refresh, logout }}>
        {children}
      </Context.Provider>
    );
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <div className="auth-brand">
          <BrandMark /> AgentDock<span>智能体任务坞</span>
        </div>
        <ThemeSelector />
      </header>
      <main className="auth-layout">
        <section className="auth-story">
          <span className="auth-kicker">YOUR LOCAL AI COMMAND CENTER</span>
          <h1>
            让每一次推进，
            <br />
            <em>都有迹可循。</em>
          </h1>
          <p>把分散在不同工具里的工作，汇成清晰的任务、进展与下一步。</p>
          <div className="auth-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
            <BrandMark size={68} />
            <span>AD</span>
          </div>
          <div className="auth-tools">
            Codex · Claude · Cursor · Pi · DeepSeek · WorkBuddy
          </div>
          <p className="auth-privacy">
            <ShieldCheck size={16} /> 本机采集 · 原始记录只读 · 按需模型分析
          </p>
        </section>
        <section className="auth-card">
          {!state ? (
            <>
              <LoaderCircle className="spin" />
              <h2>正在连接工作空间</h2>
              {error && <p role="alert">{error}</p>}
              <button className="outline-button" onClick={() => void refresh()}>
                重新连接
              </button>
            </>
          ) : state.setupAllowed ? (
            <>
              <span className="auth-kicker">GET STARTED</span>
              <h2>配置数据库</h2>
              <p className="muted">先连接你的 MySQL，再创建专属账号。</p>
              <Suspense fallback={<p>载入设置…</p>}>
                <SettingsPage
                  demo={false}
                  notify={(message) => {
                    setNotice(message);
                    void refresh();
                  }}
                  setupOnly
                />
              </Suspense>
            </>
          ) : !state.available ? (
            <>
              <h2>数据库暂不可用</h2>
              <p className="muted">
                {state.message||'请恢复已配置的 MySQL 连接。'} 工作记录保持受保护。
              </p>
              <button className="outline-button" onClick={() => void refresh()}>
                重新检查
              </button>
            </>
          ) : (
            <>
              <span className="auth-kicker">
                {create ? "CREATE YOUR WORKSPACE" : "WELCOME BACK"}
              </span>
              <h2>{create ? "创建工作空间账号" : "登录你的工作空间"}</h2>
              <p className="muted">
                {create
                  ? "首次创建后，工作记录与配置需要登录才能访问。"
                  : "登录后继续查看任务、报告与智能体进展。"}
              </p>
              <form onSubmit={(e) => void submit(e)}>
                <label className="field-label">
                  账号
                  <input
                    aria-label="登录账号"
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={64}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label className="field-label">
                  密码
                  <input
                    aria-label="登录密码"
                    type="password"
                    autoComplete={create ? "new-password" : "current-password"}
                    required
                    minLength={6}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                {create && (
                  <label className="field-label">
                    确认密码
                    <input
                      aria-label="确认登录密码"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </label>
                )}
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  保持登录 7 天（默认 8 小时）
                </label>
                {error && (
                  <div className="error-banner" role="alert">
                    {error}
                  </div>
                )}
                <button className="primary-button" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <LockKeyhole size={17} />
                  )}{" "}
                  {create ? "创建并进入" : "登录工作空间"}
                </button>
              </form>
              <small className="muted">
                账号属于当前 MySQL 工作空间；密码以加盐哈希保存。
              </small>
            </>
          )}
          {notice && (
            <p className="import-banner" role="status">
              {notice}
            </p>
          )}
          <button
            className="text-button auth-demo"
            aria-label="查看演示体验"
            onClick={() => navigate("/?demo=1")}
          >
            查看演示体验 ↗
          </button>
        </section>
      </main>
    </div>
  );
}
export function AccountPage() {
  const { user, refresh, logout } = useAccount(),
    [displayName, setName] = useState(user?.displayName || ""),
    [currentPassword, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [sessions, setSessions] = useState<
      {
        id: string;
        label: string;
        createdAt: number;
        expiresAt: number;
        current: boolean;
      }[]
    >([]);
  const dirty = Boolean(
    user &&
    (displayName !== user.displayName ||
      currentPassword ||
      password ||
      confirmation),
  );
  useUnsavedChanges(dirty);
  const load = () =>
    request<typeof sessions>("/api/account/sessions").then(setSessions);
  useEffect(() => {
    if (user) void load().catch((e) => setError(e.message));
  }, [user]);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(message);
      await refresh();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user)
    return (
      <section className="source-panel">
        <h2>演示账号中心</h2>
        <p>演示不创建真实账号或登录会话。退出演示后可配置自己的工作空间。</p>
      </section>
    );
  return (
    <div className="workspace-page" data-dirty={dirty}>
      <div className="section-heading">
        <h2>账号中心</h2>
        <span>当前工作空间的所有者</span>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="import-banner" role="status">
          {message}
        </p>
      )}
      <div className="settings-grid">
        <section className="source-panel">
          <h3>
            <UserRound size={19} /> 个人资料
          </h3>
          <p>账号：{user.username}</p><span className="avatar"><AvatarContent/></span><label className="field-label">更换头像<input aria-label="更换头像" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void action(async()=>{const avatar=await avatarFromFile(f);return request('/api/account/avatar',{method:'PATCH',body:JSON.stringify({avatar})});},'头像已保存');}}/></label><button className="text-button" disabled={busy||!user.avatar} onClick={()=>void action(()=>request('/api/account/avatar',{method:'PATCH',body:JSON.stringify({avatar:''})}),'已恢复默认头像')}>恢复默认头像</button>
          <label className="field-label">
            显示名称
            <input
              aria-label="显示名称"
              value={displayName}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            className="primary-button"
            onClick={() =>
              void action(
                () =>
                  request("/api/account/profile", {
                    method: "PATCH",
                    body: JSON.stringify({ displayName }),
                  }),
                "个人资料已保存",
              )
            }
          >
            保存资料
          </button>
          <p className="muted">账号保护本机工作空间，当前采用单所有者模式。</p>
          <button
            className="outline-button"
            onClick={() => void logout().catch((e) => setError(e.message))}
          >
            <LogOut size={16} />
            退出登录 / 锁定工作空间
          </button>
        </section>
        <section className="source-panel">
          <h3>
            <LockKeyhole size={19} /> 修改密码
          </h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (password !== confirmation) {
                setError("两次新密码不一致");
                return;
              }
              void action(async () => {
                await request("/api/account/password", {
                  method: "POST",
                  body: JSON.stringify({ currentPassword, password }),
                });
                setCurrent("");
                setPassword("");
                setConfirmation("");
              }, "密码已更新，请重新登录");
            }}
          >
            <label className="field-label">
              当前密码
              <input
                aria-label="当前密码"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={currentPassword}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label className="field-label">
              新密码
              <input
                aria-label="新密码"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="field-label">
              再次输入新密码
              <input
                aria-label="再次输入新密码"
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <p className="muted">修改后所有网页版和桌面端登录会话立即失效。</p>
            <button className="primary-button" disabled={busy}>
              更新密码并重新登录
            </button>
          </form>
        </section>
      </div>
      <section className="source-panel account-sessions">
        <div className="section-heading">
          <h3>
            <Monitor size={19} /> 登录会话
          </h3>
          <button
            className="outline-button"
            disabled={busy}
            onClick={() =>
              void action(
                () => request("/api/account/revoke", { method: "POST" }),
                "其他登录会话已退出",
              )
            }
          >
            退出其他会话
          </button>
        </div>
        <Paged label="登录会话">{sessions.map((s) => (
          <div className="account-session" key={s.id}>
            <Monitor size={20} />
            <div>
              <strong>
                {s.label} {s.current && "· 当前会话"}
              </strong>
              <p className="muted">
                登录于 {new Date(s.createdAt).toLocaleString("zh-CN")} · 到期{" "}
                {new Date(s.expiresAt).toLocaleString("zh-CN")}
              </p>
            </div>
          </div>
        ))}</Paged>
      </section>
    </div>
  );
}
