import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crown, FastForward, Sparkles, Trophy } from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { GAME_TIMERS } from '../config/timers';
import type { Player, RoundScoreSummary } from '../types/game';

interface GardenScoringBoardProps {
  players: Player[];
  scoreSummary: RoundScoreSummary | null;
  isHost: boolean;
  onNextRound: () => void;
}

interface StoneCoordinate {
  step: number; // 0 to 30
  x: number; // Percentage 0..100
  y: number; // Percentage 0..100
  isMilestone: boolean;
}

/**
 * Generates an S-curve stone path with 31 stones (Step 0 start pad + 30 garden stone steps)
 * winding from bottom (y=90%) to top (y=10%) with wide, rounded serpentine bends.
 */
function buildGardenStoneCoordinates(width: number, height: number): StoneCoordinate[] {
  // Measure a densely sampled curve in pixels, not percentages: the board is not square.
  const sampleCount = 2000;
  const samples: { x: number; y: number; distance: number }[] = [];
  let totalLength = 0;

  for (let index = 0; index <= sampleCount; index++) {
    const progress = index / sampleCount;
    const x = 50 + Math.sin(progress * Math.PI * 4 - 0.4) * 40;
    const y = 90 - progress * 80;
    const previous = samples[index - 1];
    if (previous) {
      totalLength += Math.hypot(
        ((x - previous.x) * width) / 100,
        ((y - previous.y) * height) / 100
      );
    }
    samples.push({ x, y, distance: totalLength });
  }

  let sampleIndex = 1;
  return Array.from({ length: 31 }, (_, step) => {
    const targetDistance = (step / 30) * totalLength;
    while (
      sampleIndex < sampleCount &&
      samples[sampleIndex].distance < targetDistance
    ) {
      sampleIndex++;
    }

    const before = samples[sampleIndex - 1];
    const after = samples[sampleIndex];
    const segmentLength = after.distance - before.distance;
    const fraction = segmentLength > 0
      ? (targetDistance - before.distance) / segmentLength
      : 0;

    return {
      step,
      x: before.x + (after.x - before.x) * fraction,
      y: before.y + (after.y - before.y) * fraction,
      isMilestone: step > 0 && step % 5 === 0,
    };
  });
}

