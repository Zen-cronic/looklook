import { DecisionsLoader } from "./DecisionsLoader";
import "./studio.css";

export const metadata = { title: "Dashboard" };

export default function StudioPage() {
  return (
    <main className="studio-page">
      <DecisionsLoader />
    </main>
  );
}
