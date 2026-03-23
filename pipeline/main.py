"""GamWatch 파이프라인 메인 오케스트레이터.

실행: python -m pipeline.main
"""

import json
import logging
import os
import sys

from .config import (
    load_config,
    ENV_GOOGLE_CREDENTIALS,
    ENV_ANTHROPIC_API_KEY,
    ENV_NAVER_CLIENT_ID,
    ENV_NAVER_CLIENT_SECRET,
    ENV_SPREADSHEET_ID,
)
from .llm import create_llm_client
from .news_searcher import NewsSearcher
from .sheets_client import SheetsClient
from .subtitle_extractor import extract_subtitles
from .text_processor import merge_keywords, process_text
from .utils import make_agenda_id, make_statement_id, make_article_id, now_kst_str
from .video_detector import detect_videos, VideoTask, _extract_video_id, _guess_committee_code

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def _is_in_audit_period(config: dict) -> bool:
    """현재 날짜가 국정감사 기간 내인지 확인한다."""
    from datetime import date
    period = config.get("audit_period", {})
    start = period.get("start", "")
    end = period.get("end", "")
    if not start or not end:
        return True  # 기간 미설정이면 항상 실행
    today = date.today().isoformat()
    return start <= today <= end


def run_pipeline():
    """전체 파이프라인을 실행한다."""
    logger.info("=== GamWatch 파이프라인 시작 ===")

    # ── 설정 로드 ──
    config = load_config()
    sa_file = os.environ.get(ENV_GOOGLE_CREDENTIALS, "")
    spreadsheet_id = os.environ.get(ENV_SPREADSHEET_ID, "")
    anthropic_key = os.environ.get(ENV_ANTHROPIC_API_KEY, "")
    naver_id = os.environ.get(ENV_NAVER_CLIENT_ID, "")
    naver_secret = os.environ.get(ENV_NAVER_CLIENT_SECRET, "")

    if not sa_file or not spreadsheet_id:
        logger.error("필수 환경 변수 미설정: %s, %s", ENV_GOOGLE_CREDENTIALS, ENV_SPREADSHEET_ID)
        sys.exit(1)

    # ── 클라이언트 초기화 ──
    sheets = SheetsClient(sa_file, spreadsheet_id)
    sheets.ensure_headers()

    llm = create_llm_client(config, anthropic_key)

    news_searcher = None
    if naver_id and naver_secret:
        news_searcher = NewsSearcher(
            naver_id, naver_secret,
            results_per_agenda=config.get("pipeline", {}).get("news_results_per_agenda", 5),
        )

    company_names = config.get("company_names", [])

    # 사용자 키워드 병합
    user_include, user_exclude = sheets.get_user_keywords()
    include_kw, exclude_kw = merge_keywords(user_include, user_exclude)
    logger.info("키워드: include=%d개, exclude=%d개", len(include_kw), len(exclude_kw))

    # ── 1. 영상 감지 ──
    manual_url = os.environ.get("MANUAL_VIDEO_URL", "").strip()

    # 자동 실행(cron)일 때 국정감사 기간 체크
    if not manual_url and not _is_in_audit_period(config):
        logger.info("국정감사 기간 외 — 자동 실행 스킵 (기간: %s ~ %s)",
                     config.get("audit_period", {}).get("start", "미설정"),
                     config.get("audit_period", {}).get("end", "미설정"))
        logger.info("=== GamWatch 파이프라인 종료 ===")
        return

    # 수동 입력 영상이 있으면 해당 영상만 처리
    if manual_url:
        video_id = _extract_video_id(manual_url)
        if not video_id:
            logger.error("유효하지 않은 URL: %s", manual_url)
            sys.exit(1)
        committee = os.environ.get("MANUAL_COMMITTEE", "").strip()
        committee_code = os.environ.get("MANUAL_COMMITTEE_CODE", "etc").strip()
        event_date = os.environ.get("MANUAL_EVENT_DATE", "").strip() or now_kst_str()[:10]
        event_type = os.environ.get("MANUAL_EVENT_TYPE", "").strip() or "국정감사"
        videos = [VideoTask(
            video_id=video_id,
            url=manual_url,
            title="",
            committee=committee,
            committee_code=_guess_committee_code(committee) if committee else committee_code,
            date=event_date,
            source="manual",
            event_type=event_type,
        )]
        logger.info("수동 입력 영상: %s (%s, %s)", video_id, committee or "미지정", event_type)
    else:
        days_back = config.get("pipeline", {}).get("search_days_back", 7)
        videos = detect_videos(sa_file, sheets, days_back=days_back)

    if not videos:
        logger.info("처리할 신규 영상이 없습니다.")
        logger.info("=== GamWatch 파이프라인 종료 ===")
        return

    logger.info("처리할 영상: %d개", len(videos))

    # ── 2~5. 각 영상 처리 ──
    success_count = 0
    error_count = 0

    for video in videos:
        logger.info("── 영상 처리 시작: %s (%s) ──", video.title or video.video_id, video.committee)

        try:
            # 수동 큐 상태 업데이트
            if video.source == "manual":
                sheets.update_manual_queue_status(video.url, "processing")

            # 2. 자막 추출 (외부 전달된 자막 우선 사용)
            pre_subtitle = os.environ.get("SUBTITLE_DATA", "").strip()
            if pre_subtitle:
                subtitle_text = _decompress_subtitle(pre_subtitle)
                subtitle_source = "browser_extracted"
                logger.info("외부 전달 자막 사용 (%d자)", len(subtitle_text))
            else:
                subtitle_text, subtitle_source = extract_subtitles(video.video_id)

            if subtitle_text is None:
                logger.info("자막 없음 — 스킵: %s", video.video_id)
                sheets.write_processed_video({
                    "video_id": video.video_id,
                    "committee": video.committee,
                    "date": video.date,
                    "title": video.title,
                    "video_url": video.url,
                    "source": video.source,
                    "subtitle_source": "none",
                    "processed_at": now_kst_str(),
                    "status": "no_subtitle",
                    "error_message": "",
                })
                if video.source == "manual":
                    sheets.update_manual_queue_status(video.url, "done")
                continue

            # 3. 텍스트 처리 (키워드 필터 + LLM)
            agendas_raw = process_text(
                subtitle_text, llm, company_names, include_kw, exclude_kw,
            )

            # 4. 뉴스 검색 (game 안건만)
            if news_searcher:
                for agenda in agendas_raw:
                    if agenda.get("category") == "game":
                        agenda["news_articles"] = news_searcher.search_for_agenda(agenda)

            # 5. Sheets 기록
            _write_results(sheets, video, subtitle_source, agendas_raw)

            if video.source == "manual":
                sheets.update_manual_queue_status(video.url, "done")

            success_count += 1
            logger.info("✓ 영상 처리 완료: %s", video.video_id)

        except Exception as e:
            error_count += 1
            logger.error("✗ 영상 처리 실패: %s — %s", video.video_id, e, exc_info=True)

            sheets.write_processed_video({
                "video_id": video.video_id,
                "committee": video.committee,
                "date": video.date,
                "title": video.title,
                "video_url": video.url,
                "source": video.source,
                "subtitle_source": "",
                "processed_at": now_kst_str(),
                "status": "error",
                "error_message": str(e)[:500],
            })

            if video.source == "manual":
                sheets.update_manual_queue_status(video.url, "error")

    logger.info("=== GamWatch 파이프라인 종료: 성공 %d, 실패 %d ===", success_count, error_count)


