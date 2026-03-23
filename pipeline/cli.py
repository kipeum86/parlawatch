"""GamWatch CLI — 수동으로 영상 하나를 분석하는 간편 도구.

사용법:
  # 영상 분석 → Sheets 기록
  python -m pipeline.cli https://www.youtube.com/watch?v=VIDEO_ID --committee 문체위 --date 2026-10-23

  # Sheets 기록 없이 결과만 확인 (터미널 출력)
  python -m pipeline.cli https://www.youtube.com/watch?v=VIDEO_ID --dry-run

  # 자막만 추출
  python -m pipeline.cli https://www.youtube.com/watch?v=VIDEO_ID --subtitle-only
"""

import argparse
import json
import logging
import os
import sys

from .config import load_config, ENV_GOOGLE_CREDENTIALS, ENV_ANTHROPIC_API_KEY, ENV_SPREADSHEET_ID
from .llm import create_llm_client
from .sheets_client import SheetsClient
from .subtitle_extractor import extract_subtitles
from .text_processor import merge_keywords, process_text
from .utils import now_kst_str, make_agenda_id, make_statement_id, make_article_id
from .video_detector import _extract_video_id

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="GamWatch — 영상 수동 분석")
    parser.add_argument("url", help="유튜브 영상 URL 또는 video ID")
    parser.add_argument("--committee", default="", help="상임위/기관명 (예: 문체위)")
    parser.add_argument("--committee-code", default="etc", help="상임위 코드 (예: munche)")
    parser.add_argument("--date", default="", help="행사 일자 (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Sheets 기록 없이 결과만 출력")
    parser.add_argument("--subtitle-only", action="store_true", help="자막 추출만 수행")
    parser.add_argument("--output", default="", help="결과 JSON 저장 경로")
    parser.add_argument("--sa-file", default="", help="GCP 서비스 계정 JSON 경로 (기본: 환경변수)")
    args = parser.parse_args()

    video_id = _extract_video_id(args.url)
    if not video_id:
        # URL이 아니라 video_id 직접 입력일 수 있음
        video_id = args.url.strip()

    logger.info("영상 ID: %s", video_id)

    # ── 1. 자막 추출 ──
    logger.info("자막 추출 중...")
    subtitle_text, subtitle_source = extract_subtitles(video_id)

    if subtitle_text is None:
        logger.error("자막을 찾을 수 없습니다: %s", video_id)
        sys.exit(1)

    logger.info("자막 소스: %s (%d자)", subtitle_source, len(subtitle_text))

    if args.subtitle_only:
        print("\n" + "=" * 60)
        print(f"자막 소스: {subtitle_source}")
        print(f"길이: {len(subtitle_text)}자")
        print("=" * 60)
        print(subtitle_text[:3000])
        if len(subtitle_text) > 3000:
            print(f"\n... (이하 {len(subtitle_text) - 3000}자 생략)")
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(subtitle_text)
            logger.info("자막 저장: %s", args.output)
        return

    # ── 2. LLM 분석 ──
    config = load_config()
    anthropic_key = os.environ.get(ENV_ANTHROPIC_API_KEY, "")
    if not anthropic_key:
        logger.error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.")
        sys.exit(1)

    llm = create_llm_client(config, anthropic_key)
    company_names = config.get("company_names", [])

    # 키워드 (dry-run에서는 Sheets 없이 기본 키워드만 사용)
    user_include, user_exclude = [], []
    sa_file = args.sa_file or os.environ.get(ENV_GOOGLE_CREDENTIALS, "")
    spreadsheet_id = os.environ.get(ENV_SPREADSHEET_ID, "")

    sheets = None
    if sa_file and spreadsheet_id and not args.dry_run:
        sheets = SheetsClient(sa_file, spreadsheet_id)
        user_include, user_exclude = sheets.get_user_keywords()

    include_kw, exclude_kw = merge_keywords(user_include, user_exclude)

    logger.info("LLM 분석 시작...")
    agendas = process_text(subtitle_text, llm, company_names, include_kw, exclude_kw)

    # ── 3. 결과 출력 ──
    result = {
        "video_id": video_id,
        "subtitle_source": subtitle_source,
        "subtitle_length": len(subtitle_text),
        "agendas": agendas,
    }

    print("\n" + "=" * 60)
    print(f"분석 완료: {len(agendas)}개 안건")
    game_count = sum(1 for a in agendas if a.get("category") == "game")
    print(f"  게임 관련: {game_count}개")
    print(f"  일반: {len(agendas) - game_count}개")
    print("=" * 60)

    for i, agenda in enumerate(agendas):
        tag = "[게임]" if agenda.get("category") == "game" else "[일반]"
        company = " ★게임사언급" if agenda.get("is_company_mentioned") else ""
        print(f"\n{i+1}. {tag}{company} {agenda.get('title', '')}")
        print(f"   {agenda.get('summary', '')}")

        if agenda.get("is_company_mentioned") and agenda.get("company_mention_detail"):
            print(f"   ※ {agenda['company_mention_detail']}")

        for s in agenda.get("statements", []):
            role = "질의" if s.get("speaker_role") == "questioner" else "답변"
            party = f"({s['speaker_party']})" if s.get("speaker_party") else ""
            print(f"   [{role}] {party}{s.get('speaker_name', '')}: {s.get('content', '')}")

    # JSON 출력/저장
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        logger.info("결과 저장: %s", args.output)

    if args.dry_run:
        logger.info("dry-run 모드: Sheets 기록 생략")
        return

    # ── 4. Sheets 기록 (선택) ──
    if sheets:
        date = args.date or now_kst_str()[:10]
        _write_to_sheets(sheets, video_id, args, subtitle_source, agendas, date)
        logger.info("Sheets 기록 완료")
    else:
        logger.info("Sheets 설정이 없어 기록을 건너뜁니다. (--dry-run 없이 기록하려면 환경변수 설정 필요)")


def _write_to_sheets(sheets, video_id, args, subtitle_source, agendas, date):
    """분석 결과를 Sheets에 기록한다."""
    sheets.write_processed_video({
        "video_id": video_id,
        "committee": args.committee,
        "date": date,
        "title": "",
        "video_url": args.url,
        "source": "manual",
        "subtitle_source": subtitle_source,
        "processed_at": now_kst_str(),
        "status": "success",
        "error_message": "",
    })

    agenda_records = []
    statement_records = []
    for i, agenda in enumerate(agendas):
        agenda_id = make_agenda_id(date, args.committee_code, i + 1)
        agenda_records.append({
            "agenda_id": agenda_id,
            "video_id": video_id,
            "committee": args.committee,
            "date": date,
            "category": agenda.get("category", "general"),
            "title": agenda.get("title", ""),
            "summary": agenda.get("summary", ""),
            "is_company_mentioned": str(agenda.get("is_company_mentioned", False)).upper(),
            "company_mention_detail": agenda.get("company_mention_detail", ""),
            "sort_order": str(i + 1),
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

    if agenda_records:
        sheets.write_agendas(agenda_records)
    if statement_records:
        sheets.write_statements(statement_records)


if __name__ == "__main__":
    main()
