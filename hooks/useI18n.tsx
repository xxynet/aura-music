import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Lang = "en" | "zh";

interface Dict {
  app: {
    name: string;
    welcome: string;
    selectSong: string;
    importFail: string;
    importOk: (count: number) => string;
  };
  about: {
    descStart: string;
    descEmphasis: string;
    descEnd: string;
    viewGitHub: string;
    createdBy: string;
    done: string;
  };
  top: {
    search: string;
    importLocal: string;
    about: string;
    enterFullscreen: string;
    exitFullscreen: string;
    room: string;
  };
  controls: {
    albumArt: string;
    noMusic: string;
    settings: string;
    playback: string;
    previous: string;
    next: string;
    queue: string;
    speed: string;
    nightcore: string;
    original: string;
    nightcoreShort: string;
    originalShort: string;
  };
  import: {
    title: string;
    hintStart: string;
    hintBrand: string;
    hintEnd: string;
    placeholder: string;
    cancel: string;
    action: string;
    loading: string;
  };
  keys: {
    title: string;
    subtitle: string;
    playPause: string;
    loop: string;
    seek: string;
    prevNext: string;
    volume: string;
    volumeDialog: string;
    speedDialog: string;
    search: string;
    playlist: string;
    toggle: string;
    press: string;
    close: string;
  };
  lyrics: {
    syncing: string;
    empty: string;
  };
  list: {
    playingNext: string;
    songs: (count: number) => string;
    selectAll: string;
    deleteSelected: string;
    done: string;
    addFromUrl: string;
    edit: string;
    empty: string;
    drag: string;
    reorder: (title: string) => string;
  };
  search: {
    online: string;
    queue: string;
    emptyQueue: string;
    press: string;
    toSearch: string;
    noMatches: string;
    loading: string;
    searchCloud: string;
    cloud: string;
    more: string;
    playNow: string;
    addToQueue: string;
    queueLabel: string;
    cloudLabel: string;
  };
  playlist: {
    invalidUrl: string;
    unknownArtist: string;
  };
  room: {
    title: string;
    subtitle: string;
    id: string;
    share: string;
    copied: string;
    copyFail: string;
    creator: string;
    viewers: (count: number) => string;
    playing: string;
    paused: string;
    idle: string;
    queue: (count: number) => string;
    connecting: string;
    connected: string;
    disconnected: string;
    enter: string;
    solo: string;
    leave: string;
    delete: string;
    deleteConfirm: string;
    deleteFail: string;
    deleted: string;
    deletedDesc: string;
    missing: string;
    missingDesc: string;
    home: string;
    invalidId: string;
    createExists: string;
    createFail: string;
  };
  settings: {
    title: string;
    general: string;
    users: string;
    rooms: string;
    allowRegister: string;
    allowRegisterDesc: string;
    allowUpload: string;
    allowUploadDesc: string;
    saved: string;
    fail: string;
    loadFail: string;
    colId: string;
    colUser: string;
    colEmail: string;
    colRole: string;
    colJoined: string;
    colActions: string;
    admin: string;
    user: string;
    you: string;
    delete: string;
    confirm: string;
    empty: string;
    host: string;
    songs: (count: number) => string;
    playing: string;
    enter: string;
    noEmail: string;
  };
  bg: {
    loading: string;
  };
  pwa: {
    updateTitle: string;
    updateDesc: string;
    updateAction: string;
    later: string;
    offlineTitle: string;
    offlineDesc: string;
    close: string;
  };
}