def _write_results(sheets: SheetsClient, video, subtitle_source: str, agendas_raw: list[dict]):
    """처리 결과를 Sheets에 기록한다."""
    agenda_records = []
    statement_records = []
    article_records = []

    for i, agenda in enumerate(agendas_raw):
        agenda_id = make_agenda_id(video.date, video.committee_code, i + 1)

        agenda_records.append({
            "agenda_id": agenda_id,
            "video_id": video.video_id,
            "committee": video.committee,
            "date": video.date,
            "category": agenda.get("category", "general"),
            "title": agenda.get("title", ""),
            "summary": agenda.get("summary", ""),
            "is_company_mentioned": str(agenda.get("is_company_mentioned", False)).upper(),
            "company_mention_detail": agenda.get("company_mention_detail", ""),
            "sort_order": str(i + 1),
            "event_type": video.event_type,
        })

        for j, stmt in enumerate(agenda.get("statements", [])):
            statement_records.append({
                "statement_id": make_statement_id(agenda_id, j + 1),
                "agenda_id": agenda_id,
                "speaker_name": stmt.get("speaker_name", ""),
                "speaker_party": stmt.get("speaker_party", ""),
                "speaker_role": stmt.get("speaker_role", ""),
                "content": stmt.get("content", ""),
                "sort_order": str(j + 1),
            })

        for k, article in enumerate(agenda.get("news_articles", [])):
            article_records.append({
                "article_id": make_article_id(agenda_id, k + 1),
                "agenda_id": agenda_id,
                "title": article.get("title", ""),
                "url": article.get("url", ""),
                "publisher": article.get("publisher", ""),
                "published_at": article.get("published_at", ""),
            })

    # Sheets에 기록
    sheets.write_processed_video({
        "video_id": video.video_id,
        "committee": video.committee,
        "date": video.date,
        "title": video.title,
        "video_url": video.url,
        "source": video.source,
        "subtitle_source": subtitle_source,
        "processed_at": now_kst_str(),
        "status": "success",
        "error_message": "",
    })

    if agenda_records:
        sheets.write_agendas(agenda_records)
    if statement_records:
        sheets.write_statements(statement_records)
    if article_records:
        sheets.write_news_articles(article_records)

    logger.info(
        "Sheets 기록: 안건 %d, 발언 %d, 기사 %d",
        len(agenda_records), len(statement_records), len(article_records),
    )


def _decompress_subtitle(data: str) -> str:
    """브라우저에서 gzip+base64로 압축된 자막을 해제한다."""
    import base64
    import gzip
    try:
        raw = base64.b64decode(data)
        return gzip.decompress(raw).decode("utf-8")
    except Exception:
        # 압축 안 된 평문일 수도 있음
        return data


if __name__ == "__main__":
    run_pipeline()
