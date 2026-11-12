import NextLink from "next/link";
import Image from "next/image";
import { desc } from "drizzle-orm";
import { Badge, Button, Card, EmptyState, Grid, Link, Stack, Table, Text } from "@/design-system";
import AdminPage from "@/components/admin/AdminPage";
import { getDb, activities } from "@/lib/db";
import { r2Usage } from "@/lib/r2";
import { formatMiles, formatClockDuration, sportIcon, DURATION_ONLY_TYPES } from "@/lib/activity-format";
import { log } from "@/lib/log";
import { isAdminViewer } from "./require-admin";

export const dynamic = "force-dynamic";

const R2_FREE_BYTES = 10_000_000_000;

const SHORTCUTS = [
  { label: "edit content", hint: "posts, notes, work, bio", href: "/admin/content" },
  { label: "activities", hint: "calendar, upload, clean up", href: "/admin/calendar" },
  { label: "listening", hint: "spotify sync", href: "/admin/listening" },
];

export default async function AdminDashboard() {
  if (!(await isAdminViewer())) return null;
  let recent: (typeof activities.$inferSelect)[] = [];
  try {
    recent = await getDb().select().from(activities).orderBy(desc(activities.startDateUtc)).limit(10);
  } catch (error) {
    log.error("admin:dashboard", "recent activities query failed", error);
  }

  let used: number | null = null;
  try {
    used = (await r2Usage()).totalBytes;
  } catch {
    used = null;
  }

  return (
    <AdminPage
      title="dashboard"
      actions={
        <Button href="/admin/upload" variant="primary" size="sm">
          upload activity
        </Button>
      }
    >
      <Grid min="13rem" gap="3">
        {SHORTCUTS.map((s) => (
          <NextLink key={s.href} href={s.href} className="adm-shortcut">
            <span className="adm-shortcut-label">{s.label}</span>
            <span className="adm-shortcut-hint">{s.hint}</span>
          </NextLink>
        ))}
      </Grid>

      <Card
        title="recent activities"
        actions={
          <Link href="/admin/calendar" variant="standalone" tone="muted">
            all activities
          </Link>
        }
        padded={recent.length === 0}
      >
        {recent.length === 0 ? (
          <EmptyState title="no activities yet" />
        ) : (
          <div className="adm-table-wrap">
            <Table
              rowKey={(a) => String(a.id)}
              rows={recent}
              columns={[
                {
                  key: "name",
                  header: "activity",
                  cell: (a) => (
                    <NextLink href={`/admin/activities/${a.id}`} className="adm-row-link">
                      <Image src={`/icons/activities/${sportIcon(a.sportType)}.svg`} alt="" width={16} height={16} className="adm-icon" />
                      <span>{a.name}</span>
                      {a.hidden ? <Badge>hidden</Badge> : null}
                    </NextLink>
                  ),
                },
                {
                  key: "stat",
                  header: "distance / time",
                  align: "right",
                  cell: (a) => (DURATION_ONLY_TYPES.has(a.sportType) || a.distanceM < 100 ? formatClockDuration(a.elapsedTimeS) : formatMiles(a.distanceM)),
                },
                { key: "date", header: "date", align: "right", cell: (a) => <span style={{ whiteSpace: "nowrap" }}>{a.localDate}</span> },
              ]}
            />
          </div>
        )}
      </Card>

      <Card title="storage">
        {used === null ? (
          <Text size="sm" tone="muted">
            r2 usage is unavailable right now
          </Text>
        ) : (
          <Stack gap="2">
            <Text size="sm">{`${(used / 1_000_000).toFixed(0)} mb used of the 10 gb free tier`}</Text>
            <div className="adm-meter" role="meter" aria-valuemin={0} aria-valuemax={R2_FREE_BYTES} aria-valuenow={used}>
              <span style={{ width: `${Math.max(0.5, Math.min(100, (used / R2_FREE_BYTES) * 100))}%` }} />
            </div>
          </Stack>
        )}
      </Card>
    </AdminPage>
  );
}
