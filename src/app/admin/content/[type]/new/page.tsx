import ContentEditorLoader from "@/components/admin/ContentEditorLoader";
import AdminPage from "@/components/admin/AdminPage";
import { getContentType } from "@/lib/admin/content-registry";
import { TYPE_NAMES } from "@/components/admin/type-names";

export default async function NewContentPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const label = getContentType(type)?.label ?? `${type} entry`;
  return (
    <AdminPage title={`new ${label}`} crumbs={[{ label: "content", href: "/admin/content" }, { label: TYPE_NAMES[type] ?? type, href: "/admin/content" }]}>
      <ContentEditorLoader typeId={type} slug={null} />
    </AdminPage>
  );
}
