# TrendTok 설계 문서

**날짜:** 2026-06-03
**프로젝트:** 마케터를 위한 틱톡 트렌드 분석 챗봇

---

## 프로젝트 개요

한국 마케터를 위한 틱톡 트렌드 분석 챗봇. Next.js + GPT-4o + RAG(Supabase pgvector) + Tool Calling(Tavily)로 구성. Vercel 배포.

---

## 기술 스택

- Framework: Next.js (App Router, TypeScript, Tailwind)
- LLM: OpenAI GPT-4o
- Tool Calling: Tavily API (실시간 웹 검색)
- RAG: Supabase (pgvector) + OpenAI text-embedding-3-small
- 배포: Vercel
- UI: 블랙 배경 + 화이트 텍스트, 심플 흑백 테마

---

## 아키텍처

### 동작 흐름 (Approach B)

```
사용자 질문
    ↓
RAG: 질문 임베딩 → Supabase 유사도 검색 → 관련 chunk 3개 추출
    ↓
GPT-4o 호출 (system prompt + RAG 컨텍스트 + 사용자 질문 + Tavily tool 정의 전달)
    ↓
GPT-4o가 실시간 정보 필요 판단 시 → search_tiktok_trends tool 호출
    ↓
Tavily 검색 결과 반환 → GPT-4o가 RAG 지식 + 실시간 결과 합쳐 최종 답변 생성
```

### RAG vs Tool Calling 역할 분리

| | RAG (Supabase) | Tool Calling (Tavily) |
|---|---|---|
| 역할 | 변하지 않는 마케팅 원칙 | 실시간 트렌드 |
| 예시 질문 | "알고리즘 어떻게 작동해?" | "요즘 핫한 챌린지 뭐야?" |
| 호출 시점 | 항상 (모든 질문에 RAG 검색) | GPT-4o가 필요할 때만 결정 |

---

## 파일 구조

```
trendtok/
├── app/
│   ├── api/
│   │   ├── chat/route.ts        ← 메인 챗 API (RAG + Tool Calling + GPT-4o)
│   │   └── embed/route.ts       ← RAG 임베딩 저장
│   └── page.tsx                 ← 채팅 UI
├── lib/
│   ├── supabase.ts              ← Supabase 클라이언트
│   ├── tools.ts                 ← Tavily Tool 정의
│   └── rag.ts                   ← 벡터 검색
└── documents/
    └── tiktok-knowledge.md      ← RAG 지식 문서
```

---

## 1. RAG 지식 문서 구조 (`documents/tiktok-knowledge.md`)

총 6개 섹션, 각 섹션이 1개 chunk로 저장됨.

- **섹션 1 - 틱톡 알고리즘 (FYP 작동 원리):** 시청 완료율, 재시청, 초기 1~2시간 반응의 중요성, 영상 단위 독립 평가
- **섹션 2 - 최적 영상 길이:** 7~15초(높은 완료율), 21~34초(골든 존), 1~3분(정보성)
- **섹션 3 - 첫 3초 훅 법칙:** 충격적 사실 / 질문형 / 결과 먼저 보여주기, 자막 필수
- **섹션 4 - 해시태그 전략:** 3~5개, 대형+중형+소형 조합, 트렌딩 태그는 Tavily로
- **섹션 5 - 게시 시간대:** 한국 기준 07-09시 / 12-13시 / 19-22시, Analytics 우선 참고
- **섹션 6 - 틱톡 광고 포맷:** In-Feed / TopView / Branded Hashtag Challenge / Spark Ads

**청킹:** 각 `##` 섹션 단위로 분리, metadata에 `source`, `section`, `chunk_index` 저장

---

## 2. System Prompt

```
당신은 한국 마케터를 위한 틱톡 트렌드 분석 챗봇 "TrendTok"입니다

## 역할
틱톡 마케팅 전략이랑 최신트렌드 파악 도와주는 전문 어시스턴트임
마케터들이 바로 써먹을수있게 구체적이고 실행가능한 조언 줘야함

## 말투 및 답변 방식
- 항상 한국어로 답변
- 온점(.) 절대 사용 금지 — 문장 끝은 줄바꿈으로 구분
- 틱톡 잼민이 DM 말투로 답변 (예: "ㄹㅇ 이거 존맛탱임", "솔직히 이렇게하면 터짐", "아 이건 진짜 꿀팁인데")
- 띄어쓰기는 30% 정도만 지킴 — 자연스러운 잼민이 DM처럼 붙여쓰는 경우가 더 많아야함
- ㅋㅋ 사용 금지
- ㅇㅇ는 진짜로 동의/확인하는 맥락일 때만 사용, 습관적 추임새로 쓰지 말 것
- 사용자 말투를 반영해서 답변 — 격식체면 살짝 격식있게, 캐주얼하면 더 풀어서, 짧게쓰면 짧게
- 비속어는 자연스럽게 써도됨, 욕설은 안됨
- 서론없이 핵심부터
- bullet point나 번호목록으로 구조화
- 마케터가 바로 실행할수있을만큼 구체적으로

## 컨텍스트 활용 지침

### [마케팅 지식 컨텍스트] 사용 방법
- 프롬프트에 삽입된 [마케팅 지식 컨텍스트]는 검증된 틱톡 마케팅 원칙임
- 알고리즘, 해시태그전략, 영상길이, 광고포맷 등 변하지않는 지식은 이 컨텍스트 우선참고
- 컨텍스트에 없는내용은 일반지식으로 보완하되 불확실하면 솔직하게 말해줘

### [실시간 트렌드 검색] 사용 방법
- "요즘", "최신", "지금", "이번주", "최근" 같은 시간적맥락 있는 질문엔
  반드시 search_tiktok_trends 호출해서 실시간정보 가져와
- 검색결과 있으면 출처 간략히 언급 ("최근트렌드 보니까~")
- 검색결과 없거나 불충분하면 마케팅지식으로 답하고
  "실시간정보 못가져왔는데~" 하고 알려줘

## 범위 제한
틱톡 마케팅이랑 무관한 질문엔 이렇게 답해:
"나 틱톡마케팅 전문챗봇인데 틱톡 콘텐츠전략이나 트렌드 광고쪽으로 물어봐줘"
```

