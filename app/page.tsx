import Planner from "@/components/planner";
import { getSchedule } from "@/lib/schedule";

/**
 * Re-fetch the FPL API at most once an hour; fixtures and FDR rarely move faster.
 * force-static keeps the page on ISR even though bootstrap-static is fetched
 * uncached (it is too large for Next's data cache). The /api/schedule route
 * stays dynamic, so the in-app Refresh button always gets live data.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

export default async function Home() {
  const schedule = await getSchedule(revalidate);
  return (
    <main className="flex-1">
      <Planner initial={schedule} />
    </main>
  );
}
