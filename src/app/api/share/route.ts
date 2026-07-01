import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shares = await prisma.share.findMany({
    where: { receiverId: session.user.id },
    include: { file: true, giver: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    shares.map((s) => ({
      fromEmail: s.giver.email,
      fromUserId: s.giverId,
      filePath: s.file.path,
      fileName: s.file.name,
      sharedAt: s.createdAt.getTime(),
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { email, filePath } = await req.json();
  if (!email || !filePath) return NextResponse.json({ error: "Missing email or filePath" }, { status: 400 });

  const receiver = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!receiver) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const file = await prisma.file.findUnique({
    where: { ownerId_path: { ownerId: session.user.id, path: filePath } },
  });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  try {
    await prisma.share.create({
      data: { fileId: file.id, giverId: session.user.id, receiverId: receiver.id },
    });
  } catch {
    return NextResponse.json({ error: "Already shared" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filePath, fromUserId } = await req.json();

  const file = await prisma.file.findUnique({
    where: { ownerId_path: { ownerId: fromUserId, path: filePath } },
  });
  if (!file) return NextResponse.json({ ok: true });

  await prisma.share.deleteMany({
    where: { fileId: file.id, receiverId: session.user.id },
  });

  return NextResponse.json({ ok: true });
}
