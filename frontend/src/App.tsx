import { Routes, Route, Navigate } from "react-router-dom";
import Overview from "./screens/Overview";
import Accounts from "./screens/Accounts";
import Transactions from "./screens/Transactions";
import Goals from "./screens/Goals";
import Settings from "./screens/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/overview" element={<Overview />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/transactions" element={<Transactions />} />
      <Route path="/goals" element={<Goals />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
