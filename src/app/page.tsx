import { cookies } from "next/headers";
import { db } from "@/db";
import { adminSettings } from "@/db/schema";
import { ensureBootstrap } from "@/db/bootstrap";
import { verifySenderToken, SENDER_COOKIE_NAME } from "@/lib/auth";
import { SenderApp } from "@/components/sender/SenderApp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureBootstrap();

  const cookieStore = await cookies();
  const token = cookieStore.get(SENDER_COOKIE_NAME)?.value;
  const payload = await verifySenderToken(token);

  let initiallyUnlocked = false;
  if (payload) {
    const [settings] = await db.select().from(adminSettings).limit(1);
    initiallyUnlocked = !!settings && settings.passwordVersion === payload.pv;
  }

  return <SenderApp initiallyUnlocked={initiallyUnlocked} />;
}
