import yaml

from .base import LLMClient
from .claude import ClaudeClient


def create_llm_client(config: dict, api_key: str) -> LLMClient:
    """config.yaml의 llm 섹션 기반으로 LLM 클라이언트를 생성한다."""
    provider = config["llm"]["provider"]
    model = config["llm"]["model"]
    max_tokens = config["llm"].get("max_tokens", 8192)

    if provider == "claude":
        return ClaudeClient(api_key=api_key, model=model, max_tokens=max_tokens)
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")
