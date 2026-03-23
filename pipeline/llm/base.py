"""LLM 클라이언트 추상 인터페이스."""

from abc import ABC, abstractmethod
from typing import Any


class LLMClient(ABC):
    """LLM API 추상 클래스. 프로바이더별 구현체가 상속한다."""

    @abstractmethod
    def process(self, system_prompt: str, user_content: str) -> dict[str, Any]:
        """시스템 프롬프트와 사용자 콘텐츠를 전송하고 JSON 응답을 반환한다.

        Args:
            system_prompt: 시스템 역할 프롬프트
            user_content: 분석할 자막 텍스트 등

        Returns:
            파싱된 JSON dict
        """
        pass
