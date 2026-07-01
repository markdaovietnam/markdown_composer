import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessFile } from "@/lib/access";

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

  const comments = await prisma.comment.findMany({
    where: { fileId: file.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    comments.map((c) => ({
      id: c.id,
      authorEmail: c.authorEmail,
      text: c.text,
      createdAt: c.createdAt.getTime(),
      resolved: c.resolved,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { owner, path, text } = await req.json();
  const ownerId = owner || session.user.id;
  if (!path || !text?.trim()) return NextResponse.json({ error: "Missing path or text" }, { status: 400 });

  const allowed = await canAccessFile(session.user.id, ownerId, path);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let file = await getFile(ownerId, path);
  if (!file) {
    file = await prisma.file.create({
      data: { name: path.split("/").pop() || path, path, content: "", ownerId },
    });
  }

  const comment = await prisma.comment.create({
    data: {
      fileId: file.id,
      authorId: session.user.id,
      authorEmail: session.user.email,
      text: text.trim(),
    },
  });

  return NextResponse.json({
    id: comment.id,
    authorEmail: comment.authorEmail,
    text: comment.text,
    createdAt: comment.createdAt.getTime(),
    resolved: comment.resolved,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, resolved } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.comment.update({ where: { id }, data: { resolved: !!resolved } });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (id) await prisma.comment.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
