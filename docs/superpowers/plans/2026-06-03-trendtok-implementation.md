# TrendTok Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국 마케터용 틱톡 트렌드 챗봇 — RAG(Supabase pgvector) + Tool Calling(Tavily) + GPT-4o, Next.js App Router로 구현, Vercel 배포

**Architecture:** 모든 질문에 RAG 검색을 먼저 실행해 마케팅 지식 컨텍스트를 주입하고, GPT-4o가 실시간 정보 필요 시 Tavily tool을 스스로 호출. 논-스트리밍, POST /api/chat 단일 엔드포인트.

**Tech Stack:** Next.js 16 (App Router, TypeScript, Tailwind v4), OpenAI GPT-4o + text-embedding-3-small, Supabase pgvector, Tavily API

---

## File Map

| 파일 | 역할 |
|---|---|
| `.env.local` | API 키 모음 |
| `lib/supabase.ts` | Supabase 클라이언트 싱글턴 |
| `lib/rag.ts` | embedQuery + searchDocuments |
| `lib/tools.ts` | Tavily tool 정의 + executeTool |
| `lib/prompt.ts` | buildSystemPrompt (순수 함수) |
| `documents/tiktok-knowledge.md` | RAG 지식 문서 (6개 섹션) |
| `scripts/seed.ts` | 지식 문서 청킹 → 임베딩 → Supabase 저장 (1회 실행) |
| `app/api/chat/route.ts` | 챗 API (RAG + GPT-4o + Tool Calling) |
| `app/page.tsx` | 채팅 UI (블랙 배경, 흑백) |
| `app/globals.css` | 블랙 테마 CSS 변수 |
| `__tests__/rag.test.ts` | chunkBySection 순수 함수 테스트 |
| `__tests__/prompt.test.ts` | buildSystemPrompt 순수 함수 테스트 |

---

## Task 1: 환경 변수 + 테스트 도구 세팅

**Files:**
- Modify: `.env.local`
- Create: `jest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: .env.local 작성**

```
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

> `NEXT_PUBLIC_SUPABASE_URL`은 브라우저에서도 접근 가능해야 하므로 `NEXT_PUBLIC_` 접두사 사용.
> `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용 (RLS 우회 필요).

- [ ] **Step 2: Jest + tsx 설치**

```bash
npm install -D jest ts-jest @types/jest tsx
```

- [ ] **Step 3: jest.config.ts 생성**

```ts
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
}

export default config
```

- [ ] **Step 4: package.json scripts에 test + seed 추가**

기존 `"scripts"` 블록에 아래 두 줄 추가:
```json
"test": "jest",
"seed": "tsx scripts/seed.ts"
```

- [ ] **Step 5: 커밋**

```bash
git init
git add .env.local jest.config.ts package.json package-lock.json
git commit -m "chore: env setup and test tooling"
```

---

## Task 2: Supabase 테이블 + 함수 생성

**Files:**
- Create: `supabase/schema.sql` (참고용)

- [ ] **Step 1: Supabase 대시보드 → SQL Editor에서 실행**

```sql
create extension if not exists vector;

create table if not exists documents (
  id        bigserial primary key,
  content   text          not null,
  embedding vector(1536)  not null,
  metadata  jsonb         default '{}'
);

create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

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

- [ ] **Step 2: schema.sql로 저장 (참고용)**

```bash
mkdir -p supabase
```

`supabase/schema.sql`에 위 SQL 그대로 저장.

- [ ] **Step 3: 커밋**

```bash
git add supabase/schema.sql
git commit -m "chore: supabase schema for pgvector"
```

---

## Task 3: lib/supabase.ts

**Files:**
- Create: `lib/supabase.ts`

- [ ] **Step 1: lib/supabase.ts 작성**

```ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)
```

- [ ] **Step 2: 커밋**

```bash
git add lib/supabase.ts
git commit -m "feat: supabase client"
```

---

## Task 4: lib/rag.ts

**Files:**
- Create: `lib/rag.ts`
- Create: `__tests__/rag.test.ts`

- [ ] **Step 1: chunkBySection 테스트 먼저 작성**

