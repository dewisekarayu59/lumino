import { create } from 'zustand'
import type { AIProvider } from '@/lib/types'

export interface DBSession {
  id: string
  userId: string
  provider: string
  model: string
  title: string
  pinned: boolean
  favorite: boolean
  createdAt: string
  updatedAt: string
  messages: DBMessage[]
}

export interface DBMessage {
  id: string
  sessionId: string
  role: string
  content: string
  provider: string | null
  model: string | null
  tokenInput: number | null
  tokenOutput: number | null
  createdAt: string
}

interface ChatState {
  sessions: DBSession[]
  activeSessionId: string | null
  sidebarOpen: boolean
  searchQuery: string
  isLoading: boolean
  providerStatus: Record<string, boolean>

  setSessions: (sessions: DBSession[]) => void
  setActiveSession: (id: string | null) => void
  setSidebarOpen: (open: boolean) => void
  setSearchQuery: (query: string) => void
  setIsLoading: (loading: boolean) => void
  setProviderStatus: (status: Record<string, boolean>) => void

  createSession: (provider: string, model: string) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>

  addMessage: (sessionId: string, message: DBMessage) => void
  updateLastAssistant: (sessionId: string, content: string) => void
  deleteMessage: (sessionId: string, messageId: string) => Promise<void>

  getActiveSession: () => DBSession | undefined
  getFilteredSessions: () => DBSession[]
  fetchMessages: (sessionId: string, cursor?: string) => Promise<void>
}

async function apiGet(url: string) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('API error')
  return res.json()
}

async function apiPost(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
  if (!res.ok) throw new Error('API error')
  return res.json()
}

async function apiPut(url: string, body: any) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) })
  if (!res.ok) throw new Error('API error')
  return res.json()
}

async function apiDelete(url: string) {
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) throw new Error('API error')
  return res.json()
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  sidebarOpen: true,
  searchQuery: '',
  isLoading: false,
  providerStatus: {},

  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setProviderStatus: (status) => set({ providerStatus: status }),

  createSession: async (provider, model) => {
    const session = await apiPost('/api/sessions', { provider, model, title: 'New Chat' })
    set(state => ({ sessions: [{ ...session, messages: [] }, ...state.sessions], activeSessionId: session.id }))
    return session.id
  },

  deleteSession: async (id) => {
    await apiDelete(`/api/sessions/${id}`)
    set(state => ({
      sessions: state.sessions.filter(s => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    }))
  },

  renameSession: async (id, title) => {
    await apiPut(`/api/sessions/${id}`, { title })
    set(state => ({
      sessions: state.sessions.map(s => s.id === id ? { ...s, title } : s),
    }))
  },

  addMessage: (sessionId, message) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s
      ),
    }))
  },

  updateLastAssistant: (sessionId, content) => {
    set(state => ({
      sessions: state.sessions.map(s => {
        if (s.id !== sessionId) return s
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content }
        }
        return { ...s, messages: msgs }
      }),
    }))
  },

  deleteMessage: async (sessionId, messageId) => {
    await apiDelete(`/api/sessions/${sessionId}/messages?messageId=${messageId}`)
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId
          ? { ...s, messages: s.messages.filter(m => m.id !== messageId) }
          : s
      ),
    }))
  },

  fetchMessages: async (sessionId, cursor) => {
    try {
      const url = cursor 
        ? `/api/sessions/${sessionId}/messages?cursor=${cursor}`
        : `/api/sessions/${sessionId}/messages`
      
      const { messages } = await apiGet(url)
      
      set(state => ({
        sessions: state.sessions.map(s => {
          if (s.id !== sessionId) return s
          
          // If cursor is provided, prepend messages. Else, replace all (initial load).
          const existingMessages = s.messages || []
          const newMessages = cursor 
            ? [...messages, ...existingMessages]
            : messages
            
          // Deduplicate just in case
          const uniqueIds = new Set()
          const uniqueMessages = newMessages.filter((m: DBMessage) => {
            if (uniqueIds.has(m.id)) return false
            uniqueIds.add(m.id)
            return true
          })
            
          return { ...s, messages: uniqueMessages }
        })
      }))
    } catch (err) {
      console.error('Failed to fetch messages', err)
    }
  },

  getActiveSession: () => {
    const state = get()
    return state.sessions.find(s => s.id === state.activeSessionId)
  },

  getFilteredSessions: () => {
    const state = get()
    const q = state.searchQuery.toLowerCase()
    return state.sessions
      .filter(s => !q || s.title.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  },
}))

interface SettingsState {
  defaultProvider: string
  defaultModel: string
  theme: string
  temperature: number
  maxTokens: number
  topP: number
  streaming: boolean
  systemPrompt: string

  loadSettings: () => Promise<void>
  updateSettings: (data: Partial<SettingsState>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  defaultProvider: 'groq',
  defaultModel: 'dewis',
  theme: 'light',
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1,
  streaming: true,
  systemPrompt: '',

  loadSettings: async () => {
    try {
      const data = await apiGet('/api/user/settings')
      set({
        defaultProvider: data.defaultProvider || 'groq',
        defaultModel: data.defaultModel || 'dewis',
        theme: data.theme || 'light',
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens || 4096,
        topP: data.topP ?? 1,
        streaming: data.streaming ?? true,
        systemPrompt: data.systemPrompt || '',
      })
    } catch {}
  },

  updateSettings: async (data) => {
    set(state => ({ ...state, ...data }))
    try {
      await apiPut('/api/user/settings', data)
    } catch {}
  },
}))

interface UIState {
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

export const useUIStore = create<UIState>()((set) => ({
  theme: 'light',
  setTheme: (theme) => set({ theme }),
}))
