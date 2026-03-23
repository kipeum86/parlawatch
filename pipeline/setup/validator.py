"""API 키 유효성 검증."""

import logging

logger = logging.getLogger(__name__)


def validate_anthropic(api_key: str) -> dict:
    """Anthropic API 키를 검증한다."""
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10,
            messages=[{"role": "user", "content": "test"}],
        )
        return {"status": "ok", "message": "Anthropic API 연결 성공"}
    except Exception as e:
        return {"status": "error", "message": f"Anthropic API 오류: {e}"}


def validate_google_sheets(service_account_file: str, spreadsheet_id: str = "") -> dict:
    """Google Sheets API 서비스 계정을 검증한다."""
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds = service_account.Credentials.from_service_account_file(
            service_account_file,
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        service = build("sheets", "v4", credentials=creds)
        if spreadsheet_id:
            service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        return {"status": "ok", "message": "Google Sheets API 연결 성공"}
    except Exception as e:
        return {"status": "error", "message": f"Google Sheets API 오류: {e}"}


def validate_youtube(api_key: str) -> dict:
    """YouTube Data API 키를 검증한다."""
    try:
        from googleapiclient.discovery import build

        youtube = build("youtube", "v3", developerKey=api_key)
        youtube.search().list(q="국회", part="snippet", maxResults=1).execute()
        return {"status": "ok", "message": "YouTube Data API 연결 성공"}
    except Exception as e:
        return {"status": "error", "message": f"YouTube Data API 오류: {e}"}


def validate_naver(client_id: str, client_secret: str) -> dict:
    """Naver Search API를 검증한다."""
    try:
        import requests

        headers = {
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret,
        }
        resp = requests.get(
            "https://openapi.naver.com/v1/search/news.json",
            headers=headers,
            params={"query": "테스트", "display": 1},
            timeout=10,
        )
        resp.raise_for_status()
        return {"status": "ok", "message": "Naver Search API 연결 성공"}
    except Exception as e:
        return {"status": "error", "message": f"Naver Search API 오류: {e}"}


def validate_all(
    anthropic_key: str = "",
    sa_file: str = "",
    spreadsheet_id: str = "",
    youtube_key: str = "",
    naver_id: str = "",
    naver_secret: str = "",
) -> dict:
    """모든 API를 검증하고 결과를 반환한다."""
    results = {}
    if anthropic_key:
        results["anthropic"] = validate_anthropic(anthropic_key)
    if sa_file:
        results["google_sheets"] = validate_google_sheets(sa_file, spreadsheet_id)
    if youtube_key:
        results["youtube"] = validate_youtube(youtube_key)
    if naver_id and naver_secret:
        results["naver"] = validate_naver(naver_id, naver_secret)
    return results
