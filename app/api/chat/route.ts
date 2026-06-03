import OpenAI from 'openai'
import { searchDocuments } from '@/lib/rag'
import { trendSearchTool, executeTool } from '@/lib/tools'
import { buildSystemPrompt } from '@/lib/prompt'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(request: Request) {
  const { message } = (await request.json()) as { message: string }

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
    tool_choice: { type: 'function', function: { name: 'search_tiktok_trends' } },
  })

  const firstChoice = firstResponse.choices[0].message

  // 4. Tool 호출이 없으면 바로 반환
  if (!firstChoice.tool_calls || firstChoice.tool_calls.length === 0) {
    return Response.json({ reply: firstChoice.content })
  }

  // 5. Tool 실행
  const toolCall = firstChoice.tool_calls[0]
  if (toolCall.type !== 'function') {
    return Response.json({ reply: firstChoice.content })
  }
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
