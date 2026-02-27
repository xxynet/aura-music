export const getApiBase = (): string => {
  // Optional override for deployments where frontend and backend are on different origins.
  // In dev, Vite proxy makes "" work.
  return (import.meta as any).env?.VITE_API_BASE || "";
};

export const getWsBase = (): string => {
  return (import.meta as any).env?.VITE_WS_BASE || "";
};

export const resolveUrl = (pathOrUrl: string): string => {
  if (/^https?:\/\//i.test(pathOrUrl) || /^blob:/i.test(pathOrUrl) || /^data:/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const apiBase = getApiBase();
  if (!apiBase) return pathOrUrl;
  return `${apiBase}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
};