`__tests__/rag.test.ts`:
```ts
import { chunkBySection } from '@/lib/rag'

const SAMPLE_MD = `# 제목

## 알고리즘
FYP는 팔로워 수보다 콘텐츠 품질 우선

## 해시태그
3~5개 권장
`

describe('chunkBySection', () => {
  it('## 기준으로 섹션을 분리한다', () => {
    const chunks = chunkBySection(SAMPLE_MD)
    expect(chunks).toHaveLength(2)
  })

  it('각 chunk에 content와 metadata가 있다', () => {
    const chunks = chunkBySection(SAMPLE_MD)
    expect(chunks[0].content).toContain('알고리즘')
    expect(chunks[0].metadata.section).toBe('알고리즘')
    expect(chunks[0].metadata.chunk_index).toBe(0)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm test -- --testPathPattern=rag
```

Expected: FAIL — "Cannot find module '@/lib/rag'"

- [ ] **Step 3: lib/rag.ts 구현**

```ts
import OpenAI from 'openai'
import { supabase } from './supabase'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type Chunk = {
  content: string
  metadata: { source: string; section: string; chunk_index: number }
}

export function chunkBySection(markdown: string): Chunk[] {
  const parts = markdown.split(/^## /m).filter(Boolean)
  return parts
    .filter(part => !part.startsWith('# '))
    .map((part, i) => {
      const lines = part.split('\n')
      const section = lines[0].trim()
      return {
        content: '## ' + part.trim(),
        metadata: { source: 'tiktok-knowledge.md', section, chunk_index: i },
      }
    })
}

export async function embedQuery(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return res.data[0].embedding
}

export async function searchDocuments(query: string): Promise<Chunk[]> {
  const embedding = await embedQuery(query)
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_count: 3,
    match_threshold: 0.7,
  })
  if (error) throw error
  return (data ?? []) as Chunk[]
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- --testPathPattern=rag
```

Expected: PASS — 2 tests

- [ ] **Step 5: 커밋**

```bash
git add lib/rag.ts __tests__/rag.test.ts
git commit -m "feat: rag chunk + embed + search"
```

---

## Task 5: documents/tiktok-knowledge.md

**Files:**
- Create: `documents/tiktok-knowledge.md`

- [ ] **Step 1: 지식 문서 작성**

`documents/tiktok-knowledge.md`:
```markdown
# TrendTok 마케팅 지식 베이스

## 틱톡 알고리즘
FYP(For You Page)는 팔로워 수보다 콘텐츠 품질을 우선한다
핵심 신호: 시청 완료율, 재시청, 좋아요/댓글/공유, 북마크
업로드 직후 1~2시간의 초기 반응이 확산 여부를 결정한다
계정 인지도보다 영상 단위로 독립적으로 평가된다

## 최적 영상 길이
7~15초: 짧은 훅, 높은 완료율 → FYP 확산에 유리
21~34초: 가장 많이 추천되는 골든 존
1~3분: 정보성 콘텐츠, 튜토리얼에 적합 (완료율 낮으면 불리)
원칙: 하고 싶은 말을 가장 짧게 담는 것이 최선

## 첫 3초 훅
3초 안에 시청자가 스크롤을 멈출 이유를 줘야 한다
효과적인 훅 패턴:
- 충격적 사실: "브랜드 마케터 90%가 이 실수를 해요"
- 질문형: "당신의 틱톡 광고가 안 되는 진짜 이유는?"
- 결과 먼저 보여주기: 완성품/결과를 첫 장면에 배치
자막 필수: 무음 시청 비율이 높다

## 해시태그 전략
권장 개수: 3~5개 (많다고 좋지 않음)
조합 원칙: 대형(조회 수 1억+) 1개 + 중형(1천만~1억) 2개 + 소형/니치(1백만 이하) 1~2개
브랜드 전용 해시태그 챌린지는 별도 전략 필요
트렌딩 해시태그는 실시간 검색으로 확인 필요

## 게시 시간대
한국 기준 권장: 오전 7~9시, 점심 12~13시, 저녁 19~22시
본인 계정의 Analytics > 팔로워 활동 시간을 최우선 참고
주말 오후 반응이 좋은 경향 (업종에 따라 다름)

## 틱톡 광고 포맷
In-Feed Ad: FYP 피드에 자연스럽게 삽입, 일반 영상과 유사한 형식
TopView: 앱 실행 시 첫 화면 전체 차지, 높은 노출이지만 고비용
Branded Hashtag Challenge: 브랜드가 챌린지 제안 → UGC 유도, 바이럴 효과 큼
Spark Ads: 기존 유기적 게시물을 광고로 전환, 크리에이터 콜라보에 활용
```

