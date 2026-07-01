import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessFile } from "@/lib/access";

const STALE_MS = 15000;

async function getFile(ownerId: string, filePath: string) {
  return prisma.file.findUnique({ where: { ownerId_path: { ownerId, path: filePath } } });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerId = req.nextUrl.searchParams.get("owner") || session.user.id;
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  const allowed = await canAccessFile(session.user.id, ownerId, filePath);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const file = await getFile(ownerId, filePath);
  if (!file) return NextResponse.json([]);

  const staleThreshold = new Date(Date.now() - STALE_MS);
  const presences = await prisma.presence.findMany({
    where: { fileId: file.id, lastSeen: { gte: staleThreshold }, userId: { not: session.user.id } },
  });

  return NextResponse.json(presences.map((p) => ({ userId: p.userId, email: p.userEmail, lastSeen: p.lastSeen.getTime() })));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { owner, path } = await req.json();
  const ownerId = owner || session.user.id;
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  const allowed = await canAccessFile(session.user.id, ownerId, path);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let file = await getFile(ownerId, path);
  if (!file) {
    file = await prisma.file.create({
      data: { name: path.split("/").pop() || path, path, content: "", ownerId },
    });
  }

  await prisma.presence.upsert({
    where: { fileId_userId: { fileId: file.id, userId: session.user.id } },
    update: { lastSeen: new Date(), userEmail: session.user.email },
    create: { fileId: file.id, userId: session.user.id, userEmail: session.user.email },
  });

  return NextResponse.json({ ok: true });
}