export const GardenScoringBoard: React.FC<GardenScoringBoardProps> = ({
  players,
  scoreSummary,
  isHost,
  onNextRound,
}) => {
  const stoneMapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const map = stoneMapRef.current;
    if (!map) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setMapSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height }
        );
      }
    });
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  const stones = useMemo(
    () => buildGardenStoneCoordinates(mapSize.width, mapSize.height),
    [mapSize.width, mapSize.height]
  );

  // Track each player's animated stone position so avatars hop stone-by-stone
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of players) {
      init[p.id] = Math.min(30, Math.max(0, p.previousScore));
    }
    return init;
  });

  const [hoppingPlayerId, setHoppingPlayerId] = useState<string | null>(null);
  const [animationComplete, setAnimationComplete] = useState(false);
  const nextRoundCallbackRef = useRef(onNextRound);
  const hasAdvancedRef = useRef(false);

  useEffect(() => {
    nextRoundCallbackRef.current = onNextRound;
  }, [onNextRound]);

  const advanceRound = useCallback(() => {
    if (hasAdvancedRef.current) return;
    hasAdvancedRef.current = true;
    soundEngine.playLockIn();
    nextRoundCallbackRef.current();
  }, []);

  useEffect(() => {
    if (!animationComplete || !isHost || GAME_TIMERS.nextRoundDelayMs <= 0) return;

    const timer = window.setTimeout(advanceRound, GAME_TIMERS.nextRoundDelayMs);
    return () => window.clearTimeout(timer);
  }, [animationComplete, isHost, advanceRound]);

  useEffect(() => {
    let cancelled = false;
    const timeouts: number[] = [];
    hasAdvancedRef.current = false;

    // Reset to previousScore first
    const startMap: Record<string, number> = {};
    for (const p of players) {
      startMap[p.id] = Math.min(30, Math.max(0, p.previousScore));
    }
    setAnimatedPositions(startMap);
    setAnimationComplete(false);

    // Build sequential stone-by-stone hop queue across all players who scored points
    let cumulativeDelay: number = GAME_TIMERS.gardenAnimation.initialDelayMs;
    for (const p of players) {
      const fromStep = Math.min(30, Math.max(0, p.previousScore));
      const toStep = Math.min(30, Math.max(0, p.score));
      if (toStep > fromStep) {
        for (let s = fromStep + 1; s <= toStep; s++) {
          const delay = cumulativeDelay;
          const targetStep = s;
          const playerId = p.id;
          const tId = window.setTimeout(() => {
            if (cancelled) return;
            setHoppingPlayerId(playerId);
            soundEngine.playStoneHop(targetStep);
            setAnimatedPositions((prev) => ({
              ...prev,
              [playerId]: targetStep,
            }));
          }, delay);
          timeouts.push(tId);
          cumulativeDelay += GAME_TIMERS.gardenAnimation.stoneHopIntervalMs;
        }
        cumulativeDelay += GAME_TIMERS.gardenAnimation.betweenPlayersDelayMs;
      }
    }

    const doneTimer = window.setTimeout(() => {
      if (cancelled) return;
      setHoppingPlayerId(null);
      setAnimationComplete(true);
    }, cumulativeDelay + GAME_TIMERS.gardenAnimation.completionBufferMs);
    timeouts.push(doneTimer);

    return () => {
      cancelled = true;
      timeouts.forEach((t) => window.clearTimeout(t));
    };
  }, [players]);

  const anyReached30 = players.some((p) => p.score >= 30);

  // Interpolate the stones with a Catmull–Rom spline converted to cubic Bézier segments.
  const svgPathD = useMemo(() => {
    return stones.reduce((path, stone, index) => {
      if (index === 0) return `M ${stone.x} ${stone.y}`;

      const previous = stones[index - 1];
      const beforePrevious = stones[Math.max(0, index - 2)];
      const next = stones[Math.min(stones.length - 1, index + 1)];
      const control1X = previous.x + (stone.x - beforePrevious.x) / 6;
      const control1Y = previous.y + (stone.y - beforePrevious.y) / 6;
      const control2X = stone.x - (next.x - previous.x) / 6;
      const control2Y = stone.y - (next.y - previous.y) / 6;

      return `${path} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${stone.x} ${stone.y}`;
    }, '');
  }, [stones]);

  return (
    <div className="w-full h-full min-h-0 flex flex-col lg:flex-row items-stretch gap-6 px-6 py-4 max-w-[1400px] mx-auto overflow-y-auto">
      {/* Left Column: Garden S-Curve 30-Stone Path Visualization */}
      <div className="relative flex-1 shrink-0 neo-surface rounded-3xl p-6 overflow-hidden flex flex-col justify-between min-h-[520px]">
        {/* Soft Botanical Meadow Background Decor */}
        <div
          className="pointer-events-none absolute inset-0 opacity-85"
          style={{
            background:
              'radial-gradient(circle at 20% 25%, #e2f5e9 0%, transparent 45%), radial-gradient(circle at 80% 65%, #fdf1d4 0%, transparent 50%), radial-gradient(circle at 30% 85%, #e3edff 0%, transparent 45%)',
          }}
        />

        {/* Top Header Inside Garden Board */}
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl font-display font-bold text-[#2b303a]">
              The Sanctuary Garden Path
            </h2>
            <p className="text-xs text-[#5e6472]">
              30 steps to victory
            </p>
          </div>
          <div className="text-xs font-mono-code text-[#3d7a68] font-semibold">
            {animationComplete
              ? anyReached30
                ? 'We have a winner!'
                : 'Scores Updated'
              : 'Moving up!'}
          </div>
        </div>

        {/* Interactive S-Curve Stone Map Container */}
        <div ref={stoneMapRef} className="relative flex-1 w-full my-2">
          {/* SVG Connecting Trail */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            <path
              d={svgPathD}
              fill="none"
              stroke="#d5cdc3"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={svgPathD}
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.1"
              strokeDasharray="1.5 1.8"
              strokeLinecap="round"
            />
          </svg>

          {/* 30 Stepping Stones + Start Pad (0) */}
          {stones.map((st) => {
            const isGoal = st.step === 30;
            const isStart = st.step === 0;

            // Find players currently standing on this stone
            const occupants = players.filter(
              (p) => (animatedPositions[p.id] ?? 0) === st.step
            );

            return (
              <div
                key={st.step}
                style={{
                  left: `${st.x}%`,
                  top: `${st.y}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              >
                {/* Stone Node */}
                <div
                  className={`relative flex items-center justify-center transition-transform duration-200 ${
                    isGoal
                      ? 'w-12 h-12 rounded-2xl bg-[#fdf1d4] border-2 border-[#d49a3a] shadow-md'
                      : st.isMilestone
                        ? 'w-9 h-9 rounded-xl bg-[#e2f5e9] border-2 border-[#3d7a68] shadow-sm'
                        : isStart
                          ? 'w-9 h-9 rounded-xl bg-[#ffe3ea] border border-[#e07a5f]/50'
                          : 'w-6 h-6 rounded-full bg-[#f4efe9] border border-[#d5cdc3] shadow-xs'
                  }`}
                >
                  {isGoal ? (
                    <Crown className="w-5 h-5 text-[#b57c1e]" />
                  ) : (
                    <span
                      className={`font-mono-code font-bold ${
                        st.isMilestone
                          ? 'text-xs text-[#2b594b]'
                          : 'text-[10px] text-[#5e6472]'
                      }`}
                    >
                      {isStart ? 'S' : st.step}
                    </span>
                  )}

                  {/* Milestone Marker Label */}
                  {st.isMilestone && !isGoal && (
                    <span className="absolute -bottom-4 text-[9px] font-mono-code font-semibold text-[#3d7a68] whitespace-nowrap">
                      ★ {st.step}
                    </span>
                  )}
                </div>

                {/* Player Avatars Hopping on This Stone */}
                {occupants.length > 0 && (
                  <div className="absolute -top-8 flex items-center -space-x-2 z-20">
                    {occupants.map((p) => {
                      const isHopping = hoppingPlayerId === p.id;
                      return (
                        <div
                          key={p.id}
                          style={{ borderColor: p.color }}
                          className={`relative w-8 h-8 rounded-full border-2 bg-white shadow-md transition-transform duration-200 ${
                            isHopping ? '-translate-y-3 scale-125' : 'translate-y-0 scale-100'
                          }`}
                          title={`${p.nickname}: ${p.score} pts`}
                        >
                          <img
                            src={p.avatarUrl}
                            alt={p.nickname}
                            className="w-full h-full rounded-full object-cover"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Column: Round Score Breakdown & Standings */}
      <div className="w-full lg:w-[390px] neo-surface rounded-3xl p-6 flex flex-col justify-between shrink-0">
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[#3d7a68]">
              Round Standings
            </span>
            <span className="text-xs font-mono-code text-[#5e6472]">
              Goal: 30 Steps
            </span>
          </div>

          {scoreSummary && (
            <div className="neo-inset rounded-2xl p-3.5 mb-5">
              <div className="text-xs font-semibold text-[#2b303a] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#e07a5f] shrink-0" />
                <span>{scoreSummary.headline}</span>
              </div>
            </div>
          )}

          <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
            {[...players]
              .sort((a, b) => b.score - a.score)
              .map((p, idx) => {
                const deltaInfo = scoreSummary?.deltas[p.id];
                const currentAnimStep = animatedPositions[p.id] ?? p.score;
                return (
                  <div
                    key={p.id}
                    className="neo-card rounded-2xl p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono-code font-bold text-[#5e6472] w-4">
                        {idx + 1}.
                      </span>
                      <img
                        src={p.avatarUrl}
                        alt={p.nickname}
                        className="w-10 h-10 rounded-full border-2 shrink-0"
                        style={{ borderColor: p.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#2b303a] truncate">
                          {p.nickname}
                        </div>
                        <div className="text-[11px] text-[#5e6472] truncate">
                          {deltaInfo?.reason || 'Advancing on path'}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base font-mono-code font-bold text-[#2b303a]">
                        {currentAnimStep} <span className="text-xs font-normal text-[#5e6472]">/ 30</span>
                      </div>
                      {p.roundDelta > 0 && (
                        <div className="text-xs font-mono-code font-semibold text-[#3d7a68]">
                          +{p.roundDelta} steps
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="pt-4 border-t border-[#d5cdc3]/60 mt-4">
          {isHost ? (
            <button
              type="button"
              onClick={advanceRound}
              disabled={!animationComplete}
              className="w-full neo-button-coral py-3.5 px-6 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {anyReached30 ? (
                <Trophy className="w-4 h-4" />
              ) : (
                <FastForward className="w-3.5 h-3.5" />
              )}
              <span>
                {anyReached30
                  ? 'Crown the Winner on Podium'
                  : 'Deal Next Round'}
              </span>
            </button>
          ) : null
          }
        </div>
      </div>
    </div>
  );
};
