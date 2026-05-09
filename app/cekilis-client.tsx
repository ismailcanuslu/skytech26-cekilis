"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

const DRAW_DURATION_MS = 15000;
const STAGE_DURATIONS = [7000, 6000, 4000, 3000] as const;
const STAGE_RATES_PER_SEC = [34, 18, 7, 1.4] as const;
const FINAL_COAST_MS = 2200;
const REEL_CARD_WIDTH = 170;
const REEL_VISIBLE_CARDS = 7;
/** Gorunur + tampon; cok az DOM dugumu (~19). */
const REEL_BUFFER = 6;
const REEL_SLOT_COUNT = REEL_VISIBLE_CARDS + REEL_BUFFER * 2;

function modIndex(n: number, len: number) {
  return ((n % len) + len) % len;
}

type Props = {
  participants: string[];
};

export function CekilisClient({ participants }: Props) {
  const list = participants;
  const [winners, setWinners] = useState<(string | null)[]>([null, null, null]);
  const [backups, setBackups] = useState<string[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [winnerGlow, setWinnerGlow] = useState(false);
  const winnersRef = useRef<(string | null)[]>([null, null, null]);
  const backupsRef = useRef<string[]>([]);
  const timeoutsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const stripRef = useRef<HTMLUListElement>(null);
  const nameSlotRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const updateStrip = (cursor: number, pool: string[]) => {
    if (!pool.length) return;
    const strip = stripRef.current;
    if (!strip) return;
    const base = Math.floor(cursor) - REEL_BUFFER;
    const txPx = -(cursor - base) * REEL_CARD_WIDTH;
    strip.style.setProperty("--reel-tx", `${txPx}px`);
    const len = pool.length;
    for (let j = 0; j < REEL_SLOT_COUNT; j += 1) {
      const idx = modIndex(base + j, len);
      const el = nameSlotRefs.current[j];
      if (el) el.textContent = pool[idx];
    }
  };

  const availableParticipants = useMemo(() => {
    const used = new Set([...winners.filter(Boolean), ...backups]);
    return list.filter((name) => !used.has(name));
  }, [winners, backups, list]);

  const schedule = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
  };
  const cleanupTimers = () => {
    timeoutsRef.current.forEach((id) => clearTimeout(id));
    timeoutsRef.current = [];
  };
  const cleanupRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const playTick = () => {
    try {
      const audioCtx = audioCtxRef.current ?? new window.AudioContext();
      audioCtxRef.current = audioCtx;
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "square";
      osc.frequency.value = 1750;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.035);
    } catch {
      // Ses oynatimi tarayici tarafinda engellenirse sessiz devam.
    }
  };

  const playWin = () => {
    try {
      const audioCtx = audioCtxRef.current ?? new window.AudioContext();
      audioCtxRef.current = audioCtx;
      const base = audioCtx.currentTime;
      const notes = [880, 1174, 1567];

      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const start = base + idx * 0.06;
        const end = start + 0.22;

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.07, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(end);
      });
    } catch {
      // Tarayici sesi engellerse sessiz devam.
    }
  };

  const stageSpeed = (elapsedMs: number) => {
    const [d1, d2, d3, d4] = STAGE_DURATIONS;
    const [r1, r2, r3, r4] = STAGE_RATES_PER_SEC;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    if (elapsedMs < d1) return lerp(r1, r2, elapsedMs / d1);
    if (elapsedMs < d1 + d2) return lerp(r2, r3, (elapsedMs - d1) / d2);
    if (elapsedMs < d1 + d2 + d3) return lerp(r3, r4, (elapsedMs - d1 - d2) / d3);
    return lerp(r4, 0.38, Math.min(1, (elapsedMs - d1 - d2 - d3) / d4));
  };

  const runSingleDraw = (mode: "winner" | "backup", slotIndex?: number) =>
    new Promise<void>((resolve) => {
      const snapshotWinners = winnersRef.current.filter(Boolean) as string[];
      const snapshotBackups = backupsRef.current;
      const used = new Set([...snapshotWinners, ...snapshotBackups]);
      const pool = list.filter((name) => !used.has(name));

      if (!pool.length) {
        resolve();
        return;
      }

      const randomBaseLaps = 16 + Math.floor(Math.random() * 8);
      const randomStartOffset = Math.floor(Math.random() * pool.length);
      const startCursor = pool.length * randomBaseLaps + randomStartOffset;
      setWinnerGlow(false);

      const start = performance.now();
      let lastFrame = start;
      let localCursor = startCursor;
      let tickIndex = Math.floor(localCursor);
      let finalWinner: string = pool[0];
      const finalStageStart = DRAW_DURATION_MS;
      const coastMs = FINAL_COAST_MS + Math.floor(Math.random() * 700);
      const finalStageEnd = DRAW_DURATION_MS + coastMs;
      const finalStartSpeed = stageSpeed(DRAW_DURATION_MS) * (0.9 + Math.random() * 0.35);
      const finalDecel = finalStartSpeed / (coastMs / 1000);

      const animate = (now: number) => {
        const dtSec = Math.max(0, (now - lastFrame) / 1000);
        lastFrame = now;
        const elapsed = now - start;

        if (elapsed < finalStageStart) {
          localCursor += stageSpeed(elapsed) * dtSec;
        } else if (elapsed < finalStageEnd) {
          const tSec = (elapsed - finalStageStart) / 1000;
          const currentSpeed = Math.max(0, finalStartSpeed - finalDecel * tSec);
          localCursor += currentSpeed * dtSec;
        } else {
          const snappedCursor = Math.round(localCursor);
          const winnerIndex =
            (snappedCursor + Math.floor(REEL_VISIBLE_CARDS / 2)) % pool.length;
          finalWinner = pool[winnerIndex];
          updateStrip(snappedCursor, pool);
          setWinnerGlow(true);
          playWin();
          if (mode === "winner" && typeof slotIndex === "number") {
            setWinners((prev) => {
              const next = [...prev];
              next[slotIndex] = finalWinner;
              winnersRef.current = next;
              return next;
            });
          } else {
            setBackups((prev) => {
              const next = [...prev, finalWinner];
              backupsRef.current = next;
              return next;
            });
          }
          schedule(() => {
            setWinnerGlow(false);
            resolve();
          }, 950);
          return;
        }

        const currentTick = Math.floor(localCursor);
        const crossed = currentTick - tickIndex;
        if (crossed > 0) {
          for (let i = 0; i < Math.min(3, crossed); i += 1) playTick();
          tickIndex = currentTick;
        }

        updateStrip(localCursor, pool);
        rafRef.current = requestAnimationFrame(animate);
      };

      cleanupRaf();
      rafRef.current = requestAnimationFrame(() => {
        updateStrip(localCursor, pool);
        rafRef.current = requestAnimationFrame(animate);
      });
    });

  const startDraw = async () => {
    if (isDrawing || list.length === 0) return;
    cleanupTimers();
    cleanupRaf();
    setIsDrawing(true);
    setHasStarted(true);
    setBackups([]);
    backupsRef.current = [];
    setWinners([null, null, null]);
    winnersRef.current = [null, null, null];

    await runSingleDraw("winner", 0);
    await runSingleDraw("winner", 1);
    await runSingleDraw("winner", 2);

    setIsDrawing(false);
  };

  const drawBackup = async () => {
    if (isDrawing || !hasStarted || availableParticipants.length === 0 || list.length === 0) return;
    cleanupTimers();
    cleanupRaf();
    setIsDrawing(true);
    await runSingleDraw("backup");
    setIsDrawing(false);
  };

  useEffect(() => {
    return () => {
      cleanupTimers();
      cleanupRaf();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  const centerCard = Math.floor(REEL_VISIBLE_CARDS / 2);

  const emptyList = list.length === 0;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#030712] text-slate-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        aria-hidden
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(34,211,238,0.24), transparent), radial-gradient(ellipse 70% 40% at 100% 60%, rgba(251,191,36,0.12), transparent), linear-gradient(rgba(148,163,184,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.22) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 100% 100%, 44px 44px, 44px 44px",
        }}
      />

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center justify-center px-4 py-10 text-center sm:px-6">
        <div className="mb-3 flex items-center gap-3 sm:mb-5 sm:gap-4">
          <Image src="/favicon.webp" alt="ETUBMT logosu" width={76} height={76} className="h-auto w-auto" />
          <span className="font-[family-name:var(--font-orbitron)] text-3xl text-cyan-300 sm:text-4xl">x</span>
          <Image
            src="/cekilis-sponsor/logo_gunisigi_dark_web.png"
            alt="Gunisigi Kafe logosu"
            width={122}
            height={56}
            priority
            className="h-auto w-auto object-contain"
          />
          <span className="font-[family-name:var(--font-orbitron)] text-3xl text-cyan-300 sm:text-4xl">x</span>
          <Image
            src="/cekilis-sponsor/etkinkampus.webp"
            alt="EtkinKampus logosu"
            width={90}
            height={44}
            className="h-auto w-auto object-contain"
          />
          <span className="font-[family-name:var(--font-orbitron)] text-3xl text-cyan-300 sm:text-4xl">x</span>
          <Image
            src="/cekilis-sponsor/teol-logo.webp"
            alt="TEOL logosu"
            width={98}
            height={49}
            className="h-auto w-auto object-contain"
          />
        </div>

        <h1 className="font-[family-name:var(--font-orbitron)] text-3xl font-bold tracking-tight text-white sm:text-6xl">
          SKYTECH<span className="text-amber-300">26</span> x ETUBMT
        </h1>

        <div className="mt-8 flex flex-col items-center gap-4">
          <p className="text-base text-slate-200 sm:text-xl">
            <span className="font-bold text-amber-300 [text-shadow:0_0_10px_rgba(251,191,36,0.35)]">
              EtkinKampüs
            </span>{" "}
            &{" "}
            <span className="font-bold text-amber-300 [text-shadow:0_0_10px_rgba(251,191,36,0.35)]">
              GünIşığı Kafe
            </span>{" "}
            &{" "}
            <span className="font-bold text-amber-300 [text-shadow:0_0_10px_rgba(251,191,36,0.35)]">
              TEOL
            </span>{" "}
            sponsorluğunda çekilişimiz başlıyor.
          </p>
          {emptyList && (
            <p className="max-w-md text-sm text-red-300">
              Katilimci listesi bos veya data/katilimcilar.txt okunamadi.
            </p>
          )}
          {hasStarted && !emptyList && (
            <div
              className="relative overflow-hidden bg-slate-900/65"
              style={{ width: REEL_CARD_WIDTH * REEL_VISIBLE_CARDS, height: 74 }}
            >
              <div
                className={`pointer-events-none absolute top-0 bottom-0 z-10 ${winnerGlow ? "bg-amber-300/28" : "bg-slate-300/20"
                  } transition-colors duration-300`}
                style={{
                  left: centerCard * REEL_CARD_WIDTH,
                  width: REEL_CARD_WIDTH,
                  boxShadow: winnerGlow ? "0 0 42px rgba(251,191,36,0.5) inset" : "none",
                }}
              />
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20"
                style={{
                  left: centerCard * REEL_CARD_WIDTH + REEL_CARD_WIDTH / 2 - 1.5,
                  width: 3,
                  background: "linear-gradient(180deg, rgba(248,113,113,0.25), rgba(239,68,68,0.95), rgba(248,113,113,0.25))",
                  boxShadow: "0 0 20px rgba(239,68,68,0.7)",
                }}
              />
              <ul
                ref={stripRef}
                className="relative flex"
                style={{
                  transform: "translateX(var(--reel-tx, 0px))",
                  willChange: "transform",
                  width: REEL_SLOT_COUNT * REEL_CARD_WIDTH,
                }}
              >
                {Array.from({ length: REEL_SLOT_COUNT }, (_, j) => (
                  <li
                    key={`slot-${j}`}
                    className="relative flex h-[74px] items-center justify-center px-3 font-[family-name:var(--font-orbitron)] text-sm text-slate-200"
                    style={{ width: REEL_CARD_WIDTH, flex: `0 0 ${REEL_CARD_WIDTH}px` }}
                  >
                    <span
                      className="pointer-events-none absolute right-0 top-2 bottom-2 w-px opacity-70"
                      style={{
                        background:
                          "linear-gradient(180deg, rgba(248,113,113,0.1), rgba(239,68,68,0.9), rgba(248,113,113,0.1))",
                        boxShadow: "0 0 8px rgba(239,68,68,0.45)",
                      }}
                    />
                    <span
                      ref={(el) => {
                        nameSlotRefs.current[j] = el;
                      }}
                      className="block max-w-full truncate text-center"
                    >
                      —
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-400 sm:text-sm">
            Kalan havuz: {availableParticipants.length} kişi
          </p>
        </div>

        <button
          type="button"
          onClick={startDraw}
          disabled={isDrawing || emptyList}
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-md bg-cyan-400 px-8 py-3 font-[family-name:var(--font-orbitron)] text-sm font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-500"
        >
          {isDrawing ? "Cekılıs Devam Edıyor" : "Cekılsı Baslat"}
        </button>

        {hasStarted && (
          <button
            type="button"
            onClick={drawBackup}
            disabled={isDrawing || availableParticipants.length === 0 || emptyList}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-amber-300 px-6 py-2 font-[family-name:var(--font-orbitron)] text-xs font-semibold uppercase tracking-[0.2em] text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-slate-500"
          >
            {isDrawing ? "Yedek Cekılıyor" : "Yedek Cek"}
          </button>
        )}

        <section className="mt-10 w-full max-w-4xl">
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
            <div className="order-2 sm:order-1">
              <div className="bg-slate-900/70 px-4 py-4 text-center">
                <p className="font-[family-name:var(--font-orbitron)] text-[11px] uppercase tracking-[0.2em] text-slate-300">
                  2. Kazanan
                </p>
                <p className="mt-2 min-h-6 text-sm text-white">{winners[1] ?? "-"}</p>
              </div>
              <div className="h-16 bg-slate-700/60" />
            </div>

            <div className="order-1 sm:order-2">
              <div className="bg-amber-300/15 px-4 py-4 text-center shadow-[0_0_36px_rgba(251,191,36,0.25)]">
                <p className="font-[family-name:var(--font-orbitron)] text-[11px] uppercase tracking-[0.24em] text-amber-300">
                  1. Kazanan
                </p>
                <p className="mt-2 min-h-6 text-base font-semibold text-white">{winners[0] ?? "-"}</p>
              </div>
              <div className="h-24 bg-amber-300/30 shadow-[0_0_28px_rgba(251,191,36,0.25)]" />
            </div>

            <div className="order-3">
              <div className="bg-slate-900/70 px-4 py-4 text-center">
                <p className="font-[family-name:var(--font-orbitron)] text-[11px] uppercase tracking-[0.2em] text-orange-300">
                  3. Kazanan
                </p>
                <p className="mt-2 min-h-6 text-sm text-white">{winners[2] ?? "-"}</p>
              </div>
              <div className="h-12 bg-orange-900/50" />
            </div>
          </div>
        </section>

        {backups.length > 0 && (
          <section className="mt-6 w-full max-w-3xl bg-slate-900/70 px-4 py-5 text-left">
            <p className="font-[family-name:var(--font-orbitron)] text-xs uppercase tracking-[0.2em] text-cyan-300">
              YEDEKLER LISTESI
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {backups.map((backup, index) => (
                <li key={`${backup}-${index}`} className="text-sm text-slate-100">
                  {index + 1}. {backup}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
