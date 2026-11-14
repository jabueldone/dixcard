import React, { useRef } from 'react';
import 'hover-tilt/web-component';
import type { CardAsset, GamePhase, Player, RevealedCardEntry } from '../types/game';

type HoverTiltCardProps = React.HTMLAttributes<HTMLElement> & {
  shadow?: boolean;
  shadowBlur?: number | string;
  scaleFactor?: number | string;
  glareMask?: string;
  glareMaskMode?: string;
  glareIntensity?: number | string;
  glareMaskComposite?: string;
  blendMode?: string;
};

const HoverTiltCard: React.FC<React.PropsWithChildren<HoverTiltCardProps>> = ({
  children,
  shadow = false,
  shadowBlur,
  scaleFactor,
  glareMask,
  glareMaskMode,
  glareIntensity,
  glareMaskComposite,
  blendMode,
  style,
  className,
  ...rest
}) => {
  const ref = useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (shadow) {
      el.setAttribute('shadow', '');
    } else {
      el.removeAttribute('shadow');
    }

    if (shadowBlur !== undefined) {
      el.setAttribute('shadow-blur', String(shadowBlur));
    } else {
      el.removeAttribute('shadow-blur');
    }

    if (scaleFactor !== undefined) {
      el.setAttribute('scale-factor', String(scaleFactor));
    } else {
      el.removeAttribute('scale-factor');
    }

    if (glareMask) {
      const normalizedMask = glareMask.trim();
      const maskValue = normalizedMask.startsWith('url(')
        ? normalizedMask
        : `url("${normalizedMask.replace(/"/g, '\\"')}")`;
      el.setAttribute('glare-mask', maskValue);
    } else {
      el.removeAttribute('glare-mask');
    }

    if (glareMaskMode) {
      el.setAttribute('glare-mask-mode', glareMaskMode);
    } else {
      el.removeAttribute('glare-mask-mode');
    }

    if (glareIntensity !== undefined) {
      el.setAttribute('glare-intensity', String(glareIntensity));
    } else {
      el.removeAttribute('glare-intensity');
    }

    if (glareMaskComposite) {
      el.setAttribute('glare-mask-composite', glareMaskComposite);
    } else {
      el.removeAttribute('glare-mask-composite');
    }

    if (blendMode) {
      el.setAttribute('blend-mode', blendMode);
    } else {
      el.removeAttribute('blend-mode');
    }
  }, [shadow, shadowBlur, scaleFactor, glareMask, glareMaskMode, glareIntensity, glareMaskComposite, blendMode]);

  return (
    <>
      <style>{`
        @keyframes hover-tilt-idle-bob {
          0% {
            transform: translateY(0px) scale(1);
          }
          50% {
            transform: translateY(-8px) scale(1.01);
          }
          100% {
            transform: translateY(0px) scale(1);
          }
        }
      `}</style>
      <div
        className={className}
        style={{
          ...style,
          animation: 'hover-tilt-idle-bob 4s ease-in-out infinite',
          transformOrigin: 'center center',
        }}
        data-hover-tilt-shell="true"
      >
        <hover-tilt ref={ref} {...rest}>
          {children}
        </hover-tilt>
      </div>
    </>
  );
};

interface ThreeCardViewportProps {
  phase: GamePhase;
  cardsPool: CardAsset[];
  inspectedCardId: string | null;
  onCloseInspect: () => void;
  revealedCards: RevealedCardEntry[];
  revealedCount: number;
  selectedVoteCardId: string | null;
  onSelectVoteCard: (cardId: string) => void;
  yourSubmittedCardId: string | null;
  storytellerCardId: string | null;
  players: Player[];
  currentPlayerId: string;
}

