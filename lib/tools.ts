import type OpenAI from 'openai'

export const trendSearchTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_tiktok_trends',
    description: `틱톡/더우인에서 유행 중인 밈, 챌린지, 사운드, 바이럴 콘텐츠를 검색합니다.

✅ 호출해야 할 때:
- 요즘 유행하는 틱톡 트렌드, 챌린지, 밈 질문
- 웃긴 틱톡, 킹받는 영상, 바이럴 콘텐츠 관련 질문
- 모르는 밈, 유행어, 챌린지 이름이 나왔을 때
- "요즘", "최신", "지금", "이번주", "최근", "핫한" 등 시간적 맥락이 있는 질문

쿼리 작성 규칙:
- 밈/챌린지: "tiktok viral challenge june 2026", "tiktok meme trend this week"
- 사운드: "tiktok trending sounds 2026", "tiktok viral audio this week"
- 한국 트렌드: "틱톡 챌린지 유행 2026", "한국 틱톡 밈 이번주"
- Douyin은 executeTool 내부에서 자동으로 병렬 검색함

❌ 호출하지 말아야 할 때:
- 알고리즘 원리, 해시태그 전략 등 변하지 않는 마케팅 원칙 질문`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "TikTok 검색 쿼리. 예: 'tiktok viral challenge june 2026', 'tiktok trending sounds this week'",
        },
        search_depth: {
          type: 'string',
          enum: ['basic', 'advanced'],
          description: 'basic: 일반 트렌드 / advanced: 특정 업종 사례 조사',
        },
        days: {
          type: 'number',
          description: '검색 범위 일수. 7: 최근 1주일 / 30: 최근 1달. 기본값 7',
        },
      },
      required: ['query'],
    },
  },
}

async function tavilySearch(
  query: string,
  depth: 'basic' | 'advanced',
  days: number
): Promise<Array<{ title: string; content: string; url: string }>> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: depth,
      max_results: 5,
      include_answer: true,
      days,
    }),
  })
  if (!res.ok) throw new Error(`Tavily ${res.status}`)
  const data = await res.json()
  return (data.results ?? []) as Array<{ title: string; content: string; url: string }>
}

function toDouyinQuery(query: string): string {
  return query
    .replace(/tiktok/gi, 'douyin')
    .replace(/틱톡/g, '더우인')
    + ' douyin viral 2026'
}

export async function executeTool(
  name: string,
  args: { query: string; search_depth?: 'basic' | 'advanced'; days?: number }
): Promise<string> {
  if (name !== 'search_tiktok_trends') return '알 수 없는 tool입니다'

  const now = new Date()
  const year = now.getFullYear()
  const month = now.toLocaleString('en-US', { month: 'long' }).toLowerCase()
  const dateSuffix = `${year} ${month} week`
  const tiktokQuery = args.query.includes(String(year))
    ? args.query
    : `${args.query} ${dateSuffix}`
  const douyinQuery = toDouyinQuery(tiktokQuery)
  const depth = args.search_depth ?? 'basic'
  const days = args.days ?? 30

  try {
    // 30일 이내 먼저 검색, 결과 없으면 전체 검색으로 fallback
    let [tiktokResults, douyinResults] = await Promise.all([
      tavilySearch(tiktokQuery, depth, 30),
      tavilySearch(douyinQuery, depth, 30),
    ])

    if (tiktokResults.length === 0 && douyinResults.length === 0) {
      ;[tiktokResults, douyinResults] = await Promise.all([
        tavilySearch(tiktokQuery, depth, days),
        tavilySearch(douyinQuery, depth, days),
      ])
    }

    const allResults = [...tiktokResults, ...douyinResults]
    if (allResults.length === 0) return '검색 결과 없음'

    const tiktokSection = tiktokResults.length > 0
      ? `[TikTok 트렌드]\n` + tiktokResults.map((r) => `- ${r.title}\n${r.content}\n출처: ${r.url}`).join('\n\n')
      : ''

    const douyinSection = douyinResults.length > 0
      ? `[Douyin(중국 틱톡) 트렌드]\n` + douyinResults.map((r) => `- ${r.title}\n${r.content}\n출처: ${r.url}`).join('\n\n')
      : ''

    return [tiktokSection, douyinSection].filter(Boolean).join('\n\n---\n\n')
  } catch (e) {
    return `실시간 정보를 가져오지 못했습니다: ${(e as Error).message}`
  }
}
