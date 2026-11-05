import { notFound } from "next/navigation";
import NextLink from "next/link";
import { Text, getBrand } from "@/design-system";
import { SECTIONS, findPage } from "../../../_docs/registry";
import { DocHeader } from "../../../_docs/kit";
import { FOUNDATIONS } from "../../../_docs/foundations";
import { COMPONENTS } from "../../../_docs/components";
import { BRAND_PAGES, PATTERNS } from "../../../_docs/patterns";

const RENDER = { foundations: FOUNDATIONS, components: COMPONENTS, patterns: PATTERNS, brands: BRAND_PAGES };

export default async function DocPage({ params }: { params: Promise<{ brand: string; section: string; slug: string }> }) {
  const { brand: id, section, slug } = await params;
  const brand = getBrand(id);
  const found = findPage(section, slug);
  const render = found ? RENDER[found.section.id][slug] : undefined;
  if (!brand || !found || !render) notFound();

  // previous / next across the whole sidebar order
  const flat = SECTIONS.flatMap((s) => s.pages.map((p) => ({ s, p })));
  const i = flat.findIndex((x) => x.s.id === section && x.p.slug === slug);
  const prev = flat[i - 1];
  const next = flat[i + 1];

  return (
    <div className="docs-content">
      <DocHeader eyebrow={found.section.title} title={found.page.title} lead={found.page.summary} />
      {render(brand)}
      <nav className="docs-pager" aria-label="pages">
        {prev ? (
          <NextLink href={`/design/${brand.id}/${prev.s.id}/${prev.p.slug}`} className="ds-link" data-variant="nav">
            <Text size="xs" tone="subtle">
              previous
            </Text>
            ← {prev.p.title}
          </NextLink>
        ) : (
          <span />
        )}
        {next ? (
          <NextLink href={`/design/${brand.id}/${next.s.id}/${next.p.slug}`} className="ds-link" data-variant="nav" style={{ textAlign: "right" }}>
            <Text size="xs" tone="subtle">
              next
            </Text>
            {next.p.title} →
          </NextLink>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
