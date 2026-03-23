"""유튜브 자막 추출: youtube-transcript-api → NotebookLM → yt-dlp fallback."""

import asyncio
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_subtitles(video_id: str) -> tuple[str | None, str]:
    """유튜브 영상에서 한국어 자막을 추출한다.

    1차: youtube-transcript-api (봇 차단에 강함)
    2차: NotebookLM (비공식 API, NOTEBOOKLM_AUTH_JSON 설정 시)
    3차: yt-dlp fallback

    Returns:
        (자막 텍스트, 자막 소스) 튜플.
        자막 소스: "stenographer" / "auto_generated" / "notebooklm" / "none"
        자막이 없으면 (None, "none") 반환.
    """
    # 1차 시도: youtube-transcript-api
    result = _try_transcript_api(video_id)
    if result[0] is not None:
        return result

    # 2차 시도: NotebookLM (비공식 API, 인증 있을 때만)
    if os.environ.get("NOTEBOOKLM_AUTH_JSON", "").strip():
        logger.info("transcript-api 실패, NotebookLM으로 재시도: %s", video_id)
        result = _try_notebooklm(video_id)
        if result[0] is not None:
            return result

    # 3차 시도: yt-dlp
    logger.info("NotebookLM 미사용/실패, yt-dlp로 재시도: %s", video_id)
    result = _try_ytdlp(video_id)
    if result[0] is not None:
        return result

    logger.info("자막 없음: %s", video_id)
    return None, "none"


