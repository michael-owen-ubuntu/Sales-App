import { HashRouter } from "react-router-dom";
import { AuthGate } from "./app/auth";
import "./index.css";

export default function App() {
  return (
    <HashRouter>
      <AuthGate />
    </HashRouter>
  );
}
