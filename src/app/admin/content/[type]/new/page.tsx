import ContentEditorLoader from "@/components/admin/ContentEditorLoader";
import AdminPage from "@/components/admin/AdminPage";

export default async function NewContentPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return (
    <AdminPage title={`new ${type} entry`} crumbs={[{ label: "content", href: "/admin/content" }, { label: type, href: "/admin/content" }]}>
      <ContentEditorLoader typeId={type} slug={null} />
    </AdminPage>
  );
}
