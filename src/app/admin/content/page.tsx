import ContentBrowser from "@/components/admin/ContentBrowser";
import AdminPage from "@/components/admin/AdminPage";

export default function AdminContentPage() {
  return (
    <AdminPage title="content" description="every edit saves as a commit to the site's repo, then the site redeploys">
      <ContentBrowser />
    </AdminPage>
  );
}
