import { list, put, del } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

function versionPrefix(userId: string, filePath: string) {
  return `users/${userId}/versions/${filePath}/`;
}

function metaPath(userId: string, filePath: string) {
  return `users/${userId}/versions/${filePath}/_meta.json`;
}

async function loadMeta(userId: string, filePath: string): Promise<Record<string, string>> {
  const path = metaPath(userId, filePath);
  const { blobs } = await list({ prefix: path });
  if (blobs.length === 0) return {};
  try {
    const res = await fetch(blobs[0].url);
    return await res.json();
  } catch {
    return {};
  }
}

async function saveMeta(userId: string, filePath: string, meta: Record<string, string>) {
  const path = metaPath(userId, filePath);
  await put(path, JSON.stringify(meta), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
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
  const meta = await loadMeta(session.user.id, filePath);

  const versions = blobs
    .filter((blob) => !blob.pathname.endsWith("_meta.json"))
    .map((blob) => {
      const ts = blob.pathname.replace(prefix, "").replace(".md", "");
      const timestamp = parseInt(ts, 10);
      return {
        timestamp,
        url: blob.url,
        size: blob.size,
        name: meta[String(timestamp)] || "",
      };
    })
    .filter((v) => !isNaN(v.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);

  return NextResponse.json(versions);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filePath, content, name } = await req.json();
  if (!filePath || content == null) {
    return NextResponse.json({ error: "Missing filePath or content" }, { status: 400 });
  }

  const prefix = versionPrefix(session.user.id, filePath);
  const { blobs } = await list({ prefix });
  const contentBlobs = blobs.filter((b) => !b.pathname.endsWith("_meta.json"));

  if (contentBlobs.length > 0) {
    const latest = contentBlobs.sort((a, b) => {
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

  if (name) {
    const meta = await loadMeta(session.user.id, filePath);
    meta[String(ts)] = name;
    await saveMeta(session.user.id, filePath, meta);
  }

  const MAX_VERSIONS = 50;
  if (contentBlobs.length >= MAX_VERSIONS) {
    const sorted = contentBlobs.sort((a, b) => {
      const tsA = parseInt(a.pathname.replace(prefix, "").replace(".md", ""), 10);
      const tsB = parseInt(b.pathname.replace(prefix, "").replace(".md", ""), 10);
      return tsA - tsB;
    });
    const toDelete = sorted.slice(0, contentBlobs.length - MAX_VERSIONS + 1);
    await Promise.all(toDelete.map((b) => del(b.url)));
  }

  return NextResponse.json({ timestamp: ts, url: blob.url, name: name || "" });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filePath, timestamp, name } = await req.json();
  if (!filePath || !timestamp) {
    return NextResponse.json({ error: "Missing filePath or timestamp" }, { status: 400 });
  }

  const meta = await loadMeta(session.user.id, filePath);
  if (name) {
    meta[String(timestamp)] = name;
  } else {
    delete meta[String(timestamp)];
  }
  await saveMeta(session.user.id, filePath, meta);

  return NextResponse.json({ ok: true });
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
