"""Naver Search API를 사용한 뉴스 기사 검색."""

import logging
import re
import time

import requests

from .utils import retry

logger = logging.getLogger(__name__)

NAVER_NEWS_URL = "https://openapi.naver.com/v1/search/news.json"


class NewsSearcher:
    """Naver 뉴스 검색 클라이언트."""

    def __init__(self, client_id: str, client_secret: str, results_per_agenda: int = 5):
        self.client_id = client_id
        self.client_secret = client_secret
        self.results_per_agenda = results_per_agenda

    def search_for_agenda(self, agenda: dict) -> list[dict]:
        """안건에 관련된 뉴스 기사를 검색한다.

        Args:
            agenda: 안건 dict (title, statements 포함)

        Returns:
            기사 리스트: [{"title", "url", "publisher", "published_at"}]
        """
        query = self._build_query(agenda)
        if not query:
            return []

        articles = self._search(query)

        # 요청 간 100ms 대기 (rate limit 방지)
        time.sleep(0.1)

        return articles

    def _build_query(self, agenda: dict) -> str:
        """안건에서 검색 쿼리를 생성한다."""
        parts = []

        title = agenda.get("title", "")
        if title:
            # 핵심 키워드만 추출 (너무 긴 제목은 검색 정확도 저하)
            parts.append(title[:30])

        # 질의 의원명 추가
        statements = agenda.get("statements", [])
        questioners = [
            s["speaker_name"]
            for s in statements
            if s.get("speaker_role") == "questioner" and s.get("speaker_name")
        ]
        if questioners:
            parts.append(questioners[0])

        # "국정감사" 키워드 추가
        parts.append("국정감사")

        return " ".join(parts)

    @retry(max_attempts=3, delay=2.0)
    def _search(self, query: str) -> list[dict]:
        """Naver News API 호출."""
        headers = {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret,
        }
        params = {
            "query": query,
            "display": self.results_per_agenda,
            "sort": "date",
        }

        response = requests.get(NAVER_NEWS_URL, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        articles = []
        for item in data.get("items", []):
            articles.append({
                "title": _strip_html(item.get("title", "")),
                "url": item.get("originallink") or item.get("link", ""),
                "publisher": _extract_publisher(item.get("originallink", "")),
                "published_at": _parse_date(item.get("pubDate", "")),
            })

        logger.info("뉴스 검색 '%s': %d건", query[:30], len(articles))
        return articles


def _strip_html(text: str) -> str:
    """HTML 태그를 제거한다."""
    return re.sub(r"<[^>]+>", "", text).replace("&quot;", '"').replace("&amp;", "&")


def _extract_publisher(url: str) -> str:
    """URL에서 언론사 도메인을 추출한다."""
    match = re.search(r"https?://(?:www\.)?([^/]+)", url)
    if match:
        domain = match.group(1)
        # 주요 언론사 매핑
        publisher_map = {
            "chosun.com": "조선일보",
            "donga.com": "동아일보",
            "joongang.co.kr": "중앙일보",
            "hani.co.kr": "한겨레",
            "khan.co.kr": "경향신문",
            "mk.co.kr": "매일경제",
            "hankyung.com": "한국경제",
            "sedaily.com": "서울경제",
            "yna.co.kr": "연합뉴스",
            "ytn.co.kr": "YTN",
            "inven.co.kr": "인벤",
            "gamemeca.com": "게임메카",
            "thisisgame.com": "디스이즈게임",
            "gamevu.co.kr": "게임뷰",
        }
        for key, name in publisher_map.items():
            if key in domain:
                return name
        return domain
    return ""


def _parse_date(pub_date: str) -> str:
    """Naver API의 pubDate를 YYYY-MM-DD로 변환한다."""
    # "Mon, 21 Oct 2025 09:30:00 +0900" 형식
    try:
        from datetime import datetime
        dt = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %z")
        return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return ""
