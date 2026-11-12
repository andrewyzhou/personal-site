import type { ReactNode } from "react";
import { PageHeader, Stack, type Crumb } from "@/design-system";

// every admin page: a trail back up, one title size, an optional one-line
// description and the page's actions on the right; then its content, in
// cards, with even spacing.
export default function AdminPage({
  title,
  crumbs,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  crumbs?: Crumb[];
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        titleSize="2xl"
        crumbs={crumbs && crumbs.length ? [...crumbs, { label: typeof title === "string" ? title : "" }] : undefined}
        meta={description ? [description] : undefined}
        actions={actions ? <div className="adm-page-actions">{actions}</div> : undefined}
      />
      <Stack gap="6">{children}</Stack>
    </>
  );
}
