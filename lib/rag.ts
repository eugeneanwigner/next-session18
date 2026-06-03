import OpenAI from 'openai'
import { supabase } from './supabase'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export type Chunk = {
  content: string
}

export function chunkBySection(markdown: string): Chunk[] {
  const parts = markdown.split(/^## /m).filter(Boolean)
  return parts
    .filter((part) => !part.startsWith('# '))
    .map((part) => ({
      content: '## ' + part.trim(),
    }))
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
  })
  if (error) throw error
  return (data ?? []) as Chunk[]
}
