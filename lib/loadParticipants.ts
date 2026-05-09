import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "katilimcilar.txt");

/** Fisher–Yates; crypto ile üretilmiş indeks (Math.random değil). */
function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Satır satır isimler; boş satırlar atılır; sıra her istekte yeniden karıştırılır. */
export async function loadParticipants(): Promise<string[]> {
  const raw = await readFile(FILE, "utf-8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return shuffle(lines);
}
