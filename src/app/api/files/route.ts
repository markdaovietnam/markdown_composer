import { list, put, del } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

function userPrefix(userId: string) {
  return `users/${userId}/files/`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prefix = userPrefix(session.user.id);
  const { blobs } = await list({ prefix });

  const files = await Promise.all(
    blobs.map(async (blob) => {
      const res = await fetch(blob.url);
      const content = await res.text();
      const path = blob.pathname.replace(prefix, "");
      return { id: path, name: path.split("/").pop() || path, path, content, url: blob.url };
    })
  );

  return NextResponse.json(files);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, content, path } = await req.json();
  const prefix = userPrefix(session.user.id);
  const filePath = path || name;

  const blob = await put(`${prefix}${filePath}`, content, {
    access: "public",
    contentType: "text/markdown",
    addRandomSuffix: false,
  });

  return NextResponse.json({
    id: filePath,
    name: filePath.split("/").pop() || filePath,
    path: filePath,
    content,
    url: blob.url,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { oldPath, newPath, url: oldUrl } = await req.json();
  const prefix = userPrefix(session.user.id);

  // Read old content
  const res = await fetch(oldUrl);
  const content = await res.text();

  // Create at new path
  const blob = await put(`${prefix}${newPath}`, content, {
    access: "public",
    contentType: "text/markdown",
    addRandomSuffix: false,
  });

  // Delete old
  await del(oldUrl);

  return NextResponse.json({
    id: newPath,
    name: newPath.split("/").pop() || newPath,
    path: newPath,
    content,
    url: blob.url,
  });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url } = await req.json();
  if (url) await del(url);

  return NextResponse.json({ ok: true });
}