- [ ] **Step 2: 커밋**

```bash
git add documents/tiktok-knowledge.md
git commit -m "docs: tiktok marketing knowledge base"
```

---

## Task 6: scripts/seed.ts

**Files:**
- Create: `scripts/seed.ts`

- [ ] **Step 1: scripts/seed.ts 작성**

```ts
import 'dotenv/config'  // 반드시 첫 번째 — env 로딩 후 supabase 클라이언트 생성됨
import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import { chunkBySection } from '../lib/rag'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function seed() {
  const filePath = path.join(process.cwd(), 'documents', 'tiktok-knowledge.md')
  const markdown = fs.readFileSync(filePath, 'utf-8')
  const chunks = chunkBySection(markdown)

  console.log(`청킹 완료: ${chunks.length}개 섹션`)

  for (const chunk of chunks) {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: chunk.content,
    })
    const embedding = res.data[0].embedding

    const { error } = await supabase.from('documents').insert({
      content: chunk.content,
      embedding,
      metadata: chunk.metadata,
    })

    if (error) {
      console.error(`실패: ${chunk.metadata.section}`, error.message)
    } else {
      console.log(`저장 완료: ${chunk.metadata.section}`)
    }
  }

  console.log('시딩 완료')
}

seed().catch(console.error)
```

- [ ] **Step 2: dotenv 설치 (tsx가 .env.local을 자동 로드하지 않으므로)**

```bash
npm install dotenv
```

> `tsx`로 실행 시 `.env.local`이 자동 로드되지 않는다. `dotenv/config`를 import해서 `.env` 파일을 읽어야 한다.
> `.env.local` → `.env`로 복사하거나, seed 실행 전 `cp .env.local .env` 한 번 실행.

- [ ] **Step 3: 커밋**

```bash
git add scripts/seed.ts
git commit -m "feat: seed script for rag embeddings"
```

---

## Task 7: lib/tools.ts

**Files:**
- Create: `lib/tools.ts`

- [ ] **Step 1: lib/tools.ts 작성**

```ts
import type OpenAI from 'openai'

export const trendSearchTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_tiktok_trends',
    description: `틱톡의 실시간 트렌드, 챌린지, 인기 해시태그, 유행 음악, 최신 마케팅 사례를 웹에서 검색합니다.

✅ 호출해야 할 때:
- "요즘", "최신", "지금", "이번주", "최근", "핫한" 등 시간적 맥락이 있는 질문
- 특정 업종의 최근 틱톡 사례
- 현재 유행 중인 챌린지, 밈, 음악

❌ 호출하지 말아야 할 때:
- 알고리즘 원리, 해시태그 전략, 영상 길이 등 변하지 않는 마케팅 원칙 질문`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "검색 쿼리. 예: '틱톡 챌린지 트렌드 2025 한국'",
        },
        search_depth: {
          type: 'string',
          enum: ['basic', 'advanced'],
          description: 'basic: 일반 트렌드 / advanced: 특정 업종 사례 조사',
        },
      },
      required: ['query'],
    },
  },
}

export async function executeTool(
  name: string,
  args: { query: string; search_depth?: 'basic' | 'advanced' }
): Promise<string> {
  if (name !== 'search_tiktok_trends') {
    return '알 수 없는 tool입니다'
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: args.query,
        search_depth: args.search_depth ?? 'basic',
        max_results: 5,
        include_answer: true,
      }),
    })

    if (!res.ok) throw new Error(`Tavily ${res.status}`)

    const data = await res.json()
    const results = (data.results ?? []) as Array<{ title: string; content: string; url: string }>

    if (results.length === 0) return '검색 결과 없음'

    return results
      .map((r) => `[${r.title}]\n${r.content}\n출처: ${r.url}`)
      .join('\n\n')
  } catch (e) {
    return `실시간 정보를 가져오지 못했습니다: ${(e as Error).message}`
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add lib/tools.ts
git commit -m "feat: tavily tool definition and executor"
```

