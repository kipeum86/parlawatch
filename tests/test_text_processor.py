"""text_processor.py 테스트."""
from pipeline.text_processor import merge_keywords, keyword_filter


class TestMergeKeywords:
    def test_merge_all(self):
        inc, exc = merge_keywords(["a", "b"], ["x"], ["b", "c"], ["y"])
        assert set(inc) == {"a", "b", "c"}
        assert set(exc) == {"x", "y"}

    def test_empty_config(self):
        inc, exc = merge_keywords([], [], ["a"], ["b"])
        assert set(inc) == {"a"}
        assert set(exc) == {"b"}

    def test_both_empty(self):
        inc, exc = merge_keywords([], [], [], [])
        assert inc == []
        assert exc == []


class TestKeywordFilter:
    def test_match(self):
        assert keyword_filter("의료 산업 관련 논의", ["의료"], []) is True

    def test_no_match(self):
        assert keyword_filter("교육 관련 논의", ["의료"], []) is False

    def test_exclude(self):
        assert keyword_filter("의료 체인저", ["의료"], ["의료 체인저"]) is False

    def test_empty_include(self):
        assert keyword_filter("아무 텍스트", [], []) is True
