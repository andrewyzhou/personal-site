import ContentBrowser from "@/components/admin/ContentBrowser";
import AdminPage from "@/components/admin/AdminPage";

export default function AdminContentPage() {
  return (
    <AdminPage title="content" description="drafts are private; publishing and editing published entries commit to the site's repo, then the site redeploys">
      <ContentBrowser />
    </AdminPage>
  );
}