---

## Task 8: lib/prompt.ts

**Files:**
- Create: `lib/prompt.ts`
- Create: `__tests__/prompt.test.ts`

- [ ] **Step 1: 테스트 먼저 작성**

`__tests__/prompt.test.ts`:
```ts
import { buildSystemPrompt } from '@/lib/prompt'

describe('buildSystemPrompt', () => {
  it('RAG 컨텍스트가 없으면 기본 프롬프트만 반환', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('TrendTok')
    expect(prompt).not.toContain('[마케팅 지식 컨텍스트]')
  })

  it('RAG 컨텍스트가 있으면 프롬프트에 삽입', () => {
    const prompt = buildSystemPrompt([{ content: '테스트 지식', metadata: { section: '알고리즘', source: 'tiktok-knowledge.md', chunk_index: 0 } }])
    expect(prompt).toContain('[마케팅 지식 컨텍스트]')
    expect(prompt).toContain('테스트 지식')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm test -- --testPathPattern=prompt
```

Expected: FAIL — "Cannot find module '@/lib/prompt'"

- [ ] **Step 3: lib/prompt.ts 구현**

```ts
import type { Chunk } from './rag'

const BASE_PROMPT = `당신은 한국 마케터를 위한 틱톡 트렌드 분석 챗봇 "TrendTok"입니다

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
[마케팅 지식 컨텍스트]에 있는 내용은 검증된 틱톡 마케팅 원칙임 — 우선 참고
"요즘", "최신", "지금", "이번주", "최근" 같은 시간적맥락 있는 질문엔 반드시 search_tiktok_trends 호출
검색결과 없거나 불충분하면 "실시간정보 못가져왔는데~" 하고 알려줘

## 범위 제한
틱톡 마케팅이랑 무관한 질문엔: "나 틱톡마케팅 전문챗봇인데 틱톡 콘텐츠전략이나 트렌드 광고쪽으로 물어봐줘"`

export function buildSystemPrompt(ragChunks: Chunk[]): string {
  if (ragChunks.length === 0) return BASE_PROMPT

  const context = ragChunks.map((c) => c.content).join('\n\n')
  return `${BASE_PROMPT}

---

[마케팅 지식 컨텍스트]
${context}`
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test -- --testPathPattern=prompt
```

Expected: PASS — 2 tests

- [ ] **Step 5: 커밋**

```bash
git add lib/prompt.ts __tests__/prompt.test.ts
git commit -m "feat: system prompt builder"
```

---

## Task 9: app/api/chat/route.ts

**Files:**
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: app/api/chat/route.ts 작성**

```ts
import OpenAI from 'openai'
import { searchDocuments } from '@/lib/rag'
import { trendSearchTool, executeTool } from '@/lib/tools'
import { buildSystemPrompt } from '@/lib/prompt'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  const { message } = await request.json() as { message: string }

  // 1. RAG 검색
  const ragChunks = await searchDocuments(message).catch(() => [])

  // 2. 시스템 프롬프트 구성
  const systemPrompt = buildSystemPrompt(ragChunks)

  // 3. GPT-4o 첫 번째 호출 (tool 포함)
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ]

  const firstResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    tools: [trendSearchTool],
    tool_choice: 'auto',
  })

  const firstChoice = firstResponse.choices[0].message

  // 4. Tool 호출이 없으면 바로 반환
  if (!firstChoice.tool_calls || firstChoice.tool_calls.length === 0) {
    return Response.json({ reply: firstChoice.content })
  }

  // 5. Tool 실행
  const toolCall = firstChoice.tool_calls[0]
  const toolArgs = JSON.parse(toolCall.function.arguments) as {
    query: string
    search_depth?: 'basic' | 'advanced'
  }
  const toolResult = await executeTool(toolCall.function.name, toolArgs)

  // 6. Tool 결과 포함해서 두 번째 호출
  const secondResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      ...messages,
      firstChoice,
      {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      },
    ],
  })

  return Response.json({ reply: secondResponse.choices[0].message.content })
}
```

