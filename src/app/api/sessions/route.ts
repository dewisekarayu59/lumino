import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyToken } from '@/lib/auth'

function getUser(request: Request) {
  const token = request.headers.get('cookie')?.match(/auth_token=([^;]+)/)?.[1]
  if (!token) return null
  const payload = verifyToken(token)
  return payload?.userId || null
}

export async function GET(request: Request) {
  const userId = getUser(request)
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const sessions = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json(sessions)
}

export async function POST(request: Request) {
  const userId = getUser(request)
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { provider, model, title } = body

  const session = await prisma.chatSession.create({
    data: { userId, provider: provider || 'groq', model: model || 'llama-3.3-70b-versatile', title: title || 'New Chat' },
  })

  return NextResponse.json(session, { status: 201 })
}

export async function DELETE(request: Request) {
  const userId = getUser(request)
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  await prisma.chatMessage.deleteMany({ where: { session: { userId } } })
  await prisma.chatSession.deleteMany({ where: { userId } })

  return NextResponse.json({ message: 'All sessions deleted' })
}
