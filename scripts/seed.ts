import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

function chunkBySection(markdown: string): string[] {
  return markdown
    .split(/^## /m)
    .filter(Boolean)
    .filter((p) => !p.startsWith('# '))
    .map((p) => '## ' + p.trim())
}

async function seed() {
  const filePath = path.join(process.cwd(), 'documents', 'tiktok-knowledge.md')
  const markdown = fs.readFileSync(filePath, 'utf-8')
  const chunks = chunkBySection(markdown)

  console.log(`청킹 완료: ${chunks.length}개 섹션`)

  for (const chunk of chunks) {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: chunk,
    })
    const embedding = res.data[0].embedding

    const { error } = await supabase.from('documents').insert({
      content: chunk,
      embedding,
    })

    if (error) {
      console.error(`실패:`, error.message)
    } else {
      console.log(`저장 완료: ${chunk.split('\n')[0]}`)
    }
  }

  console.log('시딩 완료')
}

seed().catch(console.error)
