'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, Bot, User, AlertTriangle, RefreshCw, Shield, CreditCard, Key, WifiOff, Edit3, X, Trash2, ExternalLink, Download, Volume2, VolumeX } from 'lucide-react'
import type { DBMessage } from '@/lib/store'
import { formatDistanceToNow } from 'date-fns'

const rehypeHighlight = typeof window !== 'undefined'
  ? require('rehype-highlight').default
  : undefined

interface ErrorInfo {
  type: 'missing_key' | 'no_credits' | 'blocked' | 'rate_limit' | 'not_found' | 'network' | 'request_too_large' | 'unknown'
  icon: React.ReactNode
  title: string
  description: string
  color: string
}

function parseErrorMessage(content: string): ErrorInfo | null {
  if (!content.startsWith('Error:') && !content.startsWith('⚠️')) return null
  const msg = content.replace(/^(Error:|⚠️)\s*/, '')
  const lower = msg.toLowerCase()

  if (lower.includes('belum dikonfigurasi') || lower.includes('missing') || lower.includes('api key')) {
    return { type: 'missing_key', icon: <Key className="w-5 h-5" />, title: 'API Key Missing', description: msg || 'API Key for this provider is not configured.', color: 'from-amber-500/10 to-orange-500/10 border-amber-500/20' }
  }
  if (lower.includes('insufficient') || lower.includes('balance') || lower.includes('credit')) {
    return { type: 'no_credits', icon: <CreditCard className="w-5 h-5" />, title: 'Insufficient Credits', description: 'Your account balance is too low. Please top up at the provider\'s website.', color: 'from-red-500/10 to-rose-500/10 border-red-500/20' }
  }
  if (lower.includes('forbidden') || lower.includes('akses ditolak') || lower.includes('403')) {
    return { type: 'blocked', icon: <Shield className="w-5 h-5" />, title: 'Access Denied', description: 'API Key does not have access to this model.', color: 'from-red-500/10 to-rose-500/10 border-red-500/20' }
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('rate_limit') || lower.includes('quota')) {
    return { type: 'rate_limit', icon: <WifiOff className="w-5 h-5" />, title: 'Rate Limited', description: 'Too many requests. Please wait and try again.', color: 'from-yellow-500/10 to-amber-500/10 border-yellow-500/20' }
  }
  if (lower.includes('404') || lower.includes('not found') || lower.includes('model tidak ditemukan')) {
    return { type: 'not_found', icon: <AlertTriangle className="w-5 h-5" />, title: 'Model Not Found', description: 'The selected model is not available. Please choose a different model.', color: 'from-orange-500/10 to-amber-500/10 border-orange-500/20' }
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection')) {
    return { type: 'network', icon: <WifiOff className="w-5 h-5" />, title: 'Connection Failed', description: 'Cannot reach the server. Check your internet connection.', color: 'from-pink-500/10 to-rose-500/10 border-pink-500/20' }
  }
  if (lower.includes('too large') || lower.includes('request_too_large') || lower.includes('entity too large')) {
    return { type: 'request_too_large', icon: <AlertTriangle className="w-5 h-5" />, title: 'Request Too Large', description: msg || 'Pesan terlalu besar. Coba mulai percakapan baru.', color: 'from-orange-500/10 to-amber-500/10 border-orange-500/20' }
  }
  return { type: 'unknown', icon: <AlertTriangle className="w-5 h-5" />, title: 'Error', description: msg || 'An unknown error occurred. Please try again.', color: 'from-red-500/10 to-rose-500/10 border-red-500/20' }
}

function formatTime(dateStr: string) {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: false })
      .replace('about ', '')
      .replace('less than a minute', 'just now')
      + ' ago'
  } catch { return '' }
}