export const ThreeCardViewport: React.FC<ThreeCardViewportProps> = ({
  phase,
  cardsPool,
  inspectedCardId,
  revealedCards,
  players,
  storytellerCardId,
}) => {
  const inspectedCardMeta = inspectedCardId
    ? cardsPool.find((c) => c.id === inspectedCardId)
    : null;

  const dragScrollState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

  const handleDragScrollPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const element = event.currentTarget;
    dragScrollState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: element.scrollLeft,
      startScrollTop: element.scrollTop,
    };

    element.setPointerCapture(event.pointerId);
    element.classList.add('is-dragging');
  };

  const handleDragScrollPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragScrollState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const element = event.currentTarget;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    element.scrollLeft = drag.startScrollLeft - deltaX;
    element.scrollTop = drag.startScrollTop - deltaY;
  };

  const handleDragScrollPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragScrollState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragScrollState.current = null;
    event.currentTarget.classList.remove('is-dragging');

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture edge cases.
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      {inspectedCardMeta && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-8">
          <HoverTiltCard
            shadow
            shadowBlur={60}
            scaleFactor={1.5}
            glareMask={inspectedCardMeta.url}
            glareMaskMode="luminance"
            glareIntensity={4}
            glareMaskComposite="intersect"
            blendMode="luminosity"
            className="block"
            style={{
              width: 'min(52vw, 340px)',
              borderRadius: '10%',
              pointerEvents: 'auto',
              display: 'block',
            }}
          >
            <img
              src={inspectedCardMeta.url}
              alt={`Card #${String(inspectedCardMeta.number).padStart(3, '0')}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{
                display: 'block',
                width: '100%',
                border: '2px solid rgba(255,255,255,0.9)',
                borderRadius: '1%',
                boxSizing: 'border-box',
              }}
              className="card"
            />
          </HoverTiltCard>
        </div>
      )}

      {phase === 'SCORING' && revealedCards.length > 0 && (
        <div className="absolute inset-0 p-3 sm:p-5 z-10">
          <div
            className="neo-surface rounded-2xl p-4 sm:p-6 w-full h-full overflow-y-auto mouse-drag-scroll"
            onPointerDown={handleDragScrollPointerDown}
            onPointerMove={handleDragScrollPointerMove}
            onPointerUp={handleDragScrollPointerEnd}
            onPointerLeave={handleDragScrollPointerEnd}
          >
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {revealedCards.map((entry) => {
                const cardMeta = cardsPool.find((c) => c.id === entry.cardId);
                const owner = players.find((p) => p.id === entry.ownerId);
                const isStorytellerCard = entry.cardId === storytellerCardId;
                const voters = entry.voterIds
                  .map((vid) => players.find((p) => p.id === vid))
                  .filter(Boolean) as Player[];

                return (
                  <div
                    key={entry.cardId}
                    className={`min-w-0 flex flex-col gap-3 p-3 rounded-xl border ${
                      isStorytellerCard
                        ? 'bg-[#ffe8df] border-[#e07a5f] shadow-[0_0_0_1px_rgba(224,122,95,0.2)]'
                        : 'bg-[#f4efe9] border-white/80'
                    }`}
                  >
                    <img
                      src={cardMeta?.url}
                      alt={cardMeta ? `Card #${String(cardMeta.number).padStart(3, '0')}` : 'Card'}
                      referrerPolicy="no-referrer"
                      className="w-full aspect-[2/3] object-contain rounded-lg shadow-sm bg-[#ebe5de]"
                    />
                    <div className="text-left">
                      <div className="text-xs font-semibold text-[#2b303a] flex flex-wrap items-center gap-1.5 break-words">
                        <span className="min-w-0 break-all">{owner?.nickname || 'Player'}</span>
                        <span>·</span>
                        <span className={isStorytellerCard ? 'text-[#c74d35] font-bold' : 'text-[#5e6472]'}>
                          {isStorytellerCard ? 'Storyteller Card' : 'Decoy'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-start gap-2 mt-1.5">
                        {voters.length === 0 ? (
                          <span className="text-[11px] text-[#5e6472]">No votes</span>
                        ) : (
                          voters.map((v) => (
                            <div key={v.id} className="voter-tag">
                              <img
                                src={v.avatarUrl}
                                alt={v.nickname}
                                className="w-5 h-5 shrink-0 rounded-full border border-[#f4efe9] shadow-sm"
                              />
                              <span className="voter-name">{v.nickname}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
