import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessFile } from "@/lib/access";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownerId = req.nextUrl.searchParams.get("owner") || session.user.id;
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  const allowed = await canAccessFile(session.user.id, ownerId, filePath);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const file = await prisma.file.findUnique({
    where: { ownerId_path: { ownerId, path: filePath } },
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ id: file.id, path: file.path, content: file.content, ownerId });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { owner, path, content } = await req.json();
  const ownerId = owner || session.user.id;
  if (!path || content == null) return NextResponse.json({ error: "Missing path or content" }, { status: 400 });

  const allowed = await canAccessFile(session.user.id, ownerId, path);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.file.upsert({
    where: { ownerId_path: { ownerId, path } },
    update: { content },
    create: { name: path.split("/").pop() || path, path, content, ownerId },
  });

  return NextResponse.json({ ok: true });
}
