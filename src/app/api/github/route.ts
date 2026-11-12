import { NextResponse } from "next/server";
import { getContributions, getLatestCommit } from "@/lib/github";

// ?year=2025 returns that calendar year; without it, the last twelve months
export async function GET(request: Request) {
  const asked = Number(new URL(request.url).searchParams.get("year"));
  const year = Number.isInteger(asked) && asked >= 2008 && asked <= new Date().getUTCFullYear() ? asked : undefined;
  try {
    const [contributions, latestCommit] = await Promise.all([
      getContributions("andrewyzhou", year),
      getLatestCommit("andrewyzhou", "personal-site").catch(() => null),
    ]);

    return NextResponse.json({
      weeks: contributions.weeks,
      totalContributions: contributions.totalContributions,
      latestCommit,
    });
  } catch (error) {
    console.error("github api error:", error);
    return NextResponse.json(
      { error: "failed to fetch github data" },
      { status: 500 }
    );
  }
}
