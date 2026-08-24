const EMBEDDED_PARAMS = ["shop", "host", "embedded"] as const;

export function embeddedAppPath(request: Request, pathname: string) {
  const current = new URL(request.url);
  const destination = new URL(pathname, current.origin);

  for (const name of EMBEDDED_PARAMS) {
    const value = current.searchParams.get(name);
    if (value) destination.searchParams.set(name, value);
  }

  return `${destination.pathname}${destination.search}`;
}