export function MessageBubble({ message, onRetry, onEdit, onDelete }: { message: DBMessage; onRetry?: () => void; onEdit?: (newContent: string) => void; onDelete?: () => void }) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const errorInfo = isAssistant ? parseErrorMessage(message.content) : null

  // Try to parse JSON content for user messages with attachments
  const parsedContent = useMemo(() => {
    if (isUser && message.content.startsWith('{') && message.content.endsWith('}')) {
      try {
        const parsed = JSON.parse(message.content)
        if (parsed.text !== undefined && Array.isArray(parsed.attachments)) {
          return parsed
        }
      } catch {}
    }
    return null
  }, [message.content, isUser])

  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(parsedContent ? parsedContent.text : message.content)
  const [isPlaying, setIsPlaying] = useState(false)
  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const toggleTTS = () => {
    if (typeof window === 'undefined') return

    if (isPlaying) {
      window.speechSynthesis.cancel()
      setIsPlaying(false)
    } else {
      window.speechSynthesis.cancel()
      
      const textToSpeak = parsedContent ? parsedContent.text : message.content
      const cleanText = textToSpeak
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[.*?\]\(.*?\)/g, '')
        .replace(/`{3}[\s\S]*?`{3}/g, '')
        .replace(/`.*?`/g, '')
        .replace(/[#*_\-~>]/g, '')
        .trim()

      if (!cleanText) return

      const utterance = new SpeechSynthesisUtterance(cleanText)
      const isIndo = /\b(adalah|dan|saya|yang|untuk|dengan|bisa|ini|itu|ada)\b/i.test(cleanText)
      utterance.lang = isIndo ? 'id-ID' : 'en-US'

      utterance.onend = () => {
        setIsPlaying(false)
      }
      utterance.onerror = () => {
        setIsPlaying(false)
      }

      setIsPlaying(true)
      window.speechSynthesis.speak(utterance)
    }
  }

  // Keep editText in sync when content changes
  useEffect(() => {
    setEditText(parsedContent ? parsedContent.text : message.content)
  }, [message.content, parsedContent])

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus()
      editRef.current.style.height = 'auto'
      editRef.current.style.height = Math.min(editRef.current.scrollHeight, 200) + 'px'
    }
  }, [isEditing])

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpen = (att: any) => {
    let url = att.dataUrl || (att.type.startsWith('image/') ? att.content : null)
    
    // Convert base64 dataUrl to blobUrl if it exists and is a PDF or other document to prevent browser sandboxing blocks
    if (url && url.startsWith('data:')) {
      try {
        const arr = url.split(',')
        const mime = arr[0].match(/:(.*?);/)![1]
        const bstr = atob(arr[1])
        let n = bstr.length
        const u8arr = new Uint8Array(n)
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n)
        }
        const blob = new Blob([u8arr], { type: mime })
        url = URL.createObjectURL(blob)
      } catch (e) {
        console.error('Failed to convert base64 to blob', e)
      }
    }

    if (url) {
      // Open the Blob URL directly so browser can render native PDF reader/Image viewer
      window.open(url, '_blank')
    } else {
      // Fallback for historical messages without dataUrl
      const isPDF = att.type === 'application/pdf' || att.name.endsWith('.pdf')
      const win = window.open()
      if (win) {
        win.document.write(`
          <html>
            <head>
              <title>${att.name}</title>
              <style>
                body { margin: 0; padding: 24px; background: #0F172A; color: #E2E8F0; font-family: sans-serif; }
                pre { white-space: pre-wrap; word-wrap: break-word; background: #1E293B; padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); font-family: monospace; max-height: 80vh; overflow-y: auto; }
                h2 { color: white; margin-top: 0; }
                p { color: #94A3B8; font-size: 13px; margin-bottom: 20px; }
              </style>
            </head>
            <body>
              <h2>${att.name} (Text Preview)</h2>
              ${isPDF ? '<p>This PDF was uploaded before PDF-viewer support was added. Displaying extracted text content:</p>' : ''}
              <pre>${att.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            </body>
          </html>
        `)
      }
    }
  }

  const handleSaveEdit = () => {
    const trimmed = editText.trim()
    const currentText = parsedContent ? parsedContent.text : message.content
    if (trimmed && trimmed !== currentText && onEdit) {
      if (parsedContent) {
        onEdit(JSON.stringify({
          ...parsedContent,
          text: trimmed
        }))
      } else {
        onEdit(trimmed)
      }
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditText(parsedContent ? parsedContent.text : message.content)
    setIsEditing(false)
  }

  // Error card
  if (errorInfo) {
    return (
      <div className="flex gap-3 justify-start animate-fade-in">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center flex-shrink-0 shadow-soft">
          <Bot className="w-4 h-4 text-white" />
        </div>
        <div className="max-w-[80%]">
          {message.provider && (
            <div className="flex items-center gap-2 mb-1.5 ml-1">
              <span className="text-[11px] font-medium text-accent-500 capitalize">{message.provider}</span>
              {message.model && <span className="text-[11px] text-text-secondary/60">· {message.model?.split('/').pop()}</span>}
            </div>
          )}
          <div className={cn('rounded-2xl border px-4 py-3.5 bg-gradient-to-br', errorInfo.color)}>
            <div className="flex items-start gap-3">
              <div className="text-red-400 mt-0.5 flex-shrink-0">{errorInfo.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">{errorInfo.title}</p>
                <p className="text-xs text-text-secondary leading-relaxed">{errorInfo.description}</p>
                {onRetry && (
                  <button onClick={onRetry}
                    className="mt-3 flex items-center gap-1.5 text-xs font-medium text-accent-500 hover:text-accent-600 transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}
              </div>
            </div>
          </div>
          {message.createdAt && (
            <p className="text-[10px] text-text-secondary/40 mt-1 ml-1">{formatTime(message.createdAt)}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('group flex gap-3 animate-fade-in items-start', isUser ? 'flex-row-reverse' : '')}>
      {isAssistant && (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center flex-shrink-0 shadow-soft">
          <Bot className="w-4 h-4 text-white" />
        </div>
      )}

      {isUser && (
        <div className="w-8 h-8 rounded-xl bg-accent-600 flex items-center justify-center flex-shrink-0 shadow-soft">
          <User className="w-4 h-4 text-white" />
        </div>
      )}

      <div className={cn('relative max-w-[min(75%,720px)] rounded-2xl px-4 py-2.5 transition-all duration-150',
        isUser
          ? 'bg-accent-600 text-white rounded-tr-sm'
          : 'bg-surface border border-border rounded-tl-sm')}>

        {/* Provider label */}
        {isAssistant && message.provider && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-medium text-accent-500 capitalize">{message.provider}</span>
            {message.model && <span className="text-[11px] text-text-secondary/60">· {message.model?.split('/').pop()}</span>}
          </div>
        )}

        {/* Content */}
        {isEditing ? (
          <div className="space-y-2">
            <textarea ref={editRef} value={editText} onChange={e => setEditText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit() } if (e.key === 'Escape') handleCancelEdit() }}
              className="w-full bg-white/10 rounded-xl px-3 py-2 text-[13px] text-white outline-none resize-none border border-white/20 focus:border-white/40 transition-colors"
              rows={Math.min(editText.split('\n').length, 6)} />
            <div className="flex items-center gap-2 justify-end">
              <button onClick={handleCancelEdit} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleSaveEdit} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className={cn('markdown-body text-[13px] leading-relaxed', isUser ? 'text-white' : 'text-text-primary')}>
            {parsedContent ? (
              <div className="space-y-3 flex flex-col items-end">
                {/* File Attachment Cards */}
                <div className="flex flex-wrap gap-2 justify-end w-full">
                  {parsedContent.attachments.map((att: any, idx: number) => {
                    const isImg = att.type.startsWith('image/')
                    const isPDF = att.type === 'application/pdf' || att.name.endsWith('.pdf')
                    return (
                      <button key={idx} onClick={() => handleOpen(att)} className="flex items-center gap-3 p-2.5 bg-white/10 dark:bg-black/25 border border-white/10 rounded-2xl max-w-[240px] text-left shadow-soft cursor-pointer hover:bg-white/15 dark:hover:bg-black/40 hover:scale-[1.02] active:scale-[0.98] transition-all group/card">
                        {isImg ? (
                          <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-black/10 border border-white/10">
                            <img src={att.content} className="w-full h-full object-cover" alt={att.name} />
                          </div>
                        ) : (
                          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-[10px] uppercase shadow-sm", 
                            isPDF ? "bg-rose-600" : "bg-blue-600"
                          )}>
                            {isPDF ? 'PDF' : 'DOC'}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate">{att.name}</p>
                          <p className="text-[9px] text-white/50 uppercase mt-0.5 font-medium group-hover/card:text-white/80 transition-colors">Click to Open</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {/* Prompt Text */}
                {parsedContent.text && (
                  <p className="whitespace-pre-wrap text-white text-right w-full">{parsedContent.text}</p>
                )}
              </div>
            ) : isUser ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ src, alt }) => (
                    <img src={src} alt={alt} className="max-w-full max-h-60 rounded-xl my-2 shadow-soft border border-white/10 block" />
                  ),
                  p: ({ children }) => <p className="whitespace-pre-wrap text-white">{children}</p>
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypeHighlight ? [rehypeHighlight] : []}
                components={{
                  img: ({ src, alt }) => {
                    if (!src) return null
                    return (
                      <div className="relative group/img my-3 max-w-[320px] rounded-2xl overflow-hidden shadow-soft border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 transition-all hover:scale-[1.01] flex flex-col">
                        <img src={src} alt={alt} className="w-full h-auto object-cover max-h-60" />
                        <div className="flex items-center justify-between border-t border-border dark:border-white/10 px-3 py-2 bg-slate-50 dark:bg-[#1E293B] text-[11px] text-text-secondary">
                          <span className="truncate max-w-[150px] font-semibold text-text-primary">{alt || 'Generated Image'}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => window.open(src, '_blank')} className="p-1 hover:bg-slate-200 dark:hover:bg-white/10 rounded-md transition-colors text-text-primary" title="Open Image">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => {
                              fetch(src)
                                .then(r => r.blob())
                                .then(blob => {
                                  const url = URL.createObjectURL(blob)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = alt || 'image.png'
                                  document.body.appendChild(a)
                                  a.click()
                                  document.body.removeChild(a)
                                  URL.revokeObjectURL(url)
                                })
                                .catch(err => {
                                  console.error('Download failed, opening fallback', err)
                                  window.open(src, '_blank')
                                })
                            }} className="p-1 hover:bg-slate-200 dark:hover:bg-white/10 rounded-md transition-colors text-text-primary" title="Download Image">
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  },
                  pre: ({ children }) => (
                    <div className="relative group/code my-3">
                      <div className="absolute right-2 top-2 opacity-0 group-hover/code:opacity-100 transition-opacity z-10">
                        <button onClick={() => {
                          const code = typeof children === 'object' && children && 'props' in children ? (children as any).props.children : String(children)
                          copyToClipboard(String(code))
                        }} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white/70 hover:text-white">
                          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <pre className="!bg-[#1A1B26] !rounded-xl overflow-x-auto">{children}</pre>
                    </div>
                  ),
                  code: ({ className, children, ...props }) => {
                    const match = /language-(\w+)/.exec(className || '')
                    return match ? <code className={className} {...props}>{children}</code> :
                      <code className="bg-accent-500/8 dark:bg-accent-500/12 px-1.5 py-0.5 rounded text-accent-600 dark:text-accent-400 text-[0.85em]" {...props}>{children}</code>
                  },
                }}>
                {message.content}
              </ReactMarkdown>
            )}
          </div>
        )}
 
        {/* Actions */}
        {!isEditing && (
          <div className={cn('flex items-center gap-0.5 mt-1.5 -mb-1 opacity-100 transition-opacity', isUser ? 'justify-end' : '')}>
            <button onClick={() => copyToClipboard(parsedContent ? parsedContent.text : message.content)}
              className={cn('p-1.5 rounded-lg transition-colors', isUser ? 'hover:bg-white/10 text-white/60 hover:text-white' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.05]')} title="Copy">
              {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            {isAssistant && (
              <button onClick={toggleTTS}
                className="p-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] rounded-lg transition-colors text-text-secondary" title={isPlaying ? "Stop Voice" : "Voice Output"}>
                {isPlaying ? <VolumeX className="w-3.5 h-3.5 text-accent-500 animate-pulse" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            )}
            {isUser && onEdit && (
              <button onClick={() => { setEditText(parsedContent ? parsedContent.text : message.content); setIsEditing(true) }}
                className="p-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] rounded-lg transition-colors" title="Edit">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete}
                className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors text-text-secondary hover:text-red-500" title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
