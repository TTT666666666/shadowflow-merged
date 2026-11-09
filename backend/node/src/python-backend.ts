/**
 * python-backend.ts — single source of truth for the Python FastAPI base URL.
 *
 * The Node API is the front gateway; any /api/* it doesn't own is proxied to
 * the Python backend by proxy-fallback.ts. A few Node routers (e.g.
 * groups-chat.ts, which intercepts chat send to run replies through the Node
 * dispatcher) also need to call Python directly for persistence. Both import
 * this constant so the target is defined once.
 *
 * 端口/URL 口径统一（2026-11-09）：默认值从 config/ports.json 派生
 * （经 config/ports.ts），不再硬编码字面量。
 */
export { PYTHON_BACKEND_URL } from './config/ports';
