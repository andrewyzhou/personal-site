import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Container, Icon, Link, PageHeader, Stack, StatGrid, Text } from "@/design-system";
import ActivityMapSection from "@/components/activity-map/ActivityMapSection";
import ActivityMetricsSection from "@/components/activity-metrics/ActivityMetricsSection";
import ActivityPhotoCarousel from "@/components/ActivityPhotoCarousel";
import EngagementSection from "@/components/EngagementSection";
import LiftWorkoutCard from "@/components/lift/LiftWorkoutCard";
import { getSite } from "@/content/site";
import { loadActivityPage, loadActivityRow } from "@/content/activity";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const row = await loadActivityRow((await params).id);
  return { title: row ? `${row.name} · activity · andrew zhou` : "activity · andrew zhou" };
}

// one session: numbers first, then the map, then everything else
export default async function HubActivity({ params }: { params: Promise<{ id: string }> }) {
  const page = await loadActivityPage((await params).id);
  if (!page) notFound();
  const site = getSite();
  const training = site.hubs.find((h) => h.id === "training")!;
  const { row, a, lifts, metrics, fog, stats, dateLine, timeLine } = page;
  const key = stats.slice(0, 4);
  const rest = stats.slice(4);

  return (
    <Container className="ds-page">
      <PageHeader
        crumbs={[{ label: training.label, href: training.href }, { label: a.name }]}
        leading={<Icon src={`/icons/activities/${page.icon}.svg`} size="1.75rem" />}
        title={a.name}
        titleSize="3xl"
        meta={[dateLine, timeLine, page.sport, ...(a.gear ? [a.gear] : [])]}
        actions={
          <Link href="/activities/records" variant="standalone" tone="muted">
            {site.pages.records.link}
          </Link>
        }
      />
      <Stack gap="10">
        <StatGrid stats={key} size="hero" columns={4} />

        {a.polyline && a.bounds ? (
          <Stack gap="2">
            <ActivityMapSection activityId={row.id} polyline={a.polyline} bounds={a.bounds} fogShapes={a.fogShapes} photos={a.photos} sportType={a.type} />
            {fog && (
              <Text size="xs" tone="subtle">
                {fog}
              </Text>
            )}
          </Stack>
        ) : fog ? (
          <Text size="sm" tone="subtle">
            {fog}
          </Text>
        ) : null}

        {rest.length > 0 && <StatGrid stats={rest} size="sm" columns={4} />}

        <ActivityMetricsSection metrics={metrics} hrZonesS={a.hrZonesS} movingS={a.duration} elapsedS={a.elapsedTime} />

        {a.description && (
          <Text size="lg" tone="default">
            {a.description}
          </Text>
        )}

        {lifts.map((w, i) => (
          <LiftWorkoutCard key={`${w.date}:${i}`} workout={w} />
        ))}

        <ActivityPhotoCarousel photos={a.photos} />

        <EngagementSection target={`activity:${row.id}`} />
      </Stack>
    </Container>
  );
}
