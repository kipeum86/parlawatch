# ParlaWatch -- 범용 국회 모니터링 도구

AI 기반 국회 모니터링 자동화 도구입니다. 어떤 산업/분야든 키워드와 도메인만 설정하면 국회 영상을 자동으로 분석합니다.

## 주요 기능

- **도메인 무관 모니터링** -- 의료, 금융, 교육, 어떤 산업이든 config.yaml 설정만으로 즉시 사용
- **AI 자동 분석** -- Claude AI가 국회 영상 자막을 2-pass로 분석하여 안건 구조화
- **Claude Code 셋업 위저드** -- API 키 검증, Google Sheets 자동 생성, 도메인 설정까지 대화형으로 안내
- **실시간 대시보드** -- GitHub Pages 기반 대시보드에서 분석 결과를 필터링/검색
- **자동 실행** -- GitHub Actions로 매일 자동 실행 (모니터링 기간 설정 가능)

## 아키텍처

```
유튜브 국회방송 -> 자막 추출 (3가지 소스)
                    |
              Claude AI 2-pass 분석
              (Pass 1: 구조화 -> Pass 2: 검증)
                    |
              Google Sheets 저장 (6개 탭)
                    |
              GitHub Pages 대시보드
```

## 빠른 시작

### Claude Code 사용자
```bash
cd parlawatch
# Claude Code가 CLAUDE.md를 읽고 셋업을 안내합니다
```

### 수동 셋업
1. `config.yaml`에서 도메인, 키워드, 기관 설정
2. `.env`에 API 키 설정
3. `python -m pipeline.cli "유튜브URL" --dry-run`으로 테스트

자세한 셋업 가이드는 `CLAUDE.md`를 참고하세요.

## 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| LLM | Claude (Anthropic API) |
| 자막 추출 | youtube-transcript-api, NotebookLM, yt-dlp |
| 데이터 저장 | Google Sheets API |
| 뉴스 검색 | Naver Search API |
| 자동 실행 | GitHub Actions |
| 대시보드 | Vanilla JS + GitHub Pages |

## 프로젝트 구조

```
pipeline/           -- Python 파이프라인
  config.py         -- 설정 로드 + 검증
  main.py           -- 파이프라인 오케스트레이터
  cli.py            -- 수동 분석 CLI
  text_processor.py -- 키워드 필터 + LLM 2-pass 분석
  llm/              -- LLM 클라이언트 + 프롬프트
  setup/            -- 셋업 도우미 (검증, Sheets 생성)
docs/               -- GitHub Pages 대시보드
tests/              -- pytest 테스트
config.yaml         -- 도메인/키워드 설정 (빈 템플릿)
config.example.yaml -- 예시 설정
```

## 라이선스

MIT
