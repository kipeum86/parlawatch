"""ParlaWatch 파이프라인 설정 및 상수."""

import logging
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT_DIR / "config.yaml"


def load_config() -> dict:
    """config.yaml을 읽어 dict로 반환한다."""
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        logger.error("config.yaml을 찾을 수 없습니다: %s", CONFIG_PATH)
        return {}
    except yaml.YAMLError as e:
        logger.error("config.yaml 파싱 오류: %s", e)
        return {}


def validate_config_for_pipeline(config: dict) -> bool:
    """파이프라인 실행에 필요한 필수 필드가 있는지 검증한다."""
    domain = config.get("domain", {})
    if not domain.get("name") or not domain.get("description"):
        logger.error(
            "셋업이 필요합니다. config.yaml에 domain.name과 domain.description을 설정하세요."
        )
        return False
    return True


TAB_PROCESSED_VIDEOS = "_processed_videos"
TAB_MANUAL_QUEUE = "_manual_queue"
TAB_KEYWORDS = "_keywords"
TAB_AGENDAS = "agendas"
TAB_STATEMENTS = "statements"
TAB_NEWS_ARTICLES = "news_articles"

ENV_GOOGLE_CREDENTIALS = "GOOGLE_APPLICATION_CREDENTIALS"
ENV_ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY"
ENV_NAVER_CLIENT_ID = "NAVER_CLIENT_ID"
ENV_NAVER_CLIENT_SECRET = "NAVER_CLIENT_SECRET"
ENV_SPREADSHEET_ID = "SPREADSHEET_ID"