---

## 3. Tool 정의

```typescript
{
  type: "function",
  function: {
    name: "search_tiktok_trends",
    description: `틱톡의 실시간 트렌드, 챌린지, 인기 해시태그, 유행 음악, 최신 마케팅 사례를 웹에서 검색합니다.

✅ 호출해야 할 때:
- "요즘", "최신", "지금", "이번주", "최근", "핫한" 등 시간적 맥락이 있는 질문
- 특정 업종의 최근 틱톡 사례
- 현재 유행 중인 챌린지, 밈, 음악

❌ 호출하지 말아야 할 때:
- 알고리즘 원리, 해시태그 전략, 영상 길이 등 변하지 않는 마케팅 원칙 질문`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Tavily에 보낼 검색 쿼리. 한국어 또는 영어 모두 가능. 예: '틱톡 챌린지 트렌드 2025 한국'"
        },
        search_depth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "basic: 일반 트렌드 질문 / advanced: 특정 업종·캠페인 사례 조사"
        }
      },
      required: ["query"]
    }
  }
}
```

---

## 4. Supabase 테이블 스키마

```sql
create extension if not exists vector;

create table documents (
  id        bigserial primary key,
  content   text          not null,
  embedding vector(1536)  not null,
  metadata  jsonb         default '{}'
);

create index on documents using hnsw (embedding vector_cosine_ops);

create or replace function match_documents (
  query_embedding vector(1536),
  match_count     int   default 3,
  match_threshold float default 0.7
)
returns table (content text, metadata jsonb, similarity float)
language sql stable as $$
  select
    content,
    metadata,
    1 - (embedding <=> query_embedding) as similarity
  from documents
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

**설계 포인트:**
- `match_threshold 0.7` — 무관한 chunk 프롬프트 삽입 방지
- `match_count 3` — 실습용 최소, 토큰 낭비 없음
- HNSW 인덱스 — 문서 수 적어도 걸어두는 것이 맞음

---

## 5. 예상 사용자 질문 10개

| # | 질문 | 처리 방식 |
|---|---|---|
| 1 | "틱톡 알고리즘이 어떻게 작동해?" | RAG |
| 2 | "영상 길이 몇 초가 제일 좋아?" | RAG |
| 3 | "첫 3초를 어떻게 구성해야 해?" | RAG |
| 4 | "해시태그 몇 개 달아야 해?" | RAG |
| 5 | "틱톡 광고 종류 뭐가 있어?" | RAG |
| 6 | "요즘 틱톡에서 유행하는 챌린지 뭐야?" | Tavily |
| 7 | "이번주 핫한 틱톡 해시태그 알려줘" | Tavily |
| 8 | "최근 뷰티 브랜드들 틱톡에서 어떤 콘텐츠 올려?" | Tavily |
| 9 | "요즘 틱톡에서 많이 쓰이는 BGM 뭐야?" | Tavily |
| 10 | "해시태그 전략 알려주고 요즘 뷰티쪽 핫한 태그도 알려줘" | RAG + Tavily |

---

## 6. 엣지 케이스

| 상황 | 처리 방향 |
|---|---|
| 틱톡 무관한 질문 | 시스템 프롬프트 범위 제한으로 GPT-4o가 자연스럽게 거절 |
| Tavily API 오류 / 결과 없음 | try-catch로 잡고 RAG 컨텍스트만으로 답변 + "실시간정보 못가져왔는데~" 삽입 |
| RAG 유사도 미달 (0.7 이하) | 빈 컨텍스트로 GPT-4o 호출, 프롬프트에 "관련 지식 없음" 명시 |
| 범위 애매한 질문 | GPT-4o가 틱톡 관련 부분만 답하거나 범위 벗어나면 거절 |
| Tavily가 무관한 결과 반환 | GPT-4o가 프롬프트 기반으로 무관한 내용 걸러냄 |
| 너무 짧은 입력 ("ㅇ", "?") | GPT-4o가 되물어봄 |

**핵심 원칙:** 코드레벨 처리는 Tavily 오류 하나면 충분, 나머지는 GPT-4o가 커버

---

## UI 스펙

- 배경: 블랙 (#000000 또는 zinc-950)
- 텍스트: 화이트
- 테마: 심플 흑백, 불필요한 색상 없음
- 응답 방식: 논-스트리밍 (완성 후 한 번에 출력)