export const dicts: Record<Lang, Dict> = {
  en: {
    app: {
      name: "Aura Music",
      welcome: "Welcome to Aura",
      selectSong: "Select a song",
      importFail: "Failed to load songs from URL",
      importOk: (count) => `Successfully imported ${count} songs`,
    },
    about: {
      descStart: "An experimental, pure web music player crafted with",
      descEmphasis: "Vibe Coding",
      descEnd: "technology.",
      viewGitHub: "View on GitHub",
      createdBy: "Created by dingyi222666",
      done: "Done",
    },
    top: {
      search: "Search (Cmd+K)",
      importLocal: "Import Local Files",
      about: "About Aura Music",
      enterFullscreen: "Enter Fullscreen",
      exitFullscreen: "Exit Fullscreen",
      room: "Sync Room",
    },
    controls: {
      albumArt: "Album Art",
      noMusic: "No Music Loaded",
      settings: "Settings/More",
      playback: "Playback Mode",
      previous: "Previous",
      next: "Next",
      queue: "Queue",
      speed: "Speed",
      nightcore: "Nightcore",
      original: "Original",
      nightcoreShort: "NC",
      originalShort: "ORG",
    },
    import: {
      title: "Import Music",
      hintStart: "Paste a",
      hintBrand: "Netease Cloud Music",
      hintEnd: "song or playlist link to add to queue.",
      placeholder: "https://music.163.com/...",
      cancel: "Cancel",
      action: "Import",
      loading: "Importing...",
    },
    keys: {
      title: "Keyboard Shortcuts",
      subtitle: "Quick controls for playback",
      playPause: "Play / Pause",
      loop: "Loop Mode",
      seek: "Seek ±5s",
      prevNext: "Prev / Next Song",
      volume: "Volume Control",
      volumeDialog: "Volume Dialog",
      speedDialog: "Speed Dialog",
      search: "Search",
      playlist: "Toggle Playlist",
      toggle: "Toggle Shortcuts",
      press: "Press",
      close: "to close",
    },
    lyrics: {
      syncing: "Syncing Lyrics...",
      empty: "Play music to view lyrics",
    },
    list: {
      playingNext: "Playing Next",
      songs: (count) => `${count} Songs`,
      selectAll: "Select All",
      deleteSelected: "Delete Selected",
      done: "Done",
      addFromUrl: "Add from URL",
      edit: "Edit List",
      empty: "Queue is empty",
      drag: "Drag to reorder",
      reorder: (title) => `Reorder ${title}`,
    },
    search: {
      online: "Search online...",
      queue: "Filter queue...",
      emptyQueue: "No songs in queue",
      press: "Press",
      toSearch: "to search",
      noMatches: "No matches found",
      loading: "Searching...",
      searchCloud: "Search Cloud Music",
      cloud: "Cloud",
      more: "Scroll for more",
      playNow: "Play Now",
      addToQueue: "Add to Queue",
      queueLabel: "Current Queue",
      cloudLabel: "Cloud Music",
    },
    playlist: {
      invalidUrl:
        "Invalid Netease URL. Use https://music.163.com/#/song?id=... or playlist",
      unknownArtist: "Unknown Artist",
    },
    room: {
      title: "Sync Room",
      subtitle: "You are about to join a shared listening room. Once inside, playback stays in sync with everyone here.",
      id: "Room ID",
      share: "Copy invite link",
      copied: "Invite link copied",
      copyFail: "Failed to copy link",
      creator: "Host",
      viewers: (count) => `${count} in room`,
      playing: "Now Playing",
      paused: "Paused",
      idle: "Nothing playing yet",
      queue: (count) => `${count} songs in queue`,
      connecting: "Connecting...",
      connected: "Synced",
      disconnected: "Reconnecting...",
      enter: "Enter Room",
      solo: "Listen locally instead",
      leave: "Leave Room",
      delete: "Delete Room",
      deleteConfirm: "Tap again to confirm",
      deleteFail: "Failed to delete room",
      deleted: "Room Deleted",
      deletedDesc: "The host has deleted this room.",
      missing: "Room not found",
      missingDesc: "This room doesn't exist or the invite link is wrong. Ask the host for a fresh link.",
      home: "Back to Home",
      invalidId: "Room ID must be 3-64 characters (letters, numbers, - or _)",
      createExists: "Room already exists",
      createFail: "Failed to create room",
    },
    settings: {
      title: "Settings",
      general: "General",
      users: "Users",
      rooms: "Rooms",
      allowRegister: "Open registration",
      allowRegisterDesc: "Allow visitors to create new accounts.",
      allowUpload: "Allow media uploads",
      allowUploadDesc: "When off, only admins can upload audio files.",
      saved: "Saved",
      fail: "Operation failed",
      loadFail: "Failed to load data",
      colId: "ID",
      colUser: "Username",
      colEmail: "Email",
      colRole: "Role",
      colJoined: "Joined",
      colActions: "Actions",
      admin: "Admin",
      user: "User",
      you: "You",
      delete: "Delete",
      confirm: "Confirm?",
      empty: "Nothing here yet",
      host: "Host",
      songs: (count) => `${count} songs`,
      playing: "Playing",
      enter: "Enter",
      noEmail: "Not set",
    },
    bg: {
      loading: "Loading layers...",
    },
    pwa: {
      updateTitle: "New version ready",
      updateDesc: "Update Aura Music now to get the latest fixes without waiting for the browser cache.",
      updateAction: "Update now",
      later: "Later",
      offlineTitle: "Ready offline",
      offlineDesc: "Aura Music is cached and can keep opening without a connection.",
      close: "Close",
    },
  },
  zh: {
    app: {
      name: "Aura Music",
      welcome: "欢迎来到 Aura",
      selectSong: "选择一首歌曲",
      importFail: "无法从链接加载歌曲",
      importOk: (count) => `已成功导入 ${count} 首歌曲`,
    },
    about: {
      descStart: "一款采用",
      descEmphasis: "Vibe Coding",
      descEnd: "打造的实验性纯网页音乐播放器。",
      viewGitHub: "在 GitHub 上查看",
      createdBy: "由 dingyi222666 创建",
      done: "完成",
    },
    top: {
      search: "搜索 (Cmd+K)",
      importLocal: "导入本地文件",
      about: "关于 Aura Music",
      enterFullscreen: "进入全屏",
      exitFullscreen: "退出全屏",
      room: "同步房间",
    },
    controls: {
      albumArt: "专辑封面",
      noMusic: "未加载音乐",
      settings: "设置/更多",
      playback: "播放模式",
      previous: "上一首",
      next: "下一首",
      queue: "队列",
      speed: "速度",
      nightcore: "夜核",
      original: "原调",
      nightcoreShort: "夜核",
      originalShort: "原调",
    },
    import: {
      title: "导入音乐",
      hintStart: "粘贴",
      hintBrand: "网易云音乐",
      hintEnd: "歌曲或歌单链接以加入队列。",
      placeholder: "https://music.163.com/...",
      cancel: "取消",
      action: "导入",
      loading: "导入中...",
    },
    keys: {
      title: "键盘快捷键",
      subtitle: "快速控制播放",
      playPause: "播放 / 暂停",
      loop: "循环模式",
      seek: "快进/快退 5 秒",
      prevNext: "上一首 / 下一首",
      volume: "音量控制",
      volumeDialog: "音量面板",
      speedDialog: "速度面板",
      search: "搜索",
      playlist: "切换播放列表",
      toggle: "切换快捷键面板",
      press: "按",
      close: "关闭",
    },
    lyrics: {
      syncing: "歌词同步中...",
      empty: "播放音乐以查看歌词",
    },
    list: {
      playingNext: "接下来播放",
      songs: (count) => `${count} 首歌曲`,
      selectAll: "全选",
      deleteSelected: "删除所选",
      done: "完成",
      addFromUrl: "从链接添加",
      edit: "编辑列表",
      empty: "队列为空",
      drag: "拖动以重新排序",
      reorder: (title) => `重新排序 ${title}`,
    },
    search: {
      online: "搜索在线歌曲...",
      queue: "筛选队列...",
      emptyQueue: "队列中暂无歌曲",
      press: "按",
      toSearch: "搜索",
      noMatches: "未找到匹配结果",
      loading: "搜索中...",
      searchCloud: "搜索云音乐",
      cloud: "云",
      more: "滚动加载更多",
      playNow: "立即播放",
      addToQueue: "加入队列",
      queueLabel: "当前队列",
      cloudLabel: "云音乐",
    },
    playlist: {
      invalidUrl:
        "无效的网易云链接。请使用 https://music.163.com/#/song?id=... 或歌单链接",
      unknownArtist: "未知歌手",
    },
    room: {
      title: "同步房间",
      subtitle: "你即将加入一个多人同步收听房间，进入后播放进度会与房间内所有人保持一致。",
      id: "房间 ID",
      share: "复制邀请链接",
      copied: "邀请链接已复制",
      copyFail: "复制链接失败",
      creator: "房主",
      viewers: (count) => `${count} 人在线`,
      playing: "正在播放",
      paused: "已暂停",
      idle: "还没有人在播放",
      queue: (count) => `${count} 首歌曲在队列中`,
      connecting: "连接中...",
      connected: "已同步",
      disconnected: "重连中...",
      enter: "进入房间",
      solo: "暂不加入，本地收听",
      leave: "退出房间",
      delete: "删除房间",
      deleteConfirm: "再次点击确认删除",
      deleteFail: "删除房间失败",
      deleted: "房间已删除",
      deletedDesc: "房间已被房主删除。",
      missing: "房间不存在",
      missingDesc: "该房间不存在或邀请链接有误，请向房主确认后再试。",
      home: "返回首页",
      invalidId: "房间 ID 需为 3-64 位，仅限字母、数字、- 或 _",
      createExists: "房间已存在",
      createFail: "创建房间失败",
    },
    settings: {
      title: "设置",
      general: "通用设置",
      users: "用户管理",
      rooms: "房间管理",
      allowRegister: "开放注册",
      allowRegisterDesc: "允许访客注册新账号。",
      allowUpload: "允许上传媒体",
      allowUploadDesc: "关闭后仅管理员可上传音频文件。",
      saved: "已保存",
      fail: "操作失败",
      loadFail: "加载失败",
      colId: "ID",
      colUser: "用户名",
      colEmail: "邮箱",
      colRole: "角色",
      colJoined: "注册时间",
      colActions: "操作",
      admin: "管理员",
      user: "用户",
      you: "你",
      delete: "删除",
      confirm: "确认？",
      empty: "暂无内容",
      host: "房主",
      songs: (count) => `${count} 首歌曲`,
      playing: "播放中",
      enter: "进入",
      noEmail: "未设置",
    },
    bg: {
      loading: "背景层加载中...",
    },
    pwa: {
      updateTitle: "新版本已准备好",
      updateDesc: "立即更新 Aura Music，获取最新修复，不再等待浏览器缓存刷新。",
      updateAction: "立即更新",
      later: "稍后",
      offlineTitle: "可离线使用",
      offlineDesc: "Aura Music 已完成缓存，断网时也可以继续打开。",
      close: "关闭",
    },
  },
};

export const pickLang = (
  langs?: readonly string[] | null,
  lang?: string | null,
): Lang => {
  const list = [...(langs ?? []), lang ?? ""]
    .filter(Boolean)
    .map((item) => item.toLowerCase());

  for (const item of list) {
    if (item.startsWith("zh")) {
      return "zh";
    }

    if (item.startsWith("en")) {
      return "en";
    }
  }

  return "en";
};

export const detectLang = (): Lang => {
  if (typeof navigator === "undefined") {
    return "en";
  }

  return pickLang(navigator.languages, navigator.language);
};

interface Ctx {
  lang: Lang;
  setLang: React.Dispatch<React.SetStateAction<Lang>>;
  dict: Dict;
}

const I18nContext = createContext<Ctx | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [lang, setLang] = useState<Lang>(() => detectLang());

  useEffect(() => {
    const sync = () => setLang(detectLang());
    window.addEventListener("languagechange", sync);
    return () => window.removeEventListener("languagechange", sync);
  }, []);

  const dict = useMemo(() => dicts[lang], [lang]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = dict.app.name;
  }, [dict.app.name, lang]);

  const value = useMemo(() => ({ lang, setLang, dict }), [dict, lang]);

  return (
    <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  );
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);

  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return ctx;
};