def _try_transcript_api(video_id: str) -> tuple[str | None, str]:
    """youtube-transcript-api로 자막을 가져온다."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        ytt_api = YouTubeTranscriptApi()

        # 어떤 자막이 있는지 먼저 확인
        try:
            transcript_list = ytt_api.list(video_id)
            available = []
            for t in transcript_list:
                available.append(f"{t.language_code}(generated={t.is_generated})")
            logger.info("transcript-api: 사용 가능한 자막: %s", ", ".join(available) if available else "없음")
        except Exception as e:
            logger.warning("transcript-api list 실패: %s: %s", type(e).__name__, e)

        # 한국어 자막 fetch
        try:
            transcript = ytt_api.fetch(video_id, languages=["ko"])
            text = _transcript_to_text(transcript)
            if text:
                # 자동생성 여부 판별
                is_generated = False
                try:
                    for t in ytt_api.list(video_id):
                        if t.language_code == "ko":
                            is_generated = t.is_generated
                            break
                except Exception:
                    pass
                source = "auto_generated" if is_generated else "stenographer"
                logger.info("transcript-api: 자막 추출 성공 (%s, %d자)", source, len(text))
                return text, source
        except Exception as e:
            logger.warning("transcript-api fetch 실패: %s: %s", type(e).__name__, e)

        return None, "none"

    except ImportError:
        logger.warning("youtube-transcript-api 미설치")
        return None, "none"
    except Exception as e:
        logger.warning("transcript-api 예외: %s: %s", type(e).__name__, e)
        return None, "none"


def _transcript_to_text(transcript) -> str | None:
    """Transcript 객체를 텍스트로 변환한다."""
    lines = []
    prev_text = ""
    # transcript는 FetchedTranscript 객체, .snippets로 접근
    snippets = getattr(transcript, 'snippets', None) or transcript
    for snippet in snippets:
        text = getattr(snippet, 'text', None)
        if text is None:
            # dict 형태인 경우
            text = snippet.get('text', '') if isinstance(snippet, dict) else str(snippet)
        text = text.strip()
        if not text:
            continue
        # 중복 라인 제거
        if text == prev_text:
            continue
        if prev_text and _overlap_ratio(prev_text, text) > 0.8:
            continue
        lines.append(text)
        prev_text = text

    if not lines:
        return None
    return "\n".join(lines)


def _try_notebooklm(video_id: str) -> tuple[str | None, str]:
    """NotebookLM 비공식 API로 YouTube 자막을 추출한다.

    NOTEBOOKLM_AUTH_JSON 환경변수에 Playwright storage_state.json 내용이
    있어야 동작한다. 비공식 API이므로 언제든 실패할 수 있다.
    """
    try:
        from notebooklm import NotebookLMClient
    except ImportError:
        logger.warning("notebooklm-py 미설치 — 스킵")
        return None, "none"

    async def _extract():
        async with await NotebookLMClient.from_storage() as client:
            nb = await client.notebooks.create(f"gamwatch-temp-{video_id}")
            try:
                url = f"https://www.youtube.com/watch?v={video_id}"
                source = await client.sources.add_url(
                    nb.id, url, wait=True, wait_timeout=180.0,
                )
                fulltext = await client.sources.get_fulltext(nb.id, source.id)
                return fulltext.content
            finally:
                try:
                    await client.notebooks.delete(nb.id)
                except Exception:
                    pass

    try:
        text = asyncio.run(_extract())
        if text and len(text) > 100:
            logger.info("NotebookLM: 자막 추출 성공 (%d자)", len(text))
            return text, "notebooklm"
        logger.warning("NotebookLM: 추출 텍스트 부족 (%d자)", len(text) if text else 0)
        return None, "none"
    except Exception as e:
        logger.warning("NotebookLM 추출 실패: %s: %s", type(e).__name__, e)
        return None, "none"


def _try_ytdlp(video_id: str) -> tuple[str | None, str]:
    """yt-dlp로 자막을 추출한다 (fallback)."""
    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        output_template = str(Path(tmpdir) / video_id)

        cmd = [
            "yt-dlp",
            "--write-sub",
            "--write-auto-sub",
            "--sub-lang", "ko",
            "--sub-format", "vtt",
            "--skip-download",
            "-o", output_template,
            url,
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                logger.warning("yt-dlp 실행 실패: %s", result.stderr[:500])
        except subprocess.TimeoutExpired:
            logger.error("yt-dlp 타임아웃: %s", video_id)
            return None, "none"

        # 속기사 자막 우선, 없으면 자동생성 자막
        steno_path = Path(tmpdir) / f"{video_id}.ko.vtt"
        auto_path = Path(tmpdir) / f"{video_id}.ko.auto.vtt"

        if steno_path.exists():
            text = _parse_vtt(steno_path, is_auto=False)
            return text, "stenographer"
        elif auto_path.exists():
            text = _parse_vtt(auto_path, is_auto=True)
            return text, "auto_generated"
        else:
            vtt_files = list(Path(tmpdir).glob("*.vtt"))
            if vtt_files:
                is_auto = "auto" in vtt_files[0].name.lower()
                text = _parse_vtt(vtt_files[0], is_auto=is_auto)
                source = "auto_generated" if is_auto else "stenographer"
                return text, source

            return None, "none"


def _parse_vtt(vtt_path: Path, is_auto: bool = False) -> str:
    """VTT 파일을 파싱하여 순수 텍스트를 반환한다."""
    content = vtt_path.read_text(encoding="utf-8")
    lines = content.split("\n")

    text_lines = []
    prev_line = ""

    for line in lines:
        line = line.strip()

        if not line:
            continue
        if line.startswith("WEBVTT"):
            continue
        if line.startswith("Kind:") or line.startswith("Language:"):
            continue
        if line.startswith("NOTE"):
            continue
        if re.match(r"^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->", line):
            continue
        if re.match(r"^\d+$", line):
            continue

        cleaned = re.sub(r"<[^>]+>", "", line)
        cleaned = cleaned.strip()

        if not cleaned:
            continue

        if is_auto:
            if cleaned == prev_line:
                continue
            if prev_line and _overlap_ratio(prev_line, cleaned) > 0.8:
                continue

        text_lines.append(cleaned)
        prev_line = cleaned

    return "\n".join(text_lines)


def _overlap_ratio(a: str, b: str) -> float:
    """두 문자열의 겹침 비율을 계산한다."""
    if not a or not b:
        return 0.0
    shorter = min(len(a), len(b))
    matches = sum(1 for ca, cb in zip(a, b) if ca == cb)
    return matches / shorter
