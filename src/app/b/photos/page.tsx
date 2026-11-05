import type { Metadata } from "next";
import { Container, EmptyState, PageHeader } from "@/design-system";
import JustifiedLayout from "@/components/photos/JustifiedLayout";
import { getSite, pageTitle } from "@/content/site";
import { getAllPhotosets } from "@/lib/photos";

function hub() {
  return getSite().hubs.find((h) => h.id === "photos")!;
}

export function generateMetadata(): Metadata {
  return { title: pageTitle(getSite(), hub().label), description: hub().intro };
}

export default function PhotosHub() {
  const site = getSite();
  const sets = getAllPhotosets();
  return (
    <Container width="wide" className="ds-page">
      <PageHeader title={hub().label} titleSize="3xl" meta={[hub().intro]} />
      {sets.length ? <JustifiedLayout sets={sets} /> : <EmptyState title={site.pages.photos.empty} />}
    </Container>
  );
}
