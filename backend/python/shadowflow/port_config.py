"""port_config — Python 侧端口 loader（唯一）。

单一配置源 ``config/ports.json``（docs/新架构蓝图-v2.md §1.2）：

    进程自身 env（SF_PY_PORT / SF_BASE_URL / CORS_ORIGINS …）
      > config/ports.json > 内置兜底

消费方（禁止再写字面量端口/默认 URL）：
- ``cli.py`` serve 默认端口
- ``server.__main__`` uvicorn 端口
- ``api/system/a2a_bridge.py`` SF_BASE_URL 默认值
- ``server.py`` CORS 默认来源（由 web 端口派生）
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_FALLBACK: dict[str, int] = {"web": 8443, "gateway": 8002, "python": 8000}


def _find_ports_json() -> Path | None:
    # 本文件位于 backend/python/shadowflow/，仓库根在上三级；
    # 兜底向上多找几层（打包/嵌套布局）。
    here = Path(__file__).resolve()
    for parent in list(here.parents)[:6]:
        candidate = parent / "config" / "ports.json"
        if candidate.is_file():
            return candidate
    return None


def _load_file_ports() -> dict[str, int]:
    try:
        fp = _find_ports_json()
        if fp is None:
            return dict(_FALLBACK)
        parsed: dict[str, Any] = json.loads(fp.read_text(encoding="utf-8"))
        return {
            key: int(parsed.get(key) or _FALLBACK[key]) for key in ("web", "gateway", "python")
        }
    except Exception:
        return dict(_FALLBACK)


_PORTS = _load_file_ports()


def _env_int(name: str) -> int | None:
    raw = os.environ.get(name)
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


WEB_PORT: int = _env_int("SF_WEB_PORT") or _PORTS["web"]
GATEWAY_PORT: int = _env_int("SF_GW_PORT") or _PORTS["gateway"]
PYTHON_PORT: int = _env_int("SF_PY_PORT") or _PORTS["python"]

#: A2A AgentCard 默认基准 URL（env SF_BASE_URL 可覆盖）
DEFAULT_SF_BASE_URL: str = f"http://localhost:{PYTHON_PORT}"

#: CORS 默认放行来源（env CORS_ORIGINS 可覆盖）：前端 dev/preview + 历史遗留端口
DEFAULT_CORS_ORIGINS: str = ",".join(
    [
        f"http://localhost:{WEB_PORT}",
        "http://localhost:5173",
        "http://localhost:3000",
    ]
)
