import { NextResponse } from "next/server";
import { incrementApiCalls } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // increment and return both previous and new count
    const { prevCount, apiCalls } = await incrementApiCalls();
    return NextResponse.json({ prevCount, apiCalls });
  } catch (error) {
    console.error("stats api error:", error);
    return NextResponse.json({ prevCount: 0, apiCalls: 0 }, { status: 500 });
  }
}
