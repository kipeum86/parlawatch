"""config.py 테스트."""
import pytest
import yaml
from pipeline.config import load_config, validate_config_for_pipeline


def _write_config(path, data):
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True)


class TestLoadConfig:
    def test_valid_config(self, tmp_path, monkeypatch):
        cfg = {"domain": {"name": "의료", "description": "의료 분야"}, "entity_names": ["삼성"]}
        config_path = tmp_path / "config.yaml"
        _write_config(config_path, cfg)
        monkeypatch.setattr("pipeline.config.CONFIG_PATH", config_path)
        result = load_config()
        assert result["domain"]["name"] == "의료"

    def test_empty_config(self, tmp_path, monkeypatch):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("", encoding="utf-8")
        monkeypatch.setattr("pipeline.config.CONFIG_PATH", config_path)
        result = load_config()
        assert result == {}

    def test_missing_config(self, tmp_path, monkeypatch):
        config_path = tmp_path / "nonexistent.yaml"
        monkeypatch.setattr("pipeline.config.CONFIG_PATH", config_path)
        result = load_config()
        assert result == {}

    def test_malformed_yaml(self, tmp_path, monkeypatch):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("invalid: yaml: [broken", encoding="utf-8")
        monkeypatch.setattr("pipeline.config.CONFIG_PATH", config_path)
        result = load_config()
        assert result == {}


class TestValidateConfig:
    def test_valid(self):
        cfg = {"domain": {"name": "금융", "description": "금융 분야"}}
        assert validate_config_for_pipeline(cfg) is True

    def test_missing_name(self):
        cfg = {"domain": {"name": "", "description": "금융 분야"}}
        assert validate_config_for_pipeline(cfg) is False

    def test_missing_domain(self):
        cfg = {}
        assert validate_config_for_pipeline(cfg) is False
