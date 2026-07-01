import { prisma } from "@/lib/prisma";

export async function canAccessFile(sessionUserId: string, ownerId: string, filePath: string): Promise<boolean> {
  if (sessionUserId === ownerId) return true;

  const file = await prisma.file.findUnique({
    where: { ownerId_path: { ownerId, path: filePath } },
    select: { id: true },
  });
  if (!file) return false;

  const share = await prisma.share.findUnique({
    where: { fileId_receiverId: { fileId: file.id, receiverId: sessionUserId } },
  });

  return !!share;
}
