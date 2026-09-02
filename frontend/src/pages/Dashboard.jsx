import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import { PackagePlus, Users, Boxes, FileStack, ArrowRight } from "lucide-react";

const FLOW_STEPS = [
  {
    title: "Material arrives",
    body: "Received at the office — stock entry begins for that delivery.",
  },
  {
    title: "Check the vendor",
    body: "Look the vendor up by name. Registered & approved → continue. Not found → register them with the TISPL vendor form first, then wait for purchase-head approval.",
  },
  {
    title: "Upload the PO / proforma invoice",
    body: "Attach the purchase order or proforma invoice the material arrived against.",
  },
  {
    title: "Enter each part",
    body: "Part number matches an existing stack → quantity is added to it. No match → create a new part, optionally as an alternate of an existing one.",
  },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ vendors: 0, pendingVendors: 0, parts: 0, purchaseOrders: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [vendors, parts, pos] = await Promise.all([
          api.get("/vendors"),
          api.get("/parts"),
          api.get("/purchase-orders"),
        ]);
        setStats({
          vendors: vendors.data.length,
          pendingVendors: vendors.data.filter((v) => v.status === "pending").length,
          parts: parts.data.length,
          purchaseOrders: pos.data.length,
        });
      } catch {
        // backend not reachable yet — leave defaults
      }
    })();
  }, []);

  const cards = [
    { label: "Registered vendors", value: stats.vendors, sub: `${stats.pendingVendors} pending approval`, icon: Users },
    { label: "Parts in master DB", value: stats.parts, icon: Boxes },
    { label: "PO / invoices uploaded", value: stats.purchaseOrders, icon: FileStack },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Material receiving, vendor registration and stock entry in one place.
          </p>
        </div>
        <Button onClick={() => navigate("/receive")} size="lg">
          <PackagePlus className="h-4 w-4 mr-2" />
          Receive material
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {cards.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="font-mono-tech text-3xl font-semibold mt-1">{value}</p>
                  {sub && <p className="text-xs text-accent mt-1">{sub}</p>}
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">How the receiving flow works</CardTitle>
          <CardDescription>The "Receive material" wizard walks through each step below.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {FLOW_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-mono-tech text-xs font-semibold text-primary">
                  {i + 1}
                </div>
                <div>
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <button
            onClick={() => navigate("/receive")}
            className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Start receiving <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
