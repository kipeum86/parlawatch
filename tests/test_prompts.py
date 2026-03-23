"""prompts.py 테스트."""
from pipeline.llm.prompts import get_pass1_system_prompt, get_pass2_system_prompt


class TestPass1Prompt:
    def test_domain_interpolation(self):
        prompt = get_pass1_system_prompt("의료/제약", "의료 분야 정책", ["삼성바이오"], ["의료"])
        assert "의료/제약" in prompt
        assert "삼성바이오" in prompt
        assert "domain" in prompt

    def test_empty_entities(self):
        prompt = get_pass1_system_prompt("금융", "금융 분야", [], ["금융"])
        assert "금융" in prompt
        assert "(없음)" in prompt

    def test_empty_keywords(self):
        prompt = get_pass1_system_prompt("교육", "교육 분야", [], [])
        assert "키워드 미설정" in prompt


class TestPass2Prompt:
    def test_domain_interpolation(self):
        prompt = get_pass2_system_prompt("의료", ["삼성바이오"], ["의료", "제약"])
        assert "의료" in prompt
        assert "삼성바이오" in prompt
