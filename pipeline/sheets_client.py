"""Google Sheets 읽기/쓰기 클라이언트.

6개 탭: _processed_videos, _manual_queue, _keywords, agendas, statements, news_articles
"""

import logging
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

from .config import (
    TAB_PROCESSED_VIDEOS,
    TAB_MANUAL_QUEUE,
    TAB_KEYWORDS,
    TAB_AGENDAS,
    TAB_STATEMENTS,
    TAB_NEWS_ARTICLES,
)

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# 각 탭의 헤더 정의
HEADERS = {
    TAB_PROCESSED_VIDEOS: [
        "video_id", "committee", "date", "title", "video_url",
        "source", "subtitle_source", "processed_at", "status", "error_message",
    ],
    TAB_MANUAL_QUEUE: [
        "url", "category", "committee", "date", "status",
    ],
    TAB_KEYWORDS: [
        "keyword", "type", "note",
    ],
    TAB_AGENDAS: [
        "agenda_id", "video_id", "committee", "date", "category",
        "title", "summary", "is_company_mentioned", "company_mention_detail", "sort_order",
        "event_type",
    ],
    TAB_STATEMENTS: [
        "statement_id", "agenda_id", "speaker_name", "speaker_party",
        "speaker_role", "content", "sort_order",
    ],
    TAB_NEWS_ARTICLES: [
        "article_id", "agenda_id", "title", "url", "publisher", "published_at",
    ],
}


