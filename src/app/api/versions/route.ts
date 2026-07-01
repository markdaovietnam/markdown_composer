import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessFile } from "@/lib/access";

const MAX_VERSIONS = 50;

async function getFile(ownerId: string, filePath: string) {
  return prisma.file.findUnique({ where: { ownerId_path: { ownerId, path: filePath } } });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const filePath = req.nextUrl.searchParams.get("file");
  const ownerId = req.nextUrl.searchParams.get("owner") || session.user.id;
  if (!filePath) return NextResponse.json({ error: "Missing file param" }, { status: 400 });

  const allowed = await canAccessFile(session.user.id, ownerId, filePath);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const file = await getFile(ownerId, filePath);
  if (!file) return NextResponse.json([]);

  const versions = await prisma.version.findMany({
    where: { fileId: file.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    versions.map((v) => ({
      timestamp: v.createdAt.getTime(),
      id: v.id,
      name: v.name,
      size: v.content.length,
      content: v.content,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filePath, content, name, owner } = await req.json();
  const ownerId = owner || session.user.id;
  if (!filePath || content == null) return NextResponse.json({ error: "Missing filePath or content" }, { status: 400 });

  const allowed = await canAccessFile(session.user.id, ownerId, filePath);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let file = await getFile(ownerId, filePath);
  if (!file) {
    file = await prisma.file.create({
      data: { name: filePath.split("/").pop() || filePath, path: filePath, content, ownerId },
    });
  }

  // Skip if content unchanged
  const latest = await prisma.version.findFirst({
    where: { fileId: file.id },
    orderBy: { createdAt: "desc" },
  });
  if (latest?.content === content) return NextResponse.json({ skipped: true });

  const version = await prisma.version.create({
    data: { fileId: file.id, content, name: name || "" },
  });

  // Prune old versions
  const count = await prisma.version.count({ where: { fileId: file.id } });
  if (count > MAX_VERSIONS) {
    const oldest = await prisma.version.findMany({
      where: { fileId: file.id },
      orderBy: { createdAt: "asc" },
      take: count - MAX_VERSIONS,
    });
    await prisma.version.deleteMany({ where: { id: { in: oldest.map((v) => v.id) } } });
  }

  return NextResponse.json({ timestamp: version.createdAt.getTime(), id: version.id, name: version.name });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, name } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.version.update({ where: { id }, data: { name: name || "" } });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (id) await prisma.version.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
