import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import ReceiveMaterial from "@/pages/ReceiveMaterial";
import Vendors from "@/pages/Vendors";
import Buyers from "@/pages/Buyers";
import Parts from "@/pages/Parts";
import PartCategories from "@/pages/PartCategories";
import Templates from "@/pages/Templates";
import IssueKit from "@/pages/IssueKit";
import Documents from "@/pages/Documents";
import PiGenerator from "@/pages/PiGenerator";
import PoGenerator from "@/pages/PoGenerator";
import Login from "@/pages/Login";
import Users from "@/pages/Users";
import Approvals from "@/pages/Approvals";
import { AuthProvider, RequireAuth, RequirePermission } from "@/lib/auth";
import ActivityLog from "@/pages/ActivityLog";
const guard = (permission, element) => (
  <RequirePermission permission={permission}>{element}</RequirePermission>
);

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/receive" element={guard("receive.manage", <ReceiveMaterial />)} />
          <Route path="/vendors" element={guard("vendor.create", <Vendors />)} />
          <Route path="/buyers" element={guard("buyer.create", <Buyers />)} />
          <Route path="/parts" element={<Parts />} />
          <Route path="/part-categories" element={guard("part.approve", <PartCategories />)} />
          {/* Kit + IQC templates now share one Templates page (tabs) — the tabs check their own rights. */}
          <Route path="/templates" element={<Templates />} />
          <Route path="/iqc-templates" element={<Navigate to="/templates?tab=iqc" replace />} />
          {/* IQC stock now lives inside Parts master (MISC stock column) — keep old links working. */}
          <Route path="/iqc-stock" element={<Navigate to="/parts" replace />} />
          <Route path="/kits" element={<Navigate to="/templates?tab=kit" replace />} />
          <Route path="/issue-kit" element={guard("kit.issue", <IssueKit />)} />
          <Route path="/documents" element={guard("documents.view", <Documents />)} />
          <Route path="/purchase-orders" element={<Navigate to="/documents" replace />} />
          <Route path="/pi-generator" element={guard("pi.create", <PiGenerator />)} />
          <Route path="/po-generator" element={guard("po.create", <PoGenerator />)} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/users" element={guard("users.manage", <Users />)} />
        <Route path="/activity-log" element={guard("logs.view", <ActivityLog />)} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}