"""GamWatch 파이프라인 상수 및 기본 키워드 정의."""

import os
from pathlib import Path

import yaml

# ──────────────────────────────────────────────
# 경로
# ──────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT_DIR / "config.yaml"


def load_config() -> dict:
    """config.yaml을 읽어 dict로 반환한다."""
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


# ──────────────────────────────────────────────
# Google Sheets 탭 이름
# ──────────────────────────────────────────────
TAB_PROCESSED_VIDEOS = "_processed_videos"
TAB_MANUAL_QUEUE = "_manual_queue"
TAB_KEYWORDS = "_keywords"
TAB_AGENDAS = "agendas"
TAB_STATEMENTS = "statements"
TAB_NEWS_ARTICLES = "news_articles"

# ──────────────────────────────────────────────
# 기본 게임 산업 키워드 (하드코딩)
# 파이프라인 실행 시 _keywords 탭의 사용자 키워드와 병합
# ──────────────────────────────────────────────
DEFAULT_INCLUDE_KEYWORDS = [
    # 게임 일반
    "게임", "게임산업", "게임업계", "온라인게임", "모바일게임", "PC게임",
    "콘솔게임", "비디오게임", "게임사",
    # 규제/정책
    "확률형 아이템", "가챠", "셧다운제", "게임 이용등급", "게임물등급위원회",
    "게임물관리위원회", "게임 과몰입", "게임 중독", "게임 사행성",
    "게임 규제", "게임 셧다운", "게임법", "게임 자율규제",
    # e스포츠
    "e스포츠", "이스포츠", "esports", "프로게이머",
    # 콘텐츠/산업 분류
    "게임 콘텐츠", "게임 수출", "게임 시장",
    # 기술
    "게임 개발", "게임 엔진",
]

DEFAULT_EXCLUDE_KEYWORDS = [
    # 오탐 방지: "게임"이 포함되지만 게임 산업과 무관한 표현
    "게임 체인저", "게임체인저",
    "머니 게임", "머니게임",
    "치킨 게임", "치킨게임",
    "제로섬 게임", "제로섬게임",
    "블레임 게임", "블레임게임",
    "네임 게임", "네임게임",
]

# ──────────────────────────────────────────────
# 환경 변수 키
# ──────────────────────────────────────────────
ENV_GOOGLE_CREDENTIALS = "GOOGLE_APPLICATION_CREDENTIALS"
ENV_ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY"
ENV_NAVER_CLIENT_ID = "NAVER_CLIENT_ID"
ENV_NAVER_CLIENT_SECRET = "NAVER_CLIENT_SECRET"
ENV_SPREADSHEET_ID = "SPREADSHEET_ID"
