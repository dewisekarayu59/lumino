import { NextResponse } from 'next/server'

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant. Be concise and accurate. Use Markdown when helpful.'

interface ChatMessage {
  role: string
  content: string
}

interface ChatOptions {
  temperature?: number
  topP?: number
  maxTokens?: number
  systemPrompt?: string
}

function truncateMessages(messages: ChatMessage[], max: number = 30): ChatMessage[] {
  if (messages.length <= max) return messages
  return [messages[0], ...messages.slice(-(max - 1))]
}

function mapModel(model: string): string {
  const mapping: Record<string, string> = {
    'kc/openai/gpt-4.1': 'ag/gpt-oss-120b-medium',
    'kc/openai/o3': 'ag/claude-opus-4-6-thinking',
    'kc/deepseek/deepseek-chat': 'dewis',
    'kc/deepseek/deepseek-reasoner': 'ag/gemini-3-flash-agent',
    'kc/anthropic/claude-sonnet-4-20250514': 'ag/claude-sonnet-4-6',
    'cl/anthropic/claude-sonnet-4.6': 'ag/claude-sonnet-4-6',
    'kc/anthropic/claude-opus-4-20250514': 'ag/claude-opus-4-6-thinking',
    'kc/google/gemini-2.5-pro': 'ag/gemini-3.1-pro-low',
    'kc/google/gemini-2.5-flash': 'ag/gemini-3.5-flash-low',
    'llama-3.3-70b-versatile': 'dewis',
    'llama 3.3 70b versatile': 'dewis',
  }
  return mapping[model] || model
}

