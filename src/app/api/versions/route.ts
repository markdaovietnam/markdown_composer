import { list, put, del } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

function versionPrefix(userId: string, filePath: string) {
  return `users/${userId}/versions/${filePath}/`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filePath = req.nextUrl.searchParams.get("file");
  if (!filePath) {
    return NextResponse.json({ error: "Missing file param" }, { status: 400 });
  }

  const prefix = versionPrefix(session.user.id, filePath);
  const { blobs } = await list({ prefix });

  const versions = blobs
    .map((blob) => {
      const ts = blob.pathname.replace(prefix, "").replace(".md", "");
      return {
        timestamp: parseInt(ts, 10),
        url: blob.url,
        size: blob.size,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  return NextResponse.json(versions);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filePath, content } = await req.json();
  if (!filePath || content == null) {
    return NextResponse.json({ error: "Missing filePath or content" }, { status: 400 });
  }

  const prefix = versionPrefix(session.user.id, filePath);
  const { blobs } = await list({ prefix });

  if (blobs.length > 0) {
    const latest = blobs.sort((a, b) => {
      const tsA = parseInt(a.pathname.replace(prefix, "").replace(".md", ""), 10);
      const tsB = parseInt(b.pathname.replace(prefix, "").replace(".md", ""), 10);
      return tsB - tsA;
    })[0];
    const res = await fetch(latest.url);
    const lastContent = await res.text();
    if (lastContent === content) {
      return NextResponse.json({ skipped: true });
    }
  }

  const ts = Date.now();
  const blob = await put(`${prefix}${ts}.md`, content, {
    access: "public",
    contentType: "text/markdown",
    addRandomSuffix: false,
  });

  const MAX_VERSIONS = 50;
  if (blobs.length >= MAX_VERSIONS) {
    const sorted = blobs.sort((a, b) => {
      const tsA = parseInt(a.pathname.replace(prefix, "").replace(".md", ""), 10);
      const tsB = parseInt(b.pathname.replace(prefix, "").replace(".md", ""), 10);
      return tsA - tsB;
    });
    const toDelete = sorted.slice(0, blobs.length - MAX_VERSIONS + 1);
    await Promise.all(toDelete.map((b) => del(b.url)));
  }

  return NextResponse.json({ timestamp: ts, url: blob.url });
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
