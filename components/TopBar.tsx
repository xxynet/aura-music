import React, { useRef, useState } from "react";
import { useI18n } from "../hooks/useI18n";
import { AuraLogo, SearchIcon, LocalMusicIcon, InfoIcon, FullscreenIcon, PlusIcon } from "./Icons";
import AboutDialog from "./AboutDialog";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";

interface TopBarProps {
  onFilesSelected: (files: FileList) => void;
  onSearchClick: () => void;
  onRoomClick: () => void;
  disabled?: boolean;
  roomCreatorName?: string | null;
  roomViewers?: { displayName: string; isGuest: boolean }[];
}

const TopBar: React.FC<TopBarProps> = ({
  onFilesSelected,
  onSearchClick,
  onRoomClick,
  disabled,
  roomCreatorName,
  roomViewers,
}) => {
  const { dict } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTopBarActive, setIsTopBarActive] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirm, setRegisterConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { user, status, displayName, login, register, logout } = useAuth();
  const { toast } = useToast();

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message} (${err.name})`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => {
          setIsFullscreen(false);
        });
      }
    }
  };

  const activateTopBar = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    setIsTopBarActive(true);
    hideTimeoutRef.current = setTimeout(() => {
      setIsTopBarActive(false);
      hideTimeoutRef.current = null;
    }, 2500);
  };

  const handlePointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") {
      return;
    }

    const wasActive = isTopBarActive;

    if (!wasActive) {
      event.preventDefault();
      event.stopPropagation();
    }

    activateTopBar();
  };

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
    e.target.value = "";
  };

  const baseTransitionClasses = "transition-all duration-300 ease-out";
  const childClasses = isTopBarActive
    ? "opacity-100 translate-y-0 pointer-events-auto"
    : "opacity-0 -translate-y-3 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto";
  const bgClasses = isTopBarActive
    ? "opacity-100"
    : "opacity-0 group-hover:opacity-100";

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdentifier.trim() || !loginPassword) {
      toast.error("请输入用户名/邮箱和密码");
      return;
    }
    try {
      setSubmitting(true);
      await login(loginIdentifier.trim(), loginPassword);
      toast.success("登录成功");
      setIsAuthOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerUsername.trim() || !registerPassword) {
      toast.error("请输入用户名和密码");
      return;
    }
    if (registerPassword !== registerConfirm) {
      toast.error("两次输入的密码不一致");
      return;
    }
    try {
      setSubmitting(true);
      const emailValue = registerEmail.trim() || null;
      await register(registerUsername.trim(), emailValue, registerPassword);
      toast.success("注册并登录成功");
      setIsAuthOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "注册失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      toast.success("已退出登录");
    } catch {
      toast.error("退出失败");
    }
  };

  return (
    <div
      className="fixed top-0 left-0 w-full h-14 z-[60] group"
      onPointerDownCapture={handlePointerDownCapture}
    >
      {/* Blur Background Layer */}
      <div className={`absolute inset-0 bg-black/15 dark:bg-black/20 backdrop-blur-xl border-b border-white/5 ${baseTransitionClasses} ${bgClasses}`}></div>

      {/* Content */}
      <div className="relative z-10 w-full h-full px-6 flex justify-between items-center pointer-events-none">
        {/* Logo / Title */}
        <div className={`flex items-center gap-3 ${baseTransitionClasses} ${childClasses}`}>
          <div className="w-9 h-9 rounded-[10px] overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-white/10 flex-shrink-0">
            <AuraLogo className="w-full h-full" />
          </div>
          <span className="text-white/90 font-semibold tracking-tight text-[15px] hidden sm:block">
            {dict.app.name}
          </span>
        </div>

        {/* Actions */}
        <div className={`flex gap-2 ${baseTransitionClasses} ${childClasses}`}>
          {/* Room Button */}
          <button
            onClick={onRoomClick}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] pointer-events-auto"
            title="Create or Join Room"
          >
            <PlusIcon className="w-5 h-5" />
          </button>
          {/* Search Button */}
          <button
            onClick={onSearchClick}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] pointer-events-auto"
            title={dict.top.search}
          >
            <SearchIcon className="w-[18px] h-[18px]" />
          </button>

          {/* Import Button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] disabled:opacity-40 disabled:scale-100 disabled:cursor-not-allowed pointer-events-auto"
            title={dict.top.importLocal}
          >
            <LocalMusicIcon className="w-[18px] h-[18px]" />
          </button>

          {/* About Button */}
          <button
            onClick={() => setIsAboutOpen(true)}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] pointer-events-auto"
            title={dict.top.about}
          >
            <InfoIcon className="w-[18px] h-[18px]" />
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 active:scale-95 text-white/75 hover:text-white transition-all duration-200 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.05)] pointer-events-auto"
            title={isFullscreen ? dict.top.exitFullscreen : dict.top.enterFullscreen}
          >
            <FullscreenIcon className="w-[18px] h-[18px]" isFullscreen={isFullscreen} />
          </button>

          <button
            onClick={() => setIsAuthOpen(true)}
            className="h-10 px-3 rounded-full bg-white/10 backdrop-blur-xl border border-white/10 flex items-center justify-center text-xs text-white/80 hover:bg-white/20 hover:text-white transition-all shadow-sm max-w-[120px]"
            title={user ? "Account" : "Sign in"}
          >
            <span className="truncate">
              {status === "loading" ? "..." : displayName}
            </span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="audio/*,.lrc,.txt,.json"
            multiple
            className="hidden"
          />
        </div>
      </div>
      <AboutDialog isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
      {isAuthOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4" onClick={() => setIsAuthOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {user ? "账号" : authTab === "login" ? "登录" : "注册"}
              </h2>
              {user && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-xs text-white/70 hover:text-white px-3 py-1 rounded-full bg-white/10"
                >
                  退出
                </button>
              )}
            </div>
            {!user && (
              <div className="flex mb-4 bg-white/5 rounded-full p-1">
                <button
                  type="button"
                  onClick={() => setAuthTab("login")}
                  className={`flex-1 text-xs py-1.5 rounded-full ${authTab === "login" ? "bg-white text-black" : "text-white/70"}`}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => setAuthTab("register")}
                  className={`flex-1 text-xs py-1.5 rounded-full ${authTab === "register" ? "bg-white text-black" : "text-white/70"}`}
                >
                  注册
                </button>
              </div>
            )}
            {user ? (
              <div className="space-y-2 text-sm text-white/80">
                <div className="flex justify-between">
                  <span className="text-white/60">用户名</span>
                  <span>{user.username}</span>
                </div>
                {user.email && (
                  <div className="flex justify-between">
                    <span className="text-white/60">邮箱</span>
                    <span>{user.email}</span>
                  </div>
                )}
              </div>
            ) : authTab === "login" ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-white/60 mb-1">用户名或邮箱</label>
                  <input
                    type="text"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40"
                    placeholder="your-name"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">密码</label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-black hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? "登录中..." : "登录"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-white/60 mb-1">用户名</label>
                  <input
                    type="text"
                    value={registerUsername}
                    onChange={(e) => setRegisterUsername(e.target.value)}
                    className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40"
                    placeholder="your-name"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">邮箱（可选）</label>
                  <input
                    type="email"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">密码</label>
                  <input
                    type="password"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40"
                    placeholder="至少 6 位密码"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/60 mb-1">确认密码</label>
                  <input
                    type="password"
                    value={registerConfirm}
                    onChange={(e) => setRegisterConfirm(e.target.value)}
                    className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40"
                    placeholder="再次输入密码"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full mt-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-black hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? "注册中..." : "注册并登录"}
                </button>
              </form>
            )}
            <div className="mt-5 space-y-2 text-xs text-white/70">
              {roomCreatorName && (
                <div className="flex justify-between">
                  <span>房主</span>
                  <span className="text-white/90">{roomCreatorName}</span>
                </div>
              )}
              {roomViewers && roomViewers.length > 0 && (
                <div>
                  <div className="mb-1">当前观众</div>
                  <div className="flex flex-wrap gap-2">
                    {roomViewers.map((viewer, idx) => (
                      <span
                        key={`${viewer.displayName}-${idx}`}
                        className="px-2 py-1 rounded-full bg-white/10 text-[11px] text-white/80"
                      >
                        {viewer.displayName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TopBar;