function parseMultimodalContent(content: string): any {
  if (typeof content !== 'string') return content

  // 1. Check if it's a JSON stringified attachment object
  if (content.startsWith('{') && content.endsWith('}')) {
    try {
      const parsed = JSON.parse(content)
      if (parsed.text !== undefined && Array.isArray(parsed.attachments)) {
        const parts: any[] = []
        
        // Add text prompt
        if (parsed.text) {
          parts.push({ type: 'text', text: parsed.text })
        }
        
        // Add attachments
        for (const att of parsed.attachments) {
          if (att.type.startsWith('image/') && att.content) {
            parts.push({
              type: 'image_url',
              image_url: { url: att.content }
            })
          } else if (att.content) {
            parts.push({
              type: 'text',
              text: `[Attached Document: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``
            })
          }
        }
        
        return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts
      }
    } catch (e) {
      // Fallback to text parsing if JSON parse fails
    }
  }

  // 2. Fallback to parsing markdown image base64 format (for backward compatibility)
  const regex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g
  const parts: any[] = []
  let lastIndex = 0
  let match

  while ((match = regex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index).trim()
    if (textBefore) {
      parts.push({ type: 'text', text: textBefore })
    }
    
    parts.push({
      type: 'image_url',
      image_url: { url: match[2] }
    })
    
    lastIndex = regex.lastIndex
  }

  const textAfter = content.substring(lastIndex).trim()
  if (textAfter) {
    parts.push({ type: 'text', text: textAfter })
  }

  if (parts.length === 0) return content
  if (parts.every(p => p.type === 'text')) return content
  return parts
}

async function searchWeb(query: string): Promise<string> {
  try {
    const apiRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    if (apiRes.ok) {
      const data = await apiRes.json()
      let results: string[] = []
      if (data.AbstractText) {
        results.push(data.AbstractText)
      }
      if (Array.isArray(data.RelatedTopics)) {
        data.RelatedTopics.slice(0, 3).forEach((topic: any) => {
          if (topic.Text) results.push(topic.Text)
        })
      }
      if (results.length > 0) {
        return results.map((r, i) => `[${i+1}] "${r}"`).join('\n')
      }
    }
  } catch (e) {
    console.error('DDG API failed', e)
  }

  try {
    const htmlRes = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
      }
    })
    if (htmlRes.ok) {
      const html = await htmlRes.text()
      const snippets: string[] = []
      const regex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
      let match
      while ((match = regex.exec(html)) !== null && snippets.length < 5) {
        const cleanText = match[1]
          .replace(/<[^>]*>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim()
        if (cleanText) snippets.push(cleanText)
      }
      if (snippets.length > 0) {
        return snippets.map((s, i) => `[${i+1}] "${s}"`).join('\n')
      }
    }
  } catch (e) {
    console.error('DDG HTML failed', e)
  }

  return ''
}

async function chatWith9Router(
  messages: ChatMessage[],
  model: string,
  options: ChatOptions,
  stream: boolean,
  locationContext: string,
  city: string | null
) {
  const baseURL = process.env.OPENAI_BASE_URL || 'http://' + '127.0.0.1' + ':20128/v1'
  const apiKey = process.env.OPENAI_API_KEY?.trim()

  const imageGenInstructions = "\n\nImage Generation Capabilities: You can generate images when asked. If the user asks you to generate, create, draw, or visualize an image, you must output a markdown image tag inline. Format: `![Description](https://image.pollinations.ai/prompt/encoded_prompt?width=1024&height=1024&nologo=true)`. Replace `encoded_prompt` with a detailed, creative English prompt describing the image (URL-encoded, e.g. space becomes %20). Do not write raw HTML, only use standard markdown image tag. You can write a short explanation of the image in Indonesian before or after the image tag, but keep the prompt inside the URL in English for better results."
  
  let searchContext = ''
  const latestMessage = messages[messages.length - 1]?.content || ''
  const triggerWords = [
    'cuaca', 'berita', 'hari ini', 'sekarang', 'skor', 'saham', 
    'search', 'weather', 'news', 'today', 'current', 'latest',
    'info terbaru', 'siapa', 'siapa yang', 'presiden', 'pemilu',
    'kurs', 'rupiah', 'dolar', 'harga emas', 'jadwal',
    'hujan', 'kapan', 'gempa', 'banjir', 'macet', 'jam berapa', 'dimana'
  ]
  const needsRealtime = typeof latestMessage === 'string' && 
    triggerWords.some(word => latestMessage.toLowerCase().includes(word))

  if (needsRealtime) {
    let query = latestMessage.replace(/!\[.*?\]\(.*?\)/g, '').trim()
    if (city && (query.toLowerCase().includes('disini') || query.toLowerCase().includes('di sini'))) {
      query += ` di ${city}`
    }
    const results = await searchWeb(query)
    if (results) {
      searchContext = `\n\nReal-time Web Search Results for "${query}":\n${results}\n\nUse the real-time search results above to answer the user's query accurately. Cite the source number [1], [2], etc. when referencing the information.`
    }
  }

  const sys = (options.systemPrompt || DEFAULT_SYSTEM_PROMPT) + imageGenInstructions + (locationContext ? `\n\n${locationContext}` : '') + searchContext
  const formattedMessages = [
    { role: 'system', content: sys },
    ...messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role,
      content: m.role === 'user' ? parseMultimodalContent(m.content) : m.content
    })),
  ]

  const is9Router = baseURL.includes('127.0.0.1') || baseURL.includes('serveo') || baseURL.includes('9router')
  const mappedModel = is9Router ? mapModel(model) : model

  // Cap max_tokens to prevent 400 bad request errors on models with lower completion limits
  let maxCompletionTokens = options.maxTokens || 4096
  if (mappedModel === 'dewis' || mappedModel.includes('llama')) {
    if (maxCompletionTokens > 4096) maxCompletionTokens = 4096
  } else if (maxCompletionTokens > 8192) {
    maxCompletionTokens = 8192
  }

  const payload = {
    model: mappedModel || 'dewis',
    messages: formattedMessages,
    temperature: options.temperature ?? 0.7,
    max_tokens: maxCompletionTokens,
    top_p: options.topP ?? 1,
    stream,
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`9Router Error (${response.status}): ${errBody}`)
  }

  if (stream) return { streamBody: response.body, model: model || 'dewis' }

  const rawData = await response.json()
  const data = rawData.data && Array.isArray(rawData.data.choices) ? rawData.data : rawData
  const choice = data.choices[0]
  const usage = data.usage

  return {
    message: choice.message.content || '',
    usage: {
      inputTokens: usage?.prompt_tokens || 0,
      outputTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    },
    provider: '9router',
    model: model || 'dewis',
    finishReason: choice.finish_reason || 'stop',
  }
}

function extractContent(parsed: any): string | null {
  if (!parsed) return null
  if (parsed.choices?.[0]?.delta?.content !== undefined) {
    return parsed.choices[0].delta.content
  }
  if (parsed.data?.choices?.[0]?.delta?.content !== undefined) {
    return parsed.data.choices[0].delta.content
  }
  if (parsed.choices?.[0]?.text !== undefined) {
    return parsed.choices[0].text
  }
  return null
}

async function* makeTransformedStream(rawStream: ReadableStream) {
  const reader = rawStream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6).trim()
          if (dataStr === '[DONE]') {
            yield `data: [DONE]\n\n`
            break
          }

          try {
            const parsed = JSON.parse(dataStr)
            if (parsed.error) {
              yield `data: ${JSON.stringify({ type: 'error', message: parsed.error.message || 'API Error' })}\n\n`
              continue
            }
            const content = extractContent(parsed)
            if (content) {
              yield `data: ${JSON.stringify({ type: 'text', content })}\n\n`
            }
          } catch (e) {
            // Ignore parse errors for incomplete JSON lines
          }
        }
      }
    }
  } catch (error: any) {
    yield `data: ${JSON.stringify({ type: 'error', message: error?.message || 'Stream error' })}\n\n`
  } finally {
    reader.releaseLock()
  }
}

