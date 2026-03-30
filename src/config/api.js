const RAW_API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').trim();

export const API_PATHS = {
  health: '/api/health',
  ollamaChat: '/api/proxy/ollama/chat',
  azureChat: '/api/proxy/azure/chat',
  ragSearch: '/api/proxy/rag/search',
};

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function getApiBaseUrl() {
  if (!RAW_API_BASE_URL) return '';
  return trimTrailingSlashes(RAW_API_BASE_URL);
}

export function withApiBase(path) {
  const rawPath = String(path || '').trim();
  if (!rawPath) return getApiBaseUrl();

  if (/^https?:\/\//i.test(rawPath) || rawPath.startsWith('//')) {
    return rawPath;
  }

  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const base = getApiBaseUrl();
  if (!base) return normalizedPath;
  return `${base}${normalizedPath}`;
}

export function getDefaultOllamaProxyUrl() {
  return withApiBase(API_PATHS.ollamaChat);
}
