# GamWatch — 국정감사 게임산업 모니터링

## 개요
국정감사 중 게임 산업 관련 발언을 자동 모니터링하는 시스템.

**핵심 흐름:** 유튜브 영상 → 자막 추출 → LLM 분석 → Google Sheets 저장 → GitHub Pages 대시보드

## 구조
```
pipeline/          — Python 백엔드 (자막 추출, LLM 분석, Sheets 기록)
docs/              — GitHub Pages 프론트엔드 (대시보드)
.github/workflows/ — GitHub Actions 워크플로우 (cron + workflow_dispatch)
config.yaml        — LLM 모델, 상임위, 게임사 목록, 국감 기간 설정
```

## 기술 스택
- **LLM**: Claude (Anthropic API)
- **자막 추출**: youtube-transcript-api → NotebookLM-py → yt-dlp (fallback chain)
- **데이터 저장**: Google Sheets API
- **자동 실행**: GitHub Actions (국감 기간 중 매일 새벽 2시 KST)
- **프론트엔드**: Vanilla JS + GitHub Pages
- **인증**: 브라우저 localStorage (비밀번호 게이트 + PAT)
