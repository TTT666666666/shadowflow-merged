"""BYOK 配置共享读模块 —— 唯一写者是 Node 网关。

背景
----
合并前两侧各有一份 BYOK 配置：

* **Node**：``.shadowflow/settings.json`` 的 ``byok`` 段（``routes/system/settings.ts``
  的 ``loadByok``），形状 ``{providers: {id: {apiKey, baseUrl, models, enabled}},
  defaultModel, temperature, routingPriority}``——浏览器 BYOK 页面的唯一写入口。
* **Python**：``.shadowflow/byok-config.json``（``api/system/settings.py``），形状
  ``{keys, baseUrls, model}``——历史遗留，只有它自己的三个 REST 端点读，生产链路无人用。

收敛方向（本模块）：Python 侧**只读** Node 写的那份 settings.json；旧
``byok-config.json`` 保留为只读兼容（老部署没在页面上重存过配置时，密钥还在旧文件里），
两者按 provider 合并（settings.json 优先）。**Python 永不写任何配置文件**——写入口只有
Node，避免出现第二个写者把 Node 的写入覆盖掉。

旧数据怎么"迁移"：用户下次在 BYOK 页面保存任一 provider，Node 就会把完整配置写进
settings.json；此后本模块自然读到新源，旧文件退化为无用文件（可手工删除）。这是零写入
的"惰性迁移"，不需要一次性的写文件动作。

密钥解析优先级（与 Node ``transport/byokKey.ts`` 同口径）：
    1. settings.json 的 ``providers[id].apiKey``
    2. 旧 ``byok-config.json`` 的 ``keys[id]``（兼容）
    3. 环境变量（见 ``_ENV_KEYS``）
自定义 provider（``custom-*``）只走 1/2，没有对应的环境变量名。
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_ENV_KEYS: Dict[str, tuple] = {
    "anthropic": ("ANTHROPIC_API_KEY",),
    "openai": ("OPENAI_API_KEY",),
    "google": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "zhipu": ("ZHIPU_API_KEY", "ZHIPUAI_API_KEY", "GLM_API_KEY"),
    "mimo": ("MIMO_API_KEY",),
    "azure": ("AZURE_OPENAI_API_KEY",),
    "groq": ("GROQ_API_KEY",),
    "mistral": ("MISTRAL_API_KEY",),
    "xai": ("XAI_API_KEY",),
    "ollama": (),
}

_DEFAULT_MODEL = "claude-sonnet-4-6"

_legacy_warned = False


def data_dir(root: Optional[Path] = None) -> Path:
    """数据目录：``SHADOWFLOW_DATA_DIR`` 优先，默认 ``.shadowflow``（cwd 相对）。"""
    if root is not None:
        return Path(root)
    return Path(os.environ.get("SHADOWFLOW_DATA_DIR", ".shadowflow"))


@dataclass(frozen=True)
class ByokConfig:
    """归一化后的 BYOK 视图（两侧形状统一到这里）。"""

    providers: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    default_model: str = _DEFAULT_MODEL
    temperature: Optional[float] = None
    routing_priority: List[str] = field(default_factory=list)
    source: str = "empty"  # 'settings' | 'legacy' | 'empty'

    def api_key(self, provider: str) -> Optional[str]:
        return _resolve(self.providers, provider, "apiKey") or _env_key(provider)

    def base_url(self, provider: str) -> Optional[str]:
        return _resolve(self.providers, provider, "baseUrl")

    def provider_ids(self) -> List[str]:
        return sorted(self.providers.keys())


def _resolve(providers: Dict[str, Dict[str, Any]], provider: str, key: str) -> Optional[str]:
    entry = providers.get(provider) or {}
    value = entry.get(key)
    return value if isinstance(value, str) and value else None


def _env_key(provider: str) -> Optional[str]:
    for name in _ENV_KEYS.get(provider, ()):
        value = os.environ.get(name)
        if value:
            return value
    return None


def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as exc:  # 权限/编码问题：当作没有，但要留痕
        logger.warning("[byok] 读取 %s 失败：%s", path, exc)
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("[byok] %s 不是合法 JSON，已忽略：%s", path, exc)
        return None
    return data if isinstance(data, dict) else None


def _from_settings(settings: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """从 settings.json 的 byok 段提取 provider 表。"""
    if not settings:
        return {}
    section = settings.get("byok")
    if not isinstance(section, dict):
        return {}
    providers = section.get("providers")
    if not isinstance(providers, dict):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for pid, entry in providers.items():
        if isinstance(entry, dict):
            out[str(pid)] = {
                "apiKey": entry.get("apiKey"),
                "baseUrl": entry.get("baseUrl"),
                "models": entry.get("models"),
                "enabled": entry.get("enabled"),
            }
    return out


def _from_legacy(legacy: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """从旧 byok-config.json（``{keys, baseUrls, model}``）提取 provider 表。"""
    if not legacy:
        return {}
    keys = legacy.get("keys") if isinstance(legacy.get("keys"), dict) else {}
    base_urls = legacy.get("baseUrls") if isinstance(legacy.get("baseUrls"), dict) else {}
    out: Dict[str, Dict[str, Any]] = {}
    for pid in set(keys) | set(base_urls):
        out[str(pid)] = {
            "apiKey": keys.get(pid),
            "baseUrl": base_urls.get(pid),
            "models": None,
            "enabled": None,
        }
    return out


def read_config(root: Optional[Path] = None) -> ByokConfig:
    """读归一化后的 BYOK 配置。settings.json 优先，旧文件按 provider 补齐。"""
    global _legacy_warned
    base = data_dir(root)

    settings = _load_json(base / "settings.json")
    new_providers = _from_settings(settings)
    legacy = _load_json(base / "byok-config.json")
    legacy_providers = _from_legacy(legacy)

    merged: Dict[str, Dict[str, Any]] = dict(legacy_providers)
    merged.update(new_providers)  # settings.json 覆盖旧文件（按 provider 粒度）

    source = "settings" if new_providers else ("legacy" if legacy_providers else "empty")
    if source == "legacy" and not _legacy_warned:
        _legacy_warned = True
        logger.warning(
            "[byok] 只找到旧的 .shadowflow/byok-config.json（无 settings.json byok 段）。"
            "该文件已废弃、只读兼容；请在前端 BYOK 页面保存一次以迁移到 settings.json。"
        )

    section = (settings or {}).get("byok") if isinstance(settings, dict) else None
    section = section if isinstance(section, dict) else {}
    model = section.get("defaultModel") or (legacy or {}).get("model") or _DEFAULT_MODEL
    temperature = section.get("temperature")
    routing = section.get("routingPriority")

    return ByokConfig(
        providers=merged,
        default_model=str(model),
        temperature=temperature if isinstance(temperature, (int, float)) else None,
        routing_priority=routing if isinstance(routing, list) else [],
        source=source,
    )


def resolve_key(provider: str, root: Optional[Path] = None) -> Optional[str]:
    """密钥：settings.json → 旧文件 → 环境变量。"""
    return read_config(root).api_key(provider)


def resolve_base_url(provider: str, root: Optional[Path] = None) -> Optional[str]:
    return read_config(root).base_url(provider)


def resolve_model(fallback: Optional[str] = None, root: Optional[Path] = None) -> str:
    return read_config(root).default_model or fallback or _DEFAULT_MODEL


def resolve_any_key(root: Optional[Path] = None) -> Optional[tuple]:
    """按路由优先级返回第一个可用 ``(provider, api_key, model)``；无则 None。

    ``routing_priority``（Node 写）优先，其次常见 provider 顺序。
    """
    cfg = read_config(root)
    order = list(cfg.routing_priority) or [
        "anthropic", "openai", "google", "deepseek", "zhipu", "mimo", "azure",
    ]
    for pid in order:
        key = cfg.api_key(pid)
        if key:
            return pid, key, cfg.default_model
    return None
