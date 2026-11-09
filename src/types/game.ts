export type GamePhase =
  | 'LOBBY'
  | 'STORYTELLER_CLUE'
  | 'GUESSER_SUBMIT'
  | 'REVEAL'
  | 'VOTING'
  | 'SCORING'
  | 'GARDEN_PATH'
  | 'PODIUM';

export interface CardAsset {
  id: string;
  number: number;
  url: string;
}

export interface Player {
  id: string;
  nickname: string;
  avatarSeed: string;
  avatarUrl: string;
  color: string;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  score: number;
  previousScore: number;
  roundDelta: number;
  hand: string[];
  hasSubmitted: boolean;
  hasVoted: boolean;
  submittedCardId?: string | null;
  votedCardId?: string | null;
  isSpectator?: boolean;
}

export interface RevealedCardEntry {
  cardId: string;
  ownerId?: string; // Hidden until SCORING phase
  voterIds: string[]; // Populated in SCORING phase
}

export interface RoundScoreSummary {
  caseType: 'SOME_GUESSED' | 'ALL_GUESSED' | 'NONE_GUESSED';
  headline: string;
  storytellerId: string;
  storytellerCardId: string;
  deltas: Record<
    string,
    {
      basePoints: number;
      decoyBonus: number;
      totalDelta: number;
      reason: string;
    }
  >;
}

export interface RoomState {
  roomCode: string;
  phase: GamePhase;
  round: number;
  storytellerIndex: number;
  storytellerId: string | null;
  clue: string;
  players: Player[];
  revealedCards: RevealedCardEntry[];
  revealedCount: number; // For 1-by-1 3D table reveal animation
  deckCount: number;
  totalCardsInPool: number;
  lastScoreSummary: RoundScoreSummary | null;
  winnerIds: string[];
  nudgeTimestamp: number | null;
  nudgeTargetIds: string[];
}

export type ClientMessage =
  | {
      type: 'JOIN_ROOM';
      playerId: string;
      nickname: string;
      avatarSeed: string;
      isHostIntent?: boolean;
    }
  | { type: 'TOGGLE_READY'; isReady: boolean }
  | { type: 'KICK_PLAYER'; targetPlayerId: string }
  | { type: 'LEAVE_ROOM' }
  | { type: 'START_GAME' }
  | { type: 'SUBMIT_STORYTELLER_CLUE'; cardId: string; clue: string }
  | { type: 'SUBMIT_GUESSER_CARD'; cardId: string }
  | { type: 'ADVANCE_REVEAL' }
  | { type: 'LOCK_IN_VOTE'; cardId: string }
  | { type: 'PROCEED_TO_GARDEN' }
  | { type: 'NEXT_ROUND' }
  | { type: 'HOST_NUDGE' }
  | { type: 'HOST_SKIP_PHASE' }
  | { type: 'RELOAD_DECK' }
  | { type: 'PLAY_AGAIN' };

export type ServerMessage =
  | { type: 'ROOM_STATE'; state: RoomState; yourHand: string[]; yourSubmittedCardId: string | null; yourVotedCardId: string | null }
  | { type: 'CARDS_POOL_UPDATED'; cards: CardAsset[] }
  | { type: 'KICKED'; reason: string }
  | { type: 'NUDGE_ALERT'; fromHost: string; targetIds: string[] }
  | { type: 'ERROR_MSG'; message: string };

export function getDiceBearMarbleUrl(seed: string): string {
  const cleanSeed = encodeURIComponent((seed || 'dreamer').trim().toLowerCase());
  return `https://api.dicebear.com/10.x/marbles/svg?backgroundColor=ffe3ea,e3edff,e2f5e9,fdf1d4,efe6ff&seed=${cleanSeed}`;
}

export function getCardAssetUrl(cardNumber: number): string {
  const padded = String(cardNumber).padStart(3, '0');
  return `/assets/dixcard/dixcard_${padded}.webp`;
}

const cardImageCache = new Map<string, HTMLImageElement>();

export function prefetchCardImage(url?: string): HTMLImageElement | null {
  if (!url || typeof window === 'undefined') return null;

  const cached = cardImageCache.get(url);
  if (cached) return cached;

  const image = new window.Image();
  image.decoding = 'async';
  image.loading = 'lazy';
  image.src = url;
  cardImageCache.set(url, image);

  return image;
}
