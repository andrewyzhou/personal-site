import { NextResponse } from "next/server";
import { getContributions, getLatestCommit } from "@/lib/github";

export async function GET() {
  try {
    const [contributions, latestCommit] = await Promise.all([
      getContributions("andrewyzhou"),
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
