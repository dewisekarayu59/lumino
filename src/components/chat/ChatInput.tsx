'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useChatStore, useSettingsStore } from '@/lib/store'
import { useTranslation } from '@/lib/store/language'
import { cn } from '@/lib/utils'
import { Send, Paperclip, Square, Image, FileText, X, Mic } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { notifyError } from '@/components/notification/Toast'

export function ChatInput({ sessionId, autoFocus }: { sessionId: string; autoFocus?: boolean }) {
  const [input, setInput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const handleSendRef = useRef<() => void>(() => {})
  const retryTextRef = useRef<string>('')
  const { addMessage, updateLastAssistant, sessions } = useChatStore()
  const settings = useSettingsStore()
  const { t } = useTranslation()
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        const rec = new SpeechRecognition()
        rec.continuous = true
        rec.interimResults = false
        
        rec.onresult = (event: any) => {
          let finalTranscript = ''
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript
            }
          }
          if (finalTranscript) {
            setInput(prev => prev + (prev ? ' ' : '') + finalTranscript)
          }
        }
        
        rec.onerror = (event: any) => {
          console.error('Speech recognition error', event)
          setIsListening(false)
        }
        
        rec.onend = () => {
          setIsListening(false)
        }
        
        recognitionRef.current = rec
      }
    }
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  const toggleListening = () => {
    if (!recognitionRef.current) {
      notifyError('Fitur Voice Input (Speech-to-Text) tidak didukung oleh browser Anda.')
      return
    }
    
    if (isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    } else {
      const currentLanguage = localStorage.getItem('language') || 'en'
      recognitionRef.current.lang = currentLanguage === 'id' ? 'id-ID' : 'en-US'
      
      try {
        recognitionRef.current.start()
        setIsListening(true)
      } catch (err) {
        console.error('Failed to start recognition', err)
      }
    }
  }

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
    const pending = sessionStorage.getItem('pending-message')
    if (pending) {
      sessionStorage.removeItem('pending-message')
      handleSend(pending)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, autoFocus])

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail?.text
      if (text) {
        setInput(text)
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('chat-suggestion', handler)
    return () => window.removeEventListener('chat-suggestion', handler)
  }, [])

  handleSendRef.current = () => {
    const text = retryTextRef.current
    if (text) {
      retryTextRef.current = ''
      handleSend(text)
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail?.text
      if (text && !isGenerating) {
        retryTextRef.current = text
        setTimeout(() => handleSendRef.current(), 10)
      }
    }
    window.addEventListener('chat-retry', handler)
    return () => window.removeEventListener('chat-retry', handler)
  }, [isGenerating])

  const onDrop = useCallback((files: File[]) => {
    setAttachments(prev => [...prev, ...files])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'], 'application/pdf': ['.pdf'], 'text/plain': ['.txt'], 'text/markdown': ['.md'] }
  })

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  const handleSend = async (overrideText?: string) => {
    const textToUse = overrideText || input
    if (!textToUse.trim() && attachments.length === 0) return
    const session = useChatStore.getState().sessions.find(s => s.id === sessionId)
    if (!session) return

    setIsGenerating(true)

    // Helper functions to read files
    const readFileAsText = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsText(file)
      })
    }

    const readFileAsDataURL = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
    }

    const compressImageAsDataURL = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = (event) => {
          const img = new Image()
          img.src = event.target?.result as string
          img.onload = () => {
            const canvas = document.createElement('canvas')
            const MAX_WIDTH = 1200
            const MAX_HEIGHT = 1200
            let width = img.width
            let height = img.height

            if (width > height) {
              if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width
                width = MAX_WIDTH
              }
            } else {
              if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height
                height = MAX_HEIGHT
              }
            }
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            ctx?.drawImage(img, 0, 0, width, height)
            resolve(canvas.toDataURL('image/jpeg', 0.6)) // 60% quality JPEG
          }
          img.onerror = (e) => reject(e)
        }
        reader.onerror = (e) => reject(e)
      })
    }

    const loadPdfJS = (): Promise<any> => {
      return new Promise((resolve, reject) => {
        if ((window as any)['pdfjs-dist/build/pdf']) {
          resolve((window as any)['pdfjs-dist/build/pdf'])
          return
        }
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js'
        script.onload = () => {
          const pdfjs = (window as any)['pdfjs-dist/build/pdf']
          pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js'
          resolve(pdfjs)
        }
        script.onerror = reject
        document.head.appendChild(script)
      })
    }

    const extractTextFromPDF = async (file: File): Promise<string> => {
      const pdfjs = await loadPdfJS()
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
      let fullText = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map((item: any) => item.str).join(' ')
        fullText += `[Page ${i}]\n${pageText}\n\n`
      }
      return fullText.trim()
    }

    let userPrompt = textToUse.trim()
    let dbContent = userPrompt
    
    // Process attachments
    if (attachments.length > 0) {
      const processedAttachments: any[] = []
      for (const file of attachments) {
        try {
          if (file.type.startsWith('image/')) {
            const dataUrl = await compressImageAsDataURL(file)
            processedAttachments.push({
              name: file.name,
              type: file.type,
              content: dataUrl
            })
          } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            const pdfText = await extractTextFromPDF(file)
            const dataUrl = await readFileAsDataURL(file)
            processedAttachments.push({
              name: file.name,
              type: file.type,
              content: pdfText,
              dataUrl: dataUrl
            })
          } else {
            const textContent = await readFileAsText(file)
            const dataUrl = await readFileAsDataURL(file)
            processedAttachments.push({
              name: file.name,
              type: file.type,
              content: textContent,
              dataUrl: dataUrl
            })
          }
        } catch (err) {
          console.error('Failed to read file:', file.name, err)
        }
      }
      if (processedAttachments.length > 0) {
        dbContent = JSON.stringify({
          text: userPrompt,
          attachments: processedAttachments
        })
      }
    }

    setInput('')
    setAttachments([])

    // Save user message
    try {
      const userMsg = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: dbContent }),
      }).then(r => r.json())

      addMessage(sessionId, userMsg)

      if (session.messages.length === 0) {
        const title = textToUse.trim().slice(0, 50) + (textToUse.trim().length > 50 ? '...' : '')
        fetch(`/api/sessions/${sessionId}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        useChatStore.setState(state => ({
          sessions: state.sessions.map(s => s.id === sessionId ? { ...s, title } : s),
        }))
      }
    } catch {
      notifyError('Gagal menyimpan pesan')
      setIsGenerating(false)
      return
    }

    // Add temp assistant message
    const tempId = 'temp-' + Date.now()
    addMessage(sessionId, {
      id: tempId, sessionId, role: 'assistant', content: '',
      provider: session.provider, model: session.model,
      tokenInput: null, tokenOutput: null, createdAt: new Date().toISOString(),
    })

    // Stream response
    try {
      abortRef.current = new AbortController()
      const allMessages = [...session.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })), { role: 'user', content: dbContent }]

      const response = await fetch('/api/chat/stream', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          model: session.model,
          messages: allMessages,
          stream: true,
          options: { temperature: settings.temperature, topP: settings.topP, maxTokens: settings.maxTokens, systemPrompt: settings.systemPrompt || undefined },
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message || `Request failed (${response.status})`)
      }

      const contentType = response.headers.get('content-type') || ''
      let fullText = ''

      if (contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') break
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'text' && parsed.content) {
                fullText += parsed.content
                updateLastAssistant(sessionId, fullText)
              } else if (parsed.type === 'error') {
                throw new Error(parsed.message)
              }
            } catch {}
          }
        }
      } else {
        const result = await response.json()
        if (result.message) {
          fullText = result.message
          updateLastAssistant(sessionId, fullText)
        } else {
          throw new Error(result.message || 'No response')
        }
      }

      if (fullText) {
        const assistantMsg = await fetch(`/api/sessions/${sessionId}/messages`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: fullText, provider: session.provider, model: session.model }),
        }).then(r => r.json())

        useChatStore.setState(state => ({
          sessions: state.sessions.map(s => {
            if (s.id !== sessionId) return s
            return { ...s, messages: s.messages.map(m => m.id === tempId ? assistantMsg : m) }
          }),
        }))
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        updateLastAssistant(sessionId, '(Dihentikan)')
      } else {
        const errStr = String(error.message || error)
        if (errStr.includes('fetch failed') || errStr.includes('Failed to fetch') || errStr.includes('Connection')) {
          updateLastAssistant(sessionId, `\n\n> [!WARNING]\n> **Koneksi Terputus**\n> Server AI (Laptop Anda) sedang offline atau mati. Pastikan aplikasi Serveo berjalan di terminal laptop Anda dan internet tersambung.`)
        } else {
          updateLastAssistant(sessionId, `Error: ${error.message || 'Gagal mendapat respons'}`)
        }
      }
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="border-t border-border bg-surface/60 backdrop-blur-lg px-4 pt-3 pb-4">
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-accent-500/10 border border-accent-500/15 rounded-xl text-sm">
              {a.type.startsWith('image/') ? <Image className="w-4 h-4 text-accent-500" /> : <FileText className="w-4 h-4 text-accent-500" />}
              <span className="truncate max-w-[120px] text-text-secondary">{a.name}</span>
              <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-text-secondary hover:text-error transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div {...getRootProps()} className={`relative ${isDragActive ? 'opacity-50' : ''}`}>
        <input {...getInputProps()} />
        <div className="relative flex items-end gap-2 bg-background border border-border rounded-2xl focus-within:border-accent-500/50 focus-within:shadow-soft transition-all duration-150 px-4 py-2">
          <textarea ref={textareaRef} data-chat-input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={t('typeMessagePlaceholder')} rows={1}
            className="flex-1 resize-none bg-transparent text-base text-text-primary outline-none py-1.5 placeholder:text-text-secondary/40"
            style={{ minHeight: '28px', maxHeight: '200px' }} />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isGenerating ? (
              <button onClick={() => abortRef.current?.abort()}
                className="p-2 bg-error/10 text-error rounded-xl hover:bg-error/20 transition-colors">
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <>
                <button type="button" onClick={toggleListening}
                  className={cn("p-2 rounded-xl transition-colors",
                    isListening ? "bg-red-500/10 text-red-500 hover:text-red-600 animate-pulse" : "hover:bg-black/[0.04] dark:hover:bg-white/[0.05] text-text-secondary hover:text-text-primary"
                  )} title={isListening ? "Listening..." : "Voice Input"}>
                  <Mic className="w-4 h-4" />
                </button>
                <label className="p-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] rounded-xl transition-colors cursor-pointer text-text-secondary hover:text-text-primary">
                  <Paperclip className="w-4 h-4" />
                  <input type="file" className="hidden" multiple onChange={e => {
                    if (e.target.files) setAttachments(prev => [...prev, ...Array.from(e.target.files!)])
                  }} />
                </label>
                <button onClick={() => handleSend()} disabled={!input.trim() && attachments.length === 0}
                  className="p-2 bg-accent-600 text-white rounded-xl hover:bg-accent-700 transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 shadow-soft">
                  <Send className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center mt-2">
        <span className="text-[10px] text-text-secondary/30">
          {sessions.find(s => s.id === sessionId)?.provider} · {sessions.find(s => s.id === sessionId)?.model?.split('/').pop()?.replace(/-/g, ' ')}
        </span>
      </div>
    </div>
  )
}
