import type OpenAI from 'openai'

export const trendSearchTool: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_tiktok_trends',
    description: `틱톡에서 유행 중인 웃긴 영상, 밈, 챌린지, 킹받는 트렌드, 10~20대 바이럴 콘텐츠를 웹에서 검색합니다.

✅ 호출해야 할 때:
- 요즘 유행하는 틱톡 트렌드, 챌린지, 밈 질문
- 웃긴 틱톡, 킹받는 영상, 공감 가는 콘텐츠 관련 질문
- 10~20대가 열광하는 바이럴 영상 관련 질문
- "요즘", "최신", "지금", "이번주", "최근", "핫한" 등 시간적 맥락이 있는 질문

❌ 호출하지 말아야 할 때:
- 알고리즘 원리, 해시태그 전략 등 변하지 않는 마케팅 원칙 질문`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "검색 쿼리. 연도 없이 입력하면 자동으로 2026이 붙음. 예: 'tiktok funny trends korea', '틱톡 챌린지 유행'",
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

export async function executeTool(
  name: string,
  args: { query: string; search_depth?: 'basic' | 'advanced'; days?: number }
): Promise<string> {
  if (name !== 'search_tiktok_trends') return '알 수 없는 tool입니다'

  const year = new Date().getFullYear()
  const query = args.query.includes(String(year))
    ? args.query
    : `${args.query} ${year}`

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: args.search_depth ?? 'basic',
        max_results: 5,
        include_answer: true,
        days: args.days ?? 7,
      }),
    })

    if (!res.ok) throw new Error(`Tavily ${res.status}`)

    const data = await res.json()
    const results = (data.results ?? []) as Array<{
      title: string
      content: string
      url: string
    }>

    if (results.length === 0) return '검색 결과 없음'

    return results
      .map((r) => `[${r.title}]\n${r.content}\n출처: ${r.url}`)
      .join('\n\n')
  } catch (e) {
    return `실시간 정보를 가져오지 못했습니다: ${(e as Error).message}`
  }
}
