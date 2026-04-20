const browserApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const serverApiUrl = process.env.PLATFORM_API_URL ?? browserApiUrl;

export function getApiUrl() {
  return typeof window === "undefined" ? serverApiUrl : browserApiUrl;
}

async function getServerCookieHeader(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const session = cookieStore.get("llm_wiki_session");
    return session?.value ? `llm_wiki_session=${session.value}` : null;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };

  if (typeof window === "undefined") {
    const cookie = await getServerCookieHeader();
    if (cookie) headers["Cookie"] = cookie;
  }

  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 401 && typeof window === "undefined") {
      const { redirect } = await import("next/navigation");
      redirect("/login");
    }
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? payload.error ?? "Request failed");
  }

  return response.json();
}

export function clientApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(path, init);
}

export async function clientFormFetch<T>(path: string, body: FormData, init?: RequestInit): Promise<T> {
  const headers = { ...(init?.headers as Record<string, string> ?? {}) };
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    method: init?.method ?? "POST",
    headers,
    body,
    cache: "no-store",
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail ?? payload.error ?? "Request failed");
  }

  return response.json();
}
