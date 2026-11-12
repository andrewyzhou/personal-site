import ContentEditorLoader from "@/components/admin/ContentEditorLoader";
import AdminPage from "@/components/admin/AdminPage";

const SINGLETONS = new Set(["bio", "sections", "coursework", "hero-quotes"]);

export default async function EditContentPage({ params }: { params: Promise<{ type: string; slug: string }> }) {
  const { type, slug } = await params;
  const single = SINGLETONS.has(type);
  return (
    <AdminPage title={single ? type.replace("-", " ") : slug} crumbs={[{ label: "content", href: "/admin/content" }, ...(single ? [] : [{ label: type, href: "/admin/content" }])]}>
      <ContentEditorLoader typeId={type} slug={slug} />
    </AdminPage>
  );
}
