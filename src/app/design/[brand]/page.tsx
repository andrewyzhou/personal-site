import { notFound } from "next/navigation";
import NextLink from "next/link";
import { Badge, Cluster, Heading, Stack, Text, getBrand } from "@/design-system";
import { DEFAULT_BRAND } from "@/design-system/brands";
import { SECTIONS } from "../_docs/registry";
import { PatternPreview } from "../_docs/Compare";

export default async function BrandOverview({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: id } = await params;
  const brand = getBrand(id);
  if (!brand) notFound();
  return (
    <div className="docs-content">
      <header>
        <Cluster gap="2">
          <Text size="sm" tone="subtle">
            design system · brand {brand.id.toUpperCase()}
          </Text>
          {brand.id === DEFAULT_BRAND ? <Badge tone="accent">chosen for v2</Badge> : null}
        </Cluster>
        <Heading level={1} size="display">
          {brand.name}
        </Heading>
        <p className="docs-lead">
          {brand.tagline}. {brand.description}
        </p>
      </header>

      <PatternPreview brand={brand.id} path="/training/464" />

      {SECTIONS.map((s) => (
        <Stack key={s.id} gap="4">
          <Heading level={2} size="xl">
            {s.title}
          </Heading>
          <div className="docs-cards">
            {s.pages.map((p) => (
              <NextLink key={p.slug} href={`/design/${brand.id}/${s.id}/${p.slug}`} className="docs-card">
                <Text tone="fg" weight="medium">
                  {p.title}
                </Text>
                <Text size="sm" tone="muted">
                  {p.summary}
                </Text>
              </NextLink>
            ))}
          </div>
        </Stack>
      ))}
    </div>
  );
}
