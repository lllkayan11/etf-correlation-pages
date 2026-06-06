const getPreferredBase = () => {
  if (typeof window === "undefined") return "http://127.0.0.1:8765";
  const { hostname, port } = window.location;
  if ((hostname === "127.0.0.1" || hostname === "localhost") && port === "8765") {
    return "";
  }
  return "http://127.0.0.1:8765";
};

const requestJson = async (path) => {
  const res = await fetch(`${getPreferredBase()}${path}`, {
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Request failed: ${res.status}`);
  }
  return payload;
};

export const probeYahooBridge = () => requestJson("/api/health");

export const searchYahooSymbols = (query, limit = 8) =>
  requestJson(`/api/search?query=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`);

export const fetchYahooHistory = (symbol, period = "10y") =>
  requestJson(`/api/history?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}`);
