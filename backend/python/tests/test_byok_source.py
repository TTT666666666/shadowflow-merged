"""BYOK 共享读模块（shadowflow.byok_source）+ settings API 收敛行为测试。

覆盖：
  1. settings.json 是唯一真源（Node 形状：providers[id].apiKey/baseUrl + defaultModel）
  2. 旧 byok-config.json 只读兼容（settings 缺失时按 provider 补齐）
  3. 两者并存时 settings.json 按 provider 覆盖旧文件
  4. 环境变量兜底 + routingPriority 决定「第一个可用」
  5. Python 侧写入口已停用：PUT/DELETE /api/settings/byok 返回 409
"""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import HTTPException

from shadowflow import byok_source


def _write(path, payload) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("SHADOWFLOW_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    byok_source._legacy_warned = False
    return tmp_path


def test_settings_json_is_authoritative(data_dir):
    _write(
        data_dir / "settings.json",
        {
            "byok": {
                "providers": {
                    "anthropic": {"apiKey": "sk-ant-1", "baseUrl": "https://a.example"},
                    "custom-x": {"apiKey": "ck-1", "baseUrl": "https://x.example"},
                },
                "defaultModel": "claude-opus-4-7",
                "temperature": 0.3,
                "routingPriority": ["custom-x", "anthropic"],
            }
        },
    )

    cfg = byok_source.read_config()

    assert cfg.source == "settings"
    assert cfg.api_key("anthropic") == "sk-ant-1"
    assert cfg.base_url("anthropic") == "https://a.example"
    assert cfg.api_key("custom-x") == "ck-1"
    assert cfg.default_model == "claude-opus-4-7"
    assert cfg.temperature == 0.3
    assert cfg.routing_priority == ["custom-x", "anthropic"]


def test_legacy_file_is_read_only_fallback(data_dir):
    _write(
        data_dir / "byok-config.json",
        {"keys": {"deepseek": "sk-ds-1"}, "baseUrls": {"deepseek": "https://ds.example"}, "model": "deepseek-chat"},
    )

    cfg = byok_source.read_config()

    assert cfg.source == "legacy"
    assert cfg.api_key("deepseek") == "sk-ds-1"
    assert cfg.base_url("deepseek") == "https://ds.example"
    assert cfg.default_model == "deepseek-chat"
    # 只读：旧文件不会被改写
    assert json.loads((data_dir / "byok-config.json").read_text())["keys"]["deepseek"] == "sk-ds-1"


def test_settings_overrides_legacy_per_provider(data_dir):
    _write(
        data_dir / "byok-config.json",
        {"keys": {"anthropic": "old-key", "openai": "sk-openai-1"}, "model": "gpt-4o"},
    )
    _write(
        data_dir / "settings.json",
        {"byok": {"providers": {"anthropic": {"apiKey": "new-key"}}, "defaultModel": "claude-sonnet-4-6"}},
    )

    cfg = byok_source.read_config()

    assert cfg.source == "settings"
    assert cfg.api_key("anthropic") == "new-key"  # settings 覆盖
    assert cfg.api_key("openai") == "sk-openai-1"  # 旧文件补齐
    assert cfg.default_model == "claude-sonnet-4-6"


def test_env_fallback_and_routing_priority(data_dir, monkeypatch):
    _write(
        data_dir / "settings.json",
        {"byok": {"providers": {"anthropic": {"apiKey": "sk-ant-1"}}, "routingPriority": ["openai", "anthropic"]}},
    )
    monkeypatch.setenv("OPENAI_API_KEY", "env-openai")

    # 配置里 anthropic 有 key，但 routingPriority 把 openai 排前面 ⇒ 选 openai（env 兜底）
    found = byok_source.resolve_any_key()
    assert found is not None
    provider, key, _model = found
    assert (provider, key) == ("openai", "env-openai")


def test_empty_state(data_dir):
    cfg = byok_source.read_config()
    assert cfg.source == "empty"
    assert cfg.default_model == "claude-sonnet-4-6"
    assert cfg.provider_ids() == []
    assert byok_source.resolve_any_key() is None


def test_corrupt_settings_is_ignored(data_dir):
    (data_dir / "settings.json").write_text("{not json", encoding="utf-8")
    _write(data_dir / "byok-config.json", {"keys": {"zhipu": "z-1"}})

    cfg = byok_source.read_config()
    assert cfg.source == "legacy"
    assert cfg.api_key("zhipu") == "z-1"


def test_python_write_endpoints_are_disabled(data_dir):
    """写入口收敛到 Node：Python 侧 PUT/DELETE 必须 409，且不落任何文件。"""
    from shadowflow.api.system import settings as settings_api

    with pytest.raises(HTTPException) as put_exc:
        asyncio.run(settings_api.put_byok(settings_api.ByokWriteRequest(provider="anthropic", apiKey="k")))
    assert put_exc.value.status_code == 409

    with pytest.raises(HTTPException) as del_exc:
        asyncio.run(settings_api.delete_byok_provider("anthropic"))
    assert del_exc.value.status_code == 409

    assert not (data_dir / "byok-config.json").exists()
    assert not (data_dir / "settings.json").exists()


def test_get_endpoint_reads_settings_json(data_dir):
    _write(
        data_dir / "settings.json",
        {"byok": {"providers": {"anthropic": {"apiKey": "sk-ant-abcd1234"}}, "defaultModel": "claude-sonnet-4-6"}},
    )
    from shadowflow.api.system import settings as settings_api

    body = asyncio.run(settings_api.get_byok())
    assert body["keys"]["anthropic"] == "****1234"  # 脱敏到后四位
    assert body["model"] == "claude-sonnet-4-6"
