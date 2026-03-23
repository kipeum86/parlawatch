"""ID 생성, 날짜 헬퍼, 재시도 데코레이터."""

import functools
import logging
import time
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))


def now_kst() -> datetime:
    """현재 KST 시각을 반환한다."""
    return datetime.now(KST)


def now_kst_str() -> str:
    """현재 KST 시각을 ISO 문자열로 반환한다."""
    return now_kst().strftime("%Y-%m-%d %H:%M:%S")


def make_agenda_id(date: str, committee_code: str, seq: int) -> str:
    """안건 ID 생성. 예: 20261023_munche_001"""
    date_compact = date.replace("-", "")
    return f"{date_compact}_{committee_code}_{seq:03d}"


def make_statement_id(agenda_id: str, seq: int) -> str:
    """발언 ID 생성. 예: 20261023_munche_001_s001"""
    return f"{agenda_id}_s{seq:03d}"


def make_article_id(agenda_id: str, seq: int) -> str:
    """기사 ID 생성. 예: 20261023_munche_001_n001"""
    return f"{agenda_id}_n{seq:03d}"


def retry(max_attempts: int = 3, delay: float = 5.0, backoff: float = 2.0):
    """재시도 데코레이터. 지수 백오프 적용."""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exc = None
            current_delay = delay
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exc = e
                    if attempt < max_attempts:
                        logger.warning(
                            "%s 실패 (시도 %d/%d): %s — %0.1f초 후 재시도",
                            func.__name__, attempt, max_attempts, e, current_delay,
                        )
                        time.sleep(current_delay)
                        current_delay *= backoff
                    else:
                        logger.error(
                            "%s 최종 실패 (%d회 시도): %s",
                            func.__name__, max_attempts, e,
                        )
            raise last_exc

        return wrapper

    return decorator
