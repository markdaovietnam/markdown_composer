import { hash } from "bcryptjs";
import { put, list } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const userId = email.toLowerCase().replace(/[^a-z0-9]/g, "_");

  const { blobs } = await list({ prefix: `users/${userId}/profile.json` });
  if (blobs.length > 0) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const passwordHash = await hash(password, 12);

  await put(
    `users/${userId}/profile.json`,
    JSON.stringify({ email: email.toLowerCase(), name: name || email, passwordHash }),
    { access: "public", contentType: "application/json", addRandomSuffix: false }
  );

  return NextResponse.json({ ok: true });
}