- [ ] **Step 2: 로컬에서 수동 테스트**

```bash
npm run dev
```

별도 터미널에서:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "틱톡 알고리즘 어떻게 작동해?"}'
```

Expected: `{"reply": "...RAG 기반 답변..."}` (tool 호출 없음)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "요즘 틱톡 유행하는 챌린지 뭐야?"}'
```

Expected: `{"reply": "...Tavily 검색 결과 포함 답변..."}` (tool 호출 있음)

- [ ] **Step 3: 커밋**

```bash
git add app/api/chat/route.ts
git commit -m "feat: chat api with rag and tool calling"
```

---

## Task 10: 채팅 UI (app/page.tsx + globals.css)

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

- [ ] **Step 1: globals.css 블랙 테마로 수정**

```css
@import "tailwindcss";

:root {
  --background: #000000;
  --foreground: #ffffff;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

- [ ] **Step 2: layout.tsx 메타데이터 수정**

`export const metadata` 부분만 변경:
```ts
export const metadata: Metadata = {
  title: 'TrendTok',
  description: '마케터를 위한 틱톡 트렌드 챗봇',
}
```

- [ ] **Step 3: app/page.tsx 채팅 UI 작성**

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'

type Message = { role: 'user' | 'assistant'; content: string }

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json() as { reply: string }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply ?? '오류가 발생했어요' }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '서버 오류가 발생했어요' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      {/* 헤더 */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">TrendTok</h1>
        <p className="text-xs text-zinc-500">틱톡 트렌드 마케팅 어시스턴트</p>
      </header>

      {/* 메시지 목록 */}
      <main className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-zinc-600 text-sm text-center mt-20">
            틱톡 마케팅에 대해 물어봐요
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-white text-black'
                  : 'bg-zinc-900 text-white border border-zinc-800'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-zinc-500">
              ...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* 입력창 */}
      <footer className="border-t border-zinc-800 px-6 py-4">
        <div className="flex gap-3 items-end">
          <textarea
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600"
            placeholder="틱톡 마케팅 질문을 입력하세요"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-white text-black rounded-xl px-5 py-3 text-sm font-medium disabled:opacity-30 hover:bg-zinc-200 transition-colors"
          >
            전송
          </button>
        </div>
      </footer>
    </div>
  )
}
```

- [ ] **Step 4: 브라우저에서 확인**

```bash
npm run dev
```

`http://localhost:3000` 접속 후:
- 블랙 배경, 흰 텍스트 확인
- "틱톡 알고리즘 어떻게 작동해?" 입력 → RAG 기반 답변 확인
- "요즘 핫한 챌린지 뭐야?" 입력 → Tavily 검색 결과 포함 답변 확인

- [ ] **Step 5: 커밋**

```bash
git add app/page.tsx app/globals.css app/layout.tsx
git commit -m "feat: chat ui with black theme"
```

---

## Task 11: Vercel 배포

- [ ] **Step 1: Vercel CLI 설치 + 로그인**

```bash
npm install -g vercel
vercel login
```

- [ ] **Step 2: 환경 변수 등록**

```bash
vercel env add OPENAI_API_KEY
vercel env add TAVILY_API_KEY
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
```

각 명령 실행 후 값 입력, 환경 선택 시 `Production, Preview, Development` 모두 선택.

- [ ] **Step 3: 배포**

```bash
vercel --prod
```

- [ ] **Step 4: 배포된 URL에서 동작 확인**

Vercel이 출력한 URL 접속 → 질문 2개 테스트 (RAG 전용 / Tavily 호출)

---

## 실행 순서 요약

```
1. Supabase SQL 실행 (Task 2)
2. npm run dev 실행
3. cp .env.local .env && npm run seed  ← 임베딩 1회 실행
4. 개발 완료 후 vercel --prod
```