export async function POST(request: Request) {
  try {
    const { model, messages, stream, options } = await request.json()

    const city = request.headers.get('x-vercel-ip-city')
    const region = request.headers.get('x-vercel-ip-country-region')
    const locationContext = city ? `User Location Context: The user is currently located in ${city}, ${region || ''}. Use this to answer queries about "here" (disini).` : ''

    const finalSystemPrompt = options?.systemPrompt || DEFAULT_SYSTEM_PROMPT
    const truncatedMessages = truncateMessages(messages)

    const result = await chatWith9Router(
      truncatedMessages,
      model,
      { ...(options || {}), systemPrompt: finalSystemPrompt },
      stream,
      locationContext,
      city
    )

    if (stream && result.streamBody) {
      const encoder = new TextEncoder()
      const customStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of makeTransformedStream(result.streamBody!)) {
              controller.enqueue(encoder.encode(chunk))
            }
          } catch (e: any) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: e?.message || 'Stream failed' })}\n\n`))
          } finally {
            controller.close()
          }
        }
      })

      return new Response(customStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    return NextResponse.json(result)
  } catch (error: any) {
    const msg = error?.message || String(error) || ''

    if (error?.type === 'missing_api_key') {
      return NextResponse.json({ type: 'missing_api_key', message: error.message }, { status: 428 })
    }
    if (msg.includes('402') || msg.toLowerCase().includes('insufficient')) {
      return NextResponse.json({ type: 'no_credits', message: 'Saldo atau kuota pada provider habis.' }, { status: 402 })
    }
    if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
      return NextResponse.json({ type: 'rate_limited', message: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429 })
    }
    if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
      return NextResponse.json({ type: 'invalid_key', message: 'API Key tidak valid.' }, { status: 401 })
    }

    console.error('Chat error:', error)
    return NextResponse.json({ message: `Error: ${msg.slice(0, 200)}` }, { status: 500 })
  }
}