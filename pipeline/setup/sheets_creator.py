"""Google Sheets 자동 생성 — 6개 탭 + 헤더."""

import logging
from typing import Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

TABS_AND_HEADERS = {
    "_processed_videos": [
        "video_id", "committee", "date", "title", "video_url",
        "source", "subtitle_source", "processed_at", "status", "error_message",
    ],
    "_manual_queue": [
        "url", "category", "committee", "date", "status",
    ],
    "_keywords": [
        "keyword", "type", "note",
    ],
    "agendas": [
        "agenda_id", "video_id", "committee", "date", "category",
        "title", "summary", "is_entity_mentioned", "entity_mention_detail", "sort_order",
        "event_type",
    ],
    "statements": [
        "statement_id", "agenda_id", "speaker_name", "speaker_party",
        "speaker_role", "content", "sort_order",
    ],
    "news_articles": [
        "article_id", "agenda_id", "title", "url", "publisher", "published_at",
    ],
}


def create_spreadsheet(
    service_account_file: str,
    title: str = "ParlaWatch Data",
    share_email: Optional[str] = None,
) -> str:
    """새 스프레드시트를 생성하고 6개 탭 + 헤더를 추가한다.

    Returns:
        생성된 spreadsheet_id
    """
    creds = service_account.Credentials.from_service_account_file(
        service_account_file, scopes=SCOPES,
    )
    sheets_service = build("sheets", "v4", credentials=creds)
    drive_service = build("drive", "v3", credentials=creds)

    body = {
        "properties": {"title": title},
        "sheets": [
            {"properties": {"title": tab_name}}
            for tab_name in TABS_AND_HEADERS
        ],
    }
    spreadsheet = sheets_service.spreadsheets().create(body=body).execute()
    spreadsheet_id = spreadsheet["spreadsheetId"]
    logger.info("스프레드시트 생성: %s (ID: %s)", title, spreadsheet_id)

    data = []
    for tab_name, headers in TABS_AND_HEADERS.items():
        data.append({
            "range": f"{tab_name}!A1",
            "values": [headers],
        })

    sheets_service.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"valueInputOption": "RAW", "data": data},
    ).execute()
    logger.info("헤더 행 추가 완료: %d개 탭", len(TABS_AND_HEADERS))

    if share_email:
        drive_service.permissions().create(
            fileId=spreadsheet_id,
            body={
                "type": "user",
                "role": "writer",
                "emailAddress": share_email,
            },
            sendNotificationEmail=False,
        ).execute()
        logger.info("편집 권한 공유: %s", share_email)

    return spreadsheet_id
