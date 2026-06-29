import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import OpenAI from "openai";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const { text, prompt } = await req.json();
  if (!text || !prompt) {
    return NextResponse.json({ error: "Missing text or prompt" }, { status: 400 });
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a writing assistant. Rewrite the given text according to the user's instructions. Return ONLY the rewritten text, no explanations or extra formatting. Preserve the original markdown formatting style (headings, lists, bold, etc.) unless the user asks to change it.",
        },
        {
          role: "user",
          content: `Original text:\n\`\`\`\n${text}\n\`\`\`\n\nInstruction: ${prompt}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const result = completion.choices[0]?.message?.content?.trim() || text;
    return NextResponse.json({ result });
  } catch (err) {
    console.error("OpenAI error:", err);
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}
