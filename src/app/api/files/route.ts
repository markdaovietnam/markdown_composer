import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const files = await prisma.file.findMany({ where: { ownerId: session.user.id } });

  return NextResponse.json(
    files.map((f) => ({
      id: f.id,
      name: f.name,
      path: f.path,
      content: f.content,
      isFolder: f.isFolder,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, content, path, isFolder } = await req.json();
  const filePath = path || name;

  const file = await prisma.file.upsert({
    where: { ownerId_path: { ownerId: session.user.id, path: filePath } },
    update: { content: content ?? "", name: filePath.split("/").pop() || filePath },
    create: {
      name: filePath.split("/").pop() || filePath,
      path: filePath,
      content: content ?? "",
      isFolder: isFolder ?? false,
      ownerId: session.user.id,
    },
  });

  return NextResponse.json({ id: file.id, name: file.name, path: file.path, content: file.content });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { oldPath, newPath } = await req.json();

  const file = await prisma.file.findUnique({
    where: { ownerId_path: { ownerId: session.user.id, path: oldPath } },
  });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await prisma.file.update({
    where: { id: file.id },
    data: { path: newPath, name: newPath.split("/").pop() || newPath },
  });

  return NextResponse.json({ id: updated.id, name: updated.name, path: updated.path });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { path } = await req.json();

  await prisma.file.deleteMany({
    where: { ownerId: session.user.id, path },
  });

  return NextResponse.json({ ok: true });
}
