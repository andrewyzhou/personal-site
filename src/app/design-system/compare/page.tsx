import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "@/design-system/ds.css";
import { Container, Link, PageHeader, Stack, Text } from "@/design-system";
import { canViewDesignLab } from "../access";
import { DIRECTIONS } from "../specimens";
import { Compare } from "./Compare";

export const metadata: Metadata = { title: "compare directions", robots: { index: false } };

export default async function ComparePage() {
  if (!(await canViewDesignLab())) notFound();
  const directions = Object.entries(DIRECTIONS).map(([id, d]) => ({ id, name: d.name }));
  return (
    <div className="ds" style={{ minHeight: "100vh" }}>
      <Container width="wide" className="ds-page">
        <Stack gap="6">
          <PageHeader
            crumbs={[{ label: "design system", href: "/design-system" }, { label: "compare" }]}
            title="three directions"
            meta={["same tokens, same components, same content", "different shell, accent and gray temperature"]}
          />
          <Text tone="muted">
            each frame is the real page at its real width, scaled down. click around inside a frame to move between specimen pages.{" "}
            <Link href="/design-system" variant="inline">
              tokens and components
            </Link>
          </Text>
          <Compare directions={directions} />
        </Stack>
      </Container>
    </div>
  );
}
