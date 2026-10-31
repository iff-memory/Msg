import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-guard";
import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) {
    redirect("/admin");
  }
  return <LoginForm />;
}
