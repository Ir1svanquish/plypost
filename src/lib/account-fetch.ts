/** Bind requests from an open workspace to its displayed account, even if another tab changes the cookie. */
export function accountFetch(original: typeof fetch, email: string, origin: string): typeof fetch {
  return (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("x-plypost-account", email);
    return original(input, { ...init, headers });
  };
}
