import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-guard";
import { Dashboard } from "@/components/admin/Dashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  return <Dashboard username={session.username} />;
}
