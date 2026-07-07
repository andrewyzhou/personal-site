import Link from "next/link";
import LeetCodeForm from "@/components/admin/LeetCodeForm";

export default function AdminLeetCodePage() {
  return (
    <div>
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/admin" className="font-sans text-gray text-sm link-highlight">
          ← dashboard
        </Link>
      </p>
      <LeetCodeForm />
    </div>
  );
}
