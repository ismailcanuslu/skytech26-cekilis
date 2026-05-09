import { CekilisClient } from "./cekilis-client";
import { loadParticipants } from "@/lib/loadParticipants";

export default async function Home() {
  const participants = await loadParticipants();
  return <CekilisClient participants={participants} />;
}
