'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useChatStore, useSettingsStore, useUIStore } from '@/lib/store'
import { useTranslation } from '@/lib/store/language'
import { PROVIDER_INFO } from '@/lib/providers'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquarePlus, Search, MoreHorizontal,
  Trash2, Edit3, Settings, User, Moon, Sun, X, LogOut, Pin, PinOff, Share2, Sparkles
} from 'lucide-react'
import type { DBSession } from '@/lib/store'

function groupSessionsByTime(sessions: DBSession[], t: (key: any) => string) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)

  const groups: { label: string; items: DBSession[] }[] = [
    { label: t('pinned'), items: [] },
    { label: t('today'), items: [] },
    { label: t('yesterday'), items: [] },
    { label: t('previous7Days'), items: [] },
    { label: t('older'), items: [] },
  ]

  for (const s of sessions) {
    if (s.pinned) { groups[0].items.push(s); continue }
    const d = new Date(s.updatedAt)
    if (d >= today) groups[1].items.push(s)
    else if (d >= yesterday) groups[2].items.push(s)
    else if (d >= weekAgo) groups[3].items.push(s)
    else groups[4].items.push(s)
  }

  return groups.filter(g => g.items.length > 0)
}

export function Sidebar() {
  const router = useRouter()
  const { t } = useTranslation()
  const { sessions, activeSessionId, sidebarOpen, searchQuery, setActiveSession,
    setSidebarOpen, setSearchQuery, deleteSession, renameSession, setSessions,
    createSession, providerStatus, setProviderStatus } = useChatStore()
  const { defaultProvider, defaultModel, loadSettings } = useSettingsStore()
  const { theme, setTheme } = useUIStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [contextMenu, setContextMenu] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    loadSettings()
    fetch('/api/sessions', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSessions(data.map((s: any) => ({ ...s, messages: s.messages || [] })))
        }
      })
      .catch(() => {})
    fetch('/api/providers', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const status: Record<string, boolean> = {}
          data.forEach((p: any) => { status[p.id] = p.configured })
          setProviderStatus(status)
        }
      })
      .catch(() => {})
  }, [])

  const sortedSessions = useMemo(() =>
    [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [sessions]
  )

  const filteredSessions = useMemo(() =>
    sortedSessions.filter(s => !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase())),
    [sortedSessions, searchQuery]
  )

  const groupedSessions = useMemo(() => groupSessionsByTime(filteredSessions, t), [filteredSessions, t])

  const handleNewChat = async () => {
    if (isCreating) return
    setIsCreating(true)
    try {
      let provider = defaultProvider
      let model = defaultModel
      if (!providerStatus[provider]) {
        const enabledProviders = Object.entries(providerStatus).filter(([_, v]) => v)
        provider = enabledProviders.length > 0 ? enabledProviders[0][0] : defaultProvider
        const { getModelsForProvider } = await import('@/lib/providers')
        const models = getModelsForProvider(provider as any)
        model = models[0]?.id || defaultModel
      }
      const sessionId = await createSession(provider, model)
      if (sessionId) {
        if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false)
        router.push('/chat')
      }
    } catch (error) {
      console.error('Failed to create new chat:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const startRename = (id: string, title: string) => { setEditingId(id); setEditTitle(title); setContextMenu(null) }
  const confirmRename = () => { if (editingId && editTitle.trim()) renameSession(editingId, editTitle.trim()); setEditingId(null) }

  const togglePin = async (session: DBSession) => {
    try {
      await fetch(`/api/sessions/${session.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !session.pinned }),
      })
      setSessions(sessions.map(s => s.id === session.id ? { ...s, pinned: !s.pinned } : s))
    } catch {}
    setContextMenu(null)
  }

  const handleShareSession = async (session: DBSession) => {
    try {
      const res = await fetch(`/api/sessions/${session.id}`, { credentials: 'include' })
      const data = await res.json()
      if (data.messages) {
        const text = data.messages
          .map((m: any) => `**${m.role === 'user' ? 'You' : 'AI'}:** ${m.content}`)
          .join('\n\n')
        await navigator.clipboard.writeText(`# ${session.title}\n\n${text}`)
        const { notifySuccess } = await import('@/components/notification/Toast')
        notifySuccess(t('chatCopied'))
      }
    } catch {}
    setContextMenu(null)
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {}
    localStorage.removeItem('user')
    localStorage.removeItem('token')
    window.location.href = '/login'
  }

  const SessionItem = ({ session }: { session: DBSession }) => {
    const pinfo = PROVIDER_INFO[session.provider as keyof typeof PROVIDER_INFO]
    const isConfigured = providerStatus[session.provider] !== false
    const isActive = activeSessionId === session.id

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        onClick={() => {
          setActiveSession(session.id)
          if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false)
          router.push('/chat')
        }}
        className={cn('group relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150',
          isActive
            ? 'bg-accent-500/10 border border-accent-500/15 text-text-primary shadow-sm'
            : 'border border-transparent text-text-secondary hover:text-text-primary hover:bg-black/[0.03] dark:hover:bg-white/[0.04]')}>
        {editingId === session.id ? (
          <input value={editTitle} onChange={e => setEditTitle(e.target.value)} onBlur={confirmRename}
            onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setEditingId(null) }}
            className="flex-1 bg-surface border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-accent-500 transition-colors" autoFocus
            onClick={e => e.stopPropagation()} />
        ) : (
          <>
            <span className="flex-1 truncate text-[13px] leading-snug font-medium">{session.title}</span>
            {session.pinned && <Pin className="w-3 h-3 text-accent-500 flex-shrink-0 opacity-60" />}
            {!isConfigured && <span className="text-[9px] px-1.5 py-0.5 bg-warning/10 text-warning rounded-full font-medium">{t('noKey')}</span>}
            <button onClick={e => { e.stopPropagation(); setContextMenu(contextMenu === session.id ? null : session.id) }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] rounded-lg transition-all">
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </>
        )}
        <AnimatePresence>
          {contextMenu === session.id && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 4 }}
              transition={{ duration: 0.1 }}
              className="absolute right-4 bottom-full mb-1 bg-surface rounded-xl shadow-soft-lg border border-border p-1 z-50 w-44"
              onClick={e => e.stopPropagation()}>
              <button onClick={() => startRename(session.id, session.title)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
                <Edit3 className="w-3.5 h-3.5 text-text-secondary" /> {t('rename')}
              </button>
              <button onClick={() => togglePin(session)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
                {session.pinned ? <PinOff className="w-3.5 h-3.5 text-text-secondary" /> : <Pin className="w-3.5 h-3.5 text-text-secondary" />}
                {session.pinned ? t('unpin') : t('pinToTop')}
              </button>
              <button onClick={() => handleShareSession(session)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] rounded-lg hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors">
                <Share2 className="w-3.5 h-3.5 text-text-secondary" /> {t('shareCopy')}
              </button>
              <div className="my-1 border-t border-border" />
              <button onClick={() => { deleteSession(session.id); setContextMenu(null) }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] rounded-lg hover:bg-error/10 text-error transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> {t('delete')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    )
  }

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 288, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="fixed md:relative left-0 top-0 h-full bg-sidebar border-r border-border z-40 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-14 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center">
                <img src="/logo.png" alt="lumiox logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <span className="font-semibold text-lg text-text-primary/70 tracking-wide">lumiox</span>
              </div>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] rounded-lg transition-colors">
              <X className="w-4 h-4 text-text-secondary" />
            </button>
          </div>

          {/* New Chat Button */}
          <div className="p-3 pb-2">
            <button onClick={handleNewChat} disabled={isCreating}
              className={cn('group relative w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent-600 hover:bg-accent-700 text-white rounded-xl font-medium text-sm transition-all duration-150 active:scale-[0.98] shadow-soft hover:shadow-md overflow-hidden',
                isCreating ? 'opacity-60 cursor-not-allowed' : '')}>
              <span className="relative z-10 flex items-center gap-2">
                <MessageSquarePlus className="w-4 h-4" /> {t('newChat')}
              </span>
              <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform" />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary/60 group-focus-within:text-accent-500 transition-colors" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t('searchChats')}
                className="w-full pl-9 pr-3 py-2.5 bg-black/[0.03] dark:bg-white/[0.04] border border-transparent focus:border-accent-500/30 focus:bg-surface rounded-xl text-[13px] outline-none transition-all placeholder:text-text-secondary/40" />
            </div>
          </div>

          {/* Session List */}
          <nav className="flex-1 overflow-y-auto px-2 py-1" onClick={() => setContextMenu(null)}>
            {groupedSessions.map(group => (
              <div key={group.label} className="mb-2">
                <p className="px-3 py-1.5 text-[11px] font-medium text-text-secondary/50 uppercase tracking-[0.08em]">{group.label}</p>
                {group.items.map(s => <SessionItem key={s.id} session={s} />)}
              </div>
            ))}
            {filteredSessions.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center py-12 px-4">
                <Sparkles className="w-8 h-8 text-text-secondary/20 mb-3" />
                <p className="text-xs text-text-secondary/40">{t('noChatsYet')}</p>
                <p className="text-[10px] text-text-secondary/30 mt-1">{t('startNewConversation')}</p>
              </div>
            )}
          </nav>

          {/* Bottom Section */}
          <div className="border-t border-border p-2.5 space-y-0.5 flex-shrink-0">
            <button onClick={() => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next as any) }}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-[13px] text-text-secondary hover:bg-black/[0.03] dark:hover:bg-white/[0.04] rounded-xl transition-colors">
              {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              {theme === 'light' ? t('darkMode') : t('lightMode')}
            </button>
            <Link href="/settings" onClick={() => { if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false) }}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-[13px] text-text-secondary hover:bg-black/[0.03] dark:hover:bg-white/[0.04] rounded-xl transition-colors">
              <Settings className="w-4 h-4" /> {t('settings')}
            </Link>
            <Link href="/profile" onClick={() => { if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false) }}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-[13px] text-text-secondary hover:bg-black/[0.03] dark:hover:bg-white/[0.04] rounded-xl transition-colors">
              <User className="w-4 h-4" /> {t('profile')}
            </Link>
            <button onClick={handleLogout}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-[13px] text-error hover:bg-error/10 rounded-xl transition-colors">
              <LogOut className="w-4 h-4" /> {t('logout')}
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
