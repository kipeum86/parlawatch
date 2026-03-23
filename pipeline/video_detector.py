"""유튜브 영상 감지기: YouTube Data API v3 + 수동 큐."""

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from googleapiclient.discovery import build
from google.oauth2 import service_account

from .config import load_config
from .utils import KST

logger = logging.getLogger(__name__)

YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"]


@dataclass
class VideoTask:
    """처리 대상 영상."""
    video_id: str
    url: str
    title: str
    committee: str
    committee_code: str
    date: str  # YYYY-MM-DD
    source: str  # "auto" / "manual"
    event_type: str = "국정감사"  # 국정감사 / 업무보고 / 간담회 등 자유 입력


def detect_videos(
    service_account_file: str,
    sheets_client,
    days_back: int = 7,
) -> list[VideoTask]:
    """신규 처리 대상 영상 목록을 반환한다.

    1. YouTube API로 대상 상임위 영상 검색
    2. _manual_queue에서 pending 항목 수집
    3. _processed_videos와 대조하여 중복 제거
    """
    config = load_config()
    processed_ids = sheets_client.get_processed_video_ids()
    tasks = []

    # 1. YouTube API 자동 검색
    auto_tasks = _search_youtube(service_account_file, config, days_back)
    for task in auto_tasks:
        if task.video_id not in processed_ids:
            tasks.append(task)

    # 2. 수동 큐
    manual_tasks = _get_manual_tasks(sheets_client)
    for task in manual_tasks:
        if task.video_id not in processed_ids:
            tasks.append(task)

    logger.info("감지된 신규 영상: %d개 (자동: %d, 수동: %d)",
                len(tasks),
                sum(1 for t in tasks if t.source == "auto"),
                sum(1 for t in tasks if t.source == "manual"))

    return tasks


def _search_youtube(
    service_account_file: str,
    config: dict,
    days_back: int,
) -> list[VideoTask]:
    """YouTube Data API로 대상 채널에서 국감 영상을 검색한다."""
    channels = config.get("youtube", {}).get("channels", [])
    committees = config.get("committees", [])

    if not channels or not channels[0].get("id"):
        logger.warning("YouTube 채널 ID가 설정되지 않음 — 자동 검색 스킵")
        return []

    creds = service_account.Credentials.from_service_account_file(
        service_account_file, scopes=YOUTUBE_SCOPES,
    )
    youtube = build("youtube", "v3", credentials=creds)

    published_after = (datetime.now(KST) - timedelta(days=days_back)).isoformat()
    tasks = []

    for channel in channels:
        channel_id = channel["id"]
        for committee in committees:
            for search_term in committee.get("search_terms", []):
                query = f"{search_term} 국정감사"
                try:
                    response = youtube.search().list(
                        part="snippet",
                        channelId=channel_id,
                        q=query,
                        publishedAfter=published_after,
                        type="video",
                        maxResults=10,
                    ).execute()
                except Exception as e:
                    logger.error("YouTube API 검색 실패 (%s): %s", query, e)
                    continue

                for item in response.get("items", []):
                    video_id = item["id"]["videoId"]
                    title = item["snippet"]["title"]
                    published = item["snippet"]["publishedAt"][:10]

                    # 이미 추가된 video_id 스킵
                    if any(t.video_id == video_id for t in tasks):
                        continue

                    tasks.append(VideoTask(
                        video_id=video_id,
                        url=f"https://www.youtube.com/watch?v={video_id}",
                        title=title,
                        committee=committee["name"],
                        committee_code=committee["code"],
                        date=published,
                        source="auto",
                    ))

    logger.info("YouTube API 검색 결과: %d개 영상", len(tasks))
    return tasks


def _get_manual_tasks(sheets_client) -> list[VideoTask]:
    """수동 큐에서 pending 항목을 VideoTask로 변환한다."""
    pending = sheets_client.get_pending_manual_queue()
    tasks = []

    for item in pending:
        url = item.get("url", "").strip()
        video_id = _extract_video_id(url)
        if not video_id:
            logger.warning("잘못된 URL: %s", url)
            continue

        tasks.append(VideoTask(
            video_id=video_id,
            url=url,
            title="",  # 나중에 영상 제목 가져올 수 있음
            committee=item.get("committee", ""),
            committee_code=_guess_committee_code(item.get("committee", "")),
            date=item.get("date", ""),
            source="manual",
        ))

    return tasks


def _extract_video_id(url: str) -> str | None:
    """유튜브 URL에서 video_id를 추출한다."""
    patterns = [
        r"(?:v=|/v/|/live/|youtu\.be/)([a-zA-Z0-9_-]{11})",
        r"^([a-zA-Z0-9_-]{11})$",  # video_id 직접 입력
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def _guess_committee_code(committee_name: str) -> str:
    """상임위 이름에서 코드를 추론한다."""
    mapping = {
        "정무": "jungmu",
        "과방": "gwabang", "과학기술": "gwabang",
        "문체": "munche", "문화체육": "munche",
        "산자": "sanja", "산업통상": "sanja",
        "법사": "beopsa", "법제사법": "beopsa",
        "복지": "bokji", "보건복지": "bokji",
    }
    for key, code in mapping.items():
        if key in committee_name:
            return code
    return "etc"
