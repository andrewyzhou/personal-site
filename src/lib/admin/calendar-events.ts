// merged event feed for the admin calendar: activities (neon), leetcode
// submissions (redis store), github commit days, and content entries (github
// tree). every source fails independently.

import { desc, eq, and, gte, lte, inArray, asc } from "drizzle-orm";
import { getDb, activities, activityPhotos } from "@/lib/db";
import { readStoredSubmissions } from "@/lib/leetcode-sync";
import { getContributions } from "@/lib/github";
import { listEntries } from "./content-store";
import { CONTENT_TYPES } from "./content-registry";
import { log } from "@/lib/log";

export type AdminCalendarEvent =
  | { kind: "activity"; id: number; date: string; startTime: string; type: string; name: string; thumb?: string }
  | { kind: "leetcode"; sha: string; date: string; problemNumber: number; problemTitle: string; difficulty: string; url: string }
  | { kind: "commit"; date: string; count: number }
  | { kind: "blog" | "library" | "photos"; slug: string; date: string; title: string; status: "published" | "wip"; thumb?: string };

export interface AdminCalendarPayload {
  events: AdminCalendarEvent[];
  sources: Record<"activities" | "leetcode" | "commits" | "content", "ok" | "error">;
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= `${from}-01` && date <= `${to}-31`;
}

async function activityEvents(from: string, to: string): Promise<AdminCalendarEvent[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: activities.id,
      date: activities.localDate,
      startTime: activities.localTime,
      type: activities.sportType,
      name: activities.name,
    })
    .from(activities)
    .where(and(eq(activities.hidden, false), gte(activities.localDate, `${from}-01`), lte(activities.localDate, `${to}-31`)))
    .orderBy(desc(activities.localDate));

  // first photo per activity in range → day-cell thumbnail
  const firstPhoto = new Map<number, string>();
  if (rows.length > 0) {
    const photoRows = await db
      .select({ activityId: activityPhotos.activityId, url: activityPhotos.blobUrl })
      .from(activityPhotos)
      .where(inArray(activityPhotos.activityId, rows.map((r) => r.id)))
      .orderBy(asc(activityPhotos.activityId), asc(activityPhotos.position));
    for (const p of photoRows) {
      if (!firstPhoto.has(p.activityId)) firstPhoto.set(p.activityId, p.url);
    }
  }

  return rows.map((r) => {
    const thumb = firstPhoto.get(r.id);
    return { kind: "activity" as const, ...r, ...(thumb ? { thumb } : {}) };
  });
}

async function leetcodeEvents(from: string, to: string): Promise<AdminCalendarEvent[]> {
  const stored = await readStoredSubmissions();
  if (!stored) return [];
  return stored.submissions
    .filter((s) => inRange(s.date, from, to))
    .map((s) => ({
      kind: "leetcode" as const,
      sha: s.sha,
      date: s.date,
      problemNumber: s.problemNumber,
      problemTitle: s.problemTitle,
      difficulty: s.difficulty,
      url: s.url,
    }));
}

async function commitEvents(from: string, to: string): Promise<AdminCalendarEvent[]> {
  const contributions = await getContributions("andrewyzhou");
  const events: AdminCalendarEvent[] = [];
  for (const week of contributions.weeks) {
    for (const day of week.days) {
      if (day.count > 0 && inRange(day.date, from, to)) {
        events.push({ kind: "commit", date: day.date, count: day.count });
      }
    }
  }
  return events;
}

async function contentEvents(from: string, to: string): Promise<AdminCalendarEvent[]> {
  const events: AdminCalendarEvent[] = [];
  for (const typeId of ["blog", "library", "photos"] as const) {
    const t = CONTENT_TYPES[typeId];
    const { items } = await listEntries(t);
    for (const item of items) {
      const fm = item.frontmatter as Record<string, unknown>;
      const date =
        typeId === "library"
          ? ((fm.dateCompleted ?? fm.dateStarted) as string | undefined)
          : (fm.date as string | undefined);
      if (!date || typeof date !== "string" || !inRange(date, from, to)) continue;

      let thumb: string | undefined;
      if ((typeId === "blog" || typeId === "library") && typeof fm.cover === "string") thumb = fm.cover;
      if (typeId === "photos") {
        if (typeof fm.cover === "string") thumb = `/photos/${item.slug}/${fm.cover}`;
        else if (typeof (fm.cover as Record<string, unknown>)?.src === "string")
          thumb = (fm.cover as { src: string }).src;
      }

      events.push({
        kind: typeId,
        slug: item.slug,
        date,
        title: (fm.title as string) ?? item.slug,
        status: item.status,
        ...(thumb ? { thumb } : {}),
      });
    }
  }
  return events;
}

export async function getCalendarEvents(from: string, to: string): Promise<AdminCalendarPayload> {
  const sources: AdminCalendarPayload["sources"] = {
    activities: "ok",
    leetcode: "ok",
    commits: "ok",
    content: "ok",
  };

  const results = await Promise.allSettled([
    activityEvents(from, to),
    leetcodeEvents(from, to),
    commitEvents(from, to),
    contentEvents(from, to),
  ]);

  const names = ["activities", "leetcode", "commits", "content"] as const;
  const events: AdminCalendarEvent[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      events.push(...r.value);
    } else {
      sources[names[i]] = "error";
      log.warn("admin:calendar", `source ${names[i]} failed`, r.reason);
    }
  });

  events.sort((a, b) => b.date.localeCompare(a.date));
  return { events, sources };
}
