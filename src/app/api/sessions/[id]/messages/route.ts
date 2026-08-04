import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyToken } from '@/lib/auth'

function getUser(request: Request) {
  const token = request.headers.get('cookie')?.match(/auth_token=([^;]+)/)?.[1]
  if (!token) return null
  const payload = verifyToken(token)
  return payload?.userId || null
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const userId = getUser(request)
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const session = await prisma.chatSession.findFirst({ where: { id: params.id, userId } })
  if (!session) return NextResponse.json({ message: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get('cursor')
  
  const take = 20
  
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: params.id },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1,
    }),
  })

  const hasMore = messages.length > take
  const data = hasMore ? messages.slice(0, take) : messages

  return NextResponse.json({ 
    messages: data.reverse(), 
    nextCursor: data.length > 0 ? data[data.length - 1].id : null,
    hasMore 
  })
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const userId = getUser(request)
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const session = await prisma.chatSession.findFirst({ where: { id: params.id, userId } })
  if (!session) return NextResponse.json({ message: 'Not found' }, { status: 404 })

  const body = await request.json()
  const { role, content, provider, model, tokenInput, tokenOutput } = body

  const message = await prisma.chatMessage.create({
    data: {
      sessionId: params.id,
      role,
      content,
      provider,
      model,
      tokenInput: tokenInput || null,
      tokenOutput: tokenOutput || null,
    },
  })

  await prisma.chatSession.update({ where: { id: params.id }, data: { updatedAt: new Date() } })

  return NextResponse.json(message, { status: 201 })
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const userId = getUser(request)
  if (!userId) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const session = await prisma.chatSession.findFirst({ where: { id: params.id, userId } })
  if (!session) return NextResponse.json({ message: 'Not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const messageId = searchParams.get('messageId')

  if (!messageId) {
    // Delete all messages in the session
    await prisma.chatMessage.deleteMany({ where: { sessionId: params.id } })
    await prisma.chatSession.update({ where: { id: params.id }, data: { updatedAt: new Date() } })
    return NextResponse.json({ message: 'All messages deleted' })
  }

  // Delete a single message
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, sessionId: params.id } })
  if (!message) return NextResponse.json({ message: 'Message not found' }, { status: 404 })

  await prisma.chatMessage.delete({ where: { id: messageId } })
  await prisma.chatSession.update({ where: { id: params.id }, data: { updatedAt: new Date() } })

  return NextResponse.json({ message: 'Message deleted' })
}
