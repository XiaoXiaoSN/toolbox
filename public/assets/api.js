const storageKey = 'toolbox-api-token';
let token = '';
try { token = sessionStorage.getItem(storageKey) || ''; } catch { /* Storage may be disabled. */ }

export function getToken() { return token; }
export function setToken(value) {
  token = value.trim();
  try { sessionStorage.setItem(storageKey, token); } catch { /* Memory-only fallback. */ }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'omit',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return {
    data: response.status === 204 ? null : await response.json(),
    next: response.headers.get('X-Next-Cursor'),
  };
}