class SheetsClient:
    """Google Sheets API 래퍼."""

    def __init__(self, service_account_file: str, spreadsheet_id: str):
        creds = service_account.Credentials.from_service_account_file(
            service_account_file, scopes=SCOPES,
        )
        self.service = build("sheets", "v4", credentials=creds)
        self.spreadsheet_id = spreadsheet_id

    # ──────────────────────────────────────────
    # 범용 읽기/쓰기
    # ──────────────────────────────────────────

    def read_tab(self, tab_name: str) -> list[dict[str, str]]:
        """탭의 전체 데이터를 dict 리스트로 반환한다. 첫 행은 헤더."""
        result = (
            self.service.spreadsheets()
            .values()
            .get(spreadsheetId=self.spreadsheet_id, range=f"{tab_name}")
            .execute()
        )
        rows = result.get("values", [])
        if len(rows) < 2:
            return []
        headers = rows[0]
        return [
            {h: (row[i] if i < len(row) else "") for i, h in enumerate(headers)}
            for row in rows[1:]
        ]

    def append_rows(self, tab_name: str, rows: list[list[Any]], raw: bool = False) -> None:
        """탭 끝에 행들을 추가한다. raw=True이면 텍스트 그대로 저장 (날짜 자동변환 방지)."""
        if not rows:
            return
        self.service.spreadsheets().values().append(
            spreadsheetId=self.spreadsheet_id,
            range=f"{tab_name}!A1",
            valueInputOption="RAW" if raw else "USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()
        logger.info("%s에 %d행 추가", tab_name, len(rows))

    def update_cell(self, tab_name: str, row_index: int, col_index: int, value: str) -> None:
        """특정 셀을 업데이트한다. row_index는 1-based (헤더 제외, 데이터 첫 행=2)."""
        col_letter = chr(ord("A") + col_index)
        cell_range = f"{tab_name}!{col_letter}{row_index}"
        self.service.spreadsheets().values().update(
            spreadsheetId=self.spreadsheet_id,
            range=cell_range,
            valueInputOption="USER_ENTERED",
            body={"values": [[value]]},
        ).execute()

    def batch_update_rows(self, tab_name: str, data: list[dict]) -> None:
        """여러 범위의 값을 한 번에 업데이트한다."""
        if not data:
            return
        batch_data = []
        for item in data:
            batch_data.append({
                "range": f"{tab_name}!{item['range']}",
                "values": item["values"],
            })
        self.service.spreadsheets().values().batchUpdate(
            spreadsheetId=self.spreadsheet_id,
            body={"valueInputOption": "USER_ENTERED", "data": batch_data},
        ).execute()

    def ensure_headers(self) -> None:
        """모든 탭에 헤더가 없으면 추가하고, 헤더 행을 보호한다."""
        for tab_name, headers in HEADERS.items():
            try:
                result = (
                    self.service.spreadsheets()
                    .values()
                    .get(spreadsheetId=self.spreadsheet_id, range=f"{tab_name}!A1:Z1")
                    .execute()
                )
                existing = result.get("values", [])
                if not existing:
                    self.service.spreadsheets().values().update(
                        spreadsheetId=self.spreadsheet_id,
                        range=f"{tab_name}!A1",
                        valueInputOption="RAW",
                        body={"values": [headers]},
                    ).execute()
                    logger.info("%s 헤더 생성 완료", tab_name)
            except Exception as e:
                logger.warning("%s 탭 접근 실패 (탭이 존재하는지 확인): %s", tab_name, e)

        self._protect_headers()

    def _protect_headers(self) -> None:
        """각 탭의 헤더 행(1행)을 편집 보호한다. 서비스 계정만 편집 가능."""
        try:
            meta = self.service.spreadsheets().get(
                spreadsheetId=self.spreadsheet_id,
            ).execute()
        except Exception as e:
            logger.warning("시트 메타 조회 실패: %s", e)
            return

        sheets = {s["properties"]["title"]: s for s in meta.get("sheets", [])}

        # 기존 보호 범위 확인
        existing_protections = set()
        for sheet in meta.get("sheets", []):
            for pr in sheet.get("protectedRanges", []):
                desc = pr.get("description", "")
                if desc.startswith("gamwatch-header-"):
                    existing_protections.add(desc)

        requests = []
        for tab_name in HEADERS:
            sheet_info = sheets.get(tab_name)
            if not sheet_info:
                continue

            protection_id = f"gamwatch-header-{tab_name}"
            if protection_id in existing_protections:
                continue

            sheet_id = sheet_info["properties"]["sheetId"]
            requests.append({
                "addProtectedRange": {
                    "protectedRange": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "endRowIndex": 1,
                        },
                        "description": protection_id,
                        "warningOnly": False,
                    }
                }
            })

        if requests:
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=self.spreadsheet_id,
                body={"requests": requests},
            ).execute()
            logger.info("헤더 보호 설정 완료 (%d개 탭)", len(requests))

    # ──────────────────────────────────────────
    # 도메인별 메서드
    # ──────────────────────────────────────────

    def get_processed_video_ids(self) -> set[str]:
        """이미 처리된 영상 ID 집합을 반환한다."""
        rows = self.read_tab(TAB_PROCESSED_VIDEOS)
        return {r["video_id"] for r in rows if r.get("video_id")}

    def get_pending_manual_queue(self) -> list[dict]:
        """status='pending'인 수동 큐 항목을 반환한다."""
        rows = self.read_tab(TAB_MANUAL_QUEUE)
        return [r for r in rows if r.get("status") == "pending"]

    def update_manual_queue_status(self, url: str, new_status: str) -> None:
        """수동 큐 항목의 status를 업데이트한다."""
        rows = self.read_tab(TAB_MANUAL_QUEUE)
        headers = HEADERS[TAB_MANUAL_QUEUE]
        status_col = headers.index("status")
        for i, row in enumerate(rows):
            if row.get("url") == url:
                self.update_cell(TAB_MANUAL_QUEUE, i + 2, status_col, new_status)
                return

    def get_user_keywords(self) -> tuple[list[str], list[str]]:
        """_keywords 탭에서 사용자 키워드를 읽어 (include, exclude) 리스트로 반환한다."""
        rows = self.read_tab(TAB_KEYWORDS)
        include = []
        exclude = []
        for r in rows:
            keyword = r.get("keyword", "").strip()
            ktype = r.get("type", "include").strip().lower()
            if not keyword:
                continue
            if ktype == "exclude":
                exclude.append(keyword)
            else:
                include.append(keyword)
        return include, exclude

    def write_processed_video(self, video: dict) -> None:
        """처리된 영상 정보를 _processed_videos에 기록한다."""
        headers = HEADERS[TAB_PROCESSED_VIDEOS]
        row = [video.get(h, "") for h in headers]
        self.append_rows(TAB_PROCESSED_VIDEOS, [row])

    def write_agendas(self, agendas: list[dict]) -> None:
        """안건 목록을 agendas 탭에 기록한다."""
        headers = HEADERS[TAB_AGENDAS]
        rows = [[a.get(h, "") for h in headers] for a in agendas]
        self.append_rows(TAB_AGENDAS, rows, raw=True)

    def write_statements(self, statements: list[dict]) -> None:
        """발언 목록을 statements 탭에 기록한다."""
        headers = HEADERS[TAB_STATEMENTS]
        rows = [[s.get(h, "") for h in headers] for s in statements]
        self.append_rows(TAB_STATEMENTS, rows, raw=True)

    def write_news_articles(self, articles: list[dict]) -> None:
        """뉴스 기사 목록을 news_articles 탭에 기록한다."""
        headers = HEADERS[TAB_NEWS_ARTICLES]
        rows = [[a.get(h, "") for h in headers] for a in articles]
        self.append_rows(TAB_NEWS_ARTICLES, rows, raw=True)
