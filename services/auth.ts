export interface AuthUser {
  username: string;
}

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const resp = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  const text = await resp.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!resp.ok) {
    const message = data?.message || `HTTP ${resp.status}`;
    throw new Error(message);
  }

  return (data ?? {}) as T;
};

export const getSession = async (): Promise<AuthUser | null> => {
  try {
    const data = await requestJson<{ ok: boolean; user?: AuthUser }>("/auth/session", { method: "GET" });
    if (data?.ok && data?.user?.username) return data.user;
    return null;
  } catch {
    return null;
  }
};

export const login = async (username: string, password: string): Promise<AuthUser> => {
  const data = await requestJson<{ ok: boolean; user?: AuthUser; message?: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!data?.ok || !data.user?.username) {
    throw new Error(data?.message || "登录失败");
  }
  return data.user;
};

export const logout = async (): Promise<void> => {
  await requestJson<{ ok: boolean }>("/auth/logout", { method: "POST" });
};

