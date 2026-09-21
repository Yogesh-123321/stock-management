import { useSearchParams } from "react-router-dom";
import { Layers, ClipboardCheck } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import Kits from "@/pages/Kits";
import IqcTemplates from "@/pages/IqcTemplates";

/*
  One "Templates" section with an in-page tab per template type:
    - Kit templates  (needs "kit.manage")
    - IQC templates  (needs "iqc.manage")
  A user only sees the tabs they have the right for; if they hold just
  one of the two, the page shows just that tab. The active tab lives in
  the URL (?tab=kit | ?tab=iqc) so it survives a refresh and can be linked
  to. Both tabs stay mounted while you switch, so a half-filled form on one
  tab isn't lost when you peek at the other.
*/
export default function Templates() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();

  const canKit = can("kit.manage");
  const canIqc = can("iqc.manage");
  const available = [canKit && "kit", canIqc && "iqc"].filter(Boolean);

  if (available.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <p className="font-display text-base font-semibold">No access</p>
        <p className="mt-2 text-sm text-muted-foreground">
          You don't have permission to open this screen. Ask an admin to enable it for your account.
        </p>
      </div>
    );
  }

  const requested = params.get("tab");
  const tab = available.includes(requested) ? requested : available[0];

  return (
    <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
      <TabsList>
        {canKit && (
          <TabsTrigger value="kit" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" />
            Kit templates
          </TabsTrigger>
        )}
        {canIqc && (
          <TabsTrigger value="iqc" className="gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5" />
            IQC templates
          </TabsTrigger>
        )}
      </TabsList>

      {canKit && (
        <TabsContent value="kit" forceMount className="data-[state=inactive]:hidden">
          <Kits />
        </TabsContent>
      )}
      {canIqc && (
        <TabsContent value="iqc" forceMount className="data-[state=inactive]:hidden">
          <IqcTemplates />
        </TabsContent>
      )}
    </Tabs>
  );
}