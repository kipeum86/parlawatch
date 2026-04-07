# assembly-api-mcp + ParlaWatch 통합 아이디어

**날짜**: 2026-04-07  
**참고**: https://github.com/hollobit/assembly-api-mcp

---

## assembly-api-mcp란?

- 국회 열린 API 276개를 **MCP(Model Context Protocol) 서버**로 래핑한 프로젝트
- Claude, Gemini, ChatGPT 등 AI 도구에서 국회 데이터에 실시간 접근 가능
- TypeScript 기반, stdio/HTTP 이중 전송 지원
- Lite 프로필 9개 + Full 프로필 18개 도구 제공

### 주요 MCP 도구

| 도구 | 설명 |
|------|------|
| `search_members` | 의원 검색 (이름, 정당, 지역구, 위원회) |
| `search_bills` | 의안 검색 + 상세 + 상태 필터 (계류/처리/최근) |
| `get_schedule` | 국회 일정 (날짜/위원회/키워드별) |
| `search_meetings` | 회의록 검색 (본회의, 위원회, 소위, 감사, 청문회) |
| `get_votes` | 표결 결과 (본회의 전체 / 의안별 의원 투표) |
| `analyze_legislator` | 의원 종합 분석 (프로필 + 발의안 + 표결 기록) |
| `track_legislation` | 다중 키워드 법안 추적 + 심사 이력 |
| `discover_apis` | 276개 API 검색/탐색 |
| `query_assembly` | 임의 API 코드로 직접 호출 (만능 도구) |
| `get_legislation_notices` | 입법예고 |
| `get_budget_analysis` | 예산정책처 분석 자료 |
| `search_research_reports` | 입법조사처 보고서 |

---

## ParlaWatch 현재 상태

- **데이터 소스**: 유튜브 국회방송 자막 + Naver 뉴스
- **분석**: Claude AI 2-pass (구조화 + 검증)
- **출력**: Google Sheets 6개 탭 + GitHub Pages 대시보드
- **한계**: 유튜브 자막이라는 단일 소스에 의존, 공식 데이터와 연결 없음

---

## 통합 시 가능한 기능들

### 1. 즉시 가능한 강력한 기능

#### 의안 자동 연결 (Bill Linking)
- 자막에서 "○○법 개정안" 키워드 감지 → `search_bills`로 실제 의안 검색
- 발의자, 현재 상태, 심사 이력까지 자동 첨부
- 현재는 뉴스 링크만 달지만, **공식 법안 정보**까지 연결 가능

#### 표결 데이터 연동 (Vote Tracking)
- 논의된 법안이 실제로 어떻게 표결되었는지 `get_votes`로 추적
- 의원별 찬반 기록 → "발언에서는 반대했지만 표결에서는 찬성" 같은 분석

#### 일정 기반 자동 모니터링
- 현재: 유튜브에서 영상 검색 (놓치기 쉬움)
- 개선: `get_schedule`로 **국회 공식 일정** 먼저 확인 → 관심 위원회 회의가 있는 날만 영상 탐색
- 회의 예정 알림도 가능

#### 회의록 교차 검증
- 유튜브 자막 (자동생성, 오류 多) vs `search_meetings` 공식 회의록
- 자막의 부정확한 부분을 공식 회의록으로 보정

---

### 2. 새로운 분석 차원

#### 의원 프로파일링
- `analyze_legislator` → 특정 의원의 발의 법안 + 표결 패턴 + 소속 위원회
- ParlaWatch 발언 데이터와 결합 → "이 의원이 우리 산업에 대해 어떤 입장인지" 종합 분석

#### 입법 파이프라인 추적
- `track_legislation` → 키워드 관련 법안의 전체 진행 상황 모니터링
- 발의 → 위원회 심사 → 본회의 표결까지 lifecycle 추적

#### 입법예고 조기 경보
- `get_legislation_notices` → 아직 발의 전인 입법예고 단계에서 포착
- 현재보다 **수주~수개월 빠른** 선제적 모니터링

#### 예산 분석 연동
- `get_budget_analysis` → 관련 산업 예산 분석 자료
- 국정감사 발언 + 실제 예산 배분 데이터 결합

---

### 3. 통합 아키텍처

```
현재 ParlaWatch 파이프라인:
  YouTube → 자막 → Claude 분석 → Sheets

통합 파이프라인:
  국회 일정 API ──┐
  YouTube 자막 ───┤
  의안/법률 API ──┼→ Claude 통합 분석 → Sheets + 대시보드
  회의록 API ─────┤
  입법예고 API ───┤
  표결 데이터 ────┘
```

통합 방법:
- **MCP 서버로 직접 연동** — Claude가 분석 중 필요할 때 assembly-api-mcp를 tool로 호출
- 또는 **파이프라인에 API 클라이언트 추가** — Python에서 직접 국회 API 호출

---

## 비교 요약

| 현재 (ParlaWatch만) | 통합 후 |
|---|---|
| 유튜브 자막만 분석 | 공식 회의록 + 의안 + 표결 + 예산 통합 분석 |
| 뉴스 링크만 첨부 | 실제 법안 정보 + 심사 이력 자동 연결 |
| 영상 발견에 의존 | 국회 일정 기반 선제적 모니터링 |
| 발언 내용만 기록 | 발언 → 법안 → 표결 → 예산까지 전체 흐름 추적 |
| 사후 분석 | 입법예고 단계에서 조기 경보 |

> **핵심**: "국회에서 뭐라고 말했는지" 기록하는 도구 → **"국회에서 실제로 뭐가 어떻게 진행되고 있는지"** 추적하는 도구로 진화

---

## 다음 단계

- [ ] 우선 구현할 기능 선정
- [ ] assembly-api-mcp API 키 발급
- [ ] Python 클라이언트 또는 MCP 연동 방식 결정
- [ ] 파이프라인 모듈 추가 구현
