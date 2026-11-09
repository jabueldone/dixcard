import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  CardAsset,
  ClientMessage,
  Player,
  RevealedCardEntry,
  RoomState,
  RoundScoreSummary,
  ServerMessage,
} from './src/types/game.ts';
import { getDiceBearMarbleUrl } from './src/types/game.ts';
import { GAME_TIMERS } from './src/config/timers.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const PASTEL_PLAYER_COLORS = [
  '#E07A5F', // Terracotta Coral
  '#3D7A68', // Botanical Sage Teal
  '#5E7CE2', // Periwinkle Sky
  '#9B6B9E', // Plum Lavender
  '#D49A3A', // Honey Ochre
  '#4A90A4', // Cerulean Mist
  '#C86D85', // Rose Quartz
  '#6B8E4E', // Moss Meadow
];

/**
 * Fixed card deck: every card is available in /public/assets/dixcard/
 * and follows the naming pattern dixcard_###.webp for 1..100.
 */
function loadDynamicCardPool(): CardAsset[] {
  const cards: CardAsset[] = [];

  for (let number = 1; number <= 100; number += 1) {
    const padded = String(number).padStart(3, '0');
    cards.push({
      id: `dixcard-${padded}`,
      number,
      url: `/assets/dixcard/dixcard_${padded}.webp`,
    });
  }

  return cards;
}

let globalCardPool: CardAsset[] = loadDynamicCardPool();

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

interface InternalSubmission {
  cardId: string;
  ownerId: string;
  voterIds: string[];
}

interface GameRoom {
  roomCode: string;
  phase: RoomState['phase'];
  round: number;
  storytellerIndex: number;
  storytellerId: string | null;
  clue: string;
  players: Player[];
  deck: string[];
  discardPile: string[];
  submissions: InternalSubmission[];
  revealedCount: number;
  revealTimer: NodeJS.Timeout | null;
  phaseTimer: NodeJS.Timeout | null;
  lastScoreSummary: RoundScoreSummary | null;
  winnerIds: string[];
  nudgeTimestamp: number | null;
  nudgeTargetIds: string[];
  connections: Map<string, Set<WebSocket>>; // playerId -> active sockets
}

const rooms = new Map<string, GameRoom>();

function createEmptyRoom(roomCode: string): GameRoom {
  globalCardPool = loadDynamicCardPool();
  return {
    roomCode,
    phase: 'LOBBY',
    round: 0,
    storytellerIndex: 0,
    storytellerId: null,
    clue: '',
    players: [],
    deck: shuffleArray(globalCardPool.map((c) => c.id)),
    discardPile: [],
    submissions: [],
    revealedCount: 0,
    revealTimer: null,
    phaseTimer: null,
    lastScoreSummary: null,
    winnerIds: [],
    nudgeTimestamp: null,
    nudgeTargetIds: [],
    connections: new Map(),
  };
}

function drawCardsFromRoomDeck(room: GameRoom, count: number): string[] {
  const drawn: string[] = [];
  const allHeldCards = new Set<string>();
  for (const p of room.players) {
    for (const c of p.hand) allHeldCards.add(c);
    if (p.submittedCardId) allHeldCards.add(p.submittedCardId);
  }

  while (drawn.length < count) {
    if (room.deck.length === 0) {
      // Automatic card deck reshuffle:
      // Reshuffle discarded cards back into the draw deck when main draw pile runs out
      const availableFromDiscard = room.discardPile.filter(
        (id) => !allHeldCards.has(id) && !drawn.includes(id)
      );
      if (availableFromDiscard.length > 0) {
        room.deck = shuffleArray(availableFromDiscard);
        room.discardPile = [];
      } else {
        // Fallback: if discard pile is also exhausted, replenish from global pool
        const freshIds = globalCardPool.map((c) => c.id);
        const available = freshIds.filter(
          (id) => !allHeldCards.has(id) && !drawn.includes(id)
        );
        room.deck = shuffleArray(available.length > 0 ? available : freshIds);
        room.discardPile = [];
      }
    }
    const nextCard = room.deck.pop();
    if (nextCard) {
      drawn.push(nextCard);
    } else {
      break;
    }
  }
  return drawn;
}

function buildClientRoomState(room: GameRoom): RoomState {
  const showOwnersAndVoters =
    room.phase === 'SCORING' || room.phase === 'GARDEN_PATH' || room.phase === 'PODIUM';

  const revealedCards: RevealedCardEntry[] = room.submissions.map((sub) => ({
    cardId: sub.cardId,
    ownerId: showOwnersAndVoters ? sub.ownerId : undefined,
    voterIds: showOwnersAndVoters ? sub.voterIds : [],
  }));

  return {
    roomCode: room.roomCode,
    phase: room.phase,
    round: room.round,
    storytellerIndex: room.storytellerIndex,
    storytellerId: room.storytellerId,
    clue: room.clue,
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatarSeed: p.avatarSeed,
      avatarUrl: p.avatarUrl,
      color: p.color,
      isHost: p.isHost,
      isReady: p.isReady,
      connected: p.connected,
      isSpectator: Boolean(p.isSpectator),
      score: p.score,
      previousScore: p.previousScore,
      roundDelta: p.roundDelta,
      hand: [], // Redacted in public broadcast; sent privately per player
      hasSubmitted: Boolean(p.submittedCardId),
      hasVoted: Boolean(p.votedCardId),
    })),
    revealedCards,
    revealedCount: room.revealedCount,
    deckCount: room.deck.length,
    totalCardsInPool: globalCardPool.length,
    lastScoreSummary: room.lastScoreSummary,
    winnerIds: room.winnerIds,
    nudgeTimestamp: room.nudgeTimestamp,
    nudgeTargetIds: room.nudgeTargetIds,
  };
}

function sendToSocket(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastRoomState(room: GameRoom) {
  const publicState = buildClientRoomState(room);
  for (const player of room.players) {
    const sockets = room.connections.get(player.id);
    if (!sockets) continue;
    const payload: ServerMessage = {
      type: 'ROOM_STATE',
      state: publicState,
      yourHand: player.hand,
      yourSubmittedCardId: player.submittedCardId || null,
      yourVotedCardId: player.votedCardId || null,
    };
    for (const ws of sockets) {
      sendToSocket(ws, payload);
    }
  }
}

function broadcastToRoom(room: GameRoom, msg: ServerMessage) {
  for (const sockets of room.connections.values()) {
    for (const ws of sockets) {
      sendToSocket(ws, msg);
    }
  }
}

function clearPhaseTimer(room: GameRoom) {
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
}

function schedulePhaseTimeout(room: GameRoom, durationMs: number, onTimeout: () => void) {
  clearPhaseTimer(room);
  if (durationMs <= 0) return;

  const phase = room.phase;
  const round = room.round;
  const timer = setTimeout(() => {
    if (room.phaseTimer !== timer) return;
    room.phaseTimer = null;
    if (room.phase !== phase || room.round !== round) return;
    onTimeout();
  }, durationMs);
  room.phaseTimer = timer;
}

function submitPendingDecoys(room: GameRoom) {
  for (const player of room.players) {
    if (player.id === room.storytellerId || player.isSpectator ||
        player.submittedCardId || player.hand.length === 0) continue;

    const index = Math.floor(Math.random() * player.hand.length);
    const [cardId] = player.hand.splice(index, 1);
    player.submittedCardId = cardId;
    player.hasSubmitted = true;
    room.submissions.push({ cardId, ownerId: player.id, voterIds: [] });
  }
}

function startVotingPhase(room: GameRoom) {
  if (room.revealTimer) {
    clearInterval(room.revealTimer);
    room.revealTimer = null;
  }
  room.phase = 'VOTING';
  room.submissions = shuffleArray(room.submissions);
  room.revealedCount = room.submissions.length;
  room.nudgeTimestamp = null;
  room.nudgeTargetIds = [];
  schedulePhaseTimeout(room, GAME_TIMERS.votingTimeLimitMs, () => {
    // Missing votes remain null: abstentions do not award decoy bonuses.
    computeDixitScores(room);
    broadcastRoomState(room);
  });
  broadcastRoomState(room);
}

function computeDixitScores(room: GameRoom) {
  const storyteller = room.players.find((p) => p.id === room.storytellerId);
  if (!storyteller) return;

  const storytellerSub = room.submissions.find((s) => s.ownerId === storyteller.id);
  if (!storytellerSub) return;

  const guessers = room.players.filter((p) => !p.isSpectator && p.id !== storyteller.id);
  const totalGuessers = guessers.length;
  const correctVoterIds = storytellerSub.voterIds;
  const numCorrect = correctVoterIds.length;

  let caseType: RoundScoreSummary['caseType'] = 'SOME_GUESSED';
  let headline = '';

  const deltas: RoundScoreSummary['deltas'] = {};
  for (const p of room.players) {
    p.previousScore = p.score;
    p.roundDelta = 0;
    deltas[p.id] = {
      basePoints: 0,
      decoyBonus: 0,
      totalDelta: 0,
      reason: '',
    };
  }

  if (numCorrect === 0) {
    caseType = 'NONE_GUESSED';
    headline = 'No one found the Storyteller’s card! Everyone else earns +2 pts.';
    deltas[storyteller.id].basePoints = 0;
    deltas[storyteller.id].reason = 'No one guessed your clue (0 pts)';
    for (const g of guessers) {
      deltas[g.id].basePoints = 2;
      deltas[g.id].reason = 'Nobody guessed the Storyteller (+2 pts)';
    }
  } else if (numCorrect === totalGuessers && totalGuessers > 0) {
    caseType = 'ALL_GUESSED';
    headline = 'Everyone guessed the Storyteller’s card! Everyone else earns +2 pts.';
    deltas[storyteller.id].basePoints = 0;
    deltas[storyteller.id].reason = 'Everyone guessed your clue (0 pts)';
    for (const g of guessers) {
      deltas[g.id].basePoints = 2;
      deltas[g.id].reason = 'Everyone found the Storyteller (+2 pts)';
    }
  } else {
    caseType = 'SOME_GUESSED';
    headline = 'Dixcard time! Storyteller and correct guessers earn +3 pts.';
    deltas[storyteller.id].basePoints = 3;
    deltas[storyteller.id].reason = `${numCorrect} player(s) guessed correctly (+3 pts)`;
    for (const g of guessers) {
      if (correctVoterIds.includes(g.id)) {
        deltas[g.id].basePoints = 3;
        deltas[g.id].reason = 'Correct guess (+3 pts)';
      } else {
        deltas[g.id].basePoints = 0;
        deltas[g.id].reason = 'Incorrect guess (0 pts)';
      }
    }
  }

  // Decoy Bonus: Every player (except Storyteller) gets +1 pt for each vote their decoy card attracted
  for (const sub of room.submissions) {
    if (sub.ownerId === storyteller.id) continue;
    const bonusVotes = sub.voterIds.length;
    if (bonusVotes > 0 && deltas[sub.ownerId]) {
      deltas[sub.ownerId].decoyBonus = bonusVotes;
      const prevReason = deltas[sub.ownerId].reason;
      deltas[sub.ownerId].reason = `${prevReason} · Decoy fooled ${bonusVotes} (+${bonusVotes} pt${bonusVotes > 1 ? 's' : ''})`;
    }
  }

  for (const p of room.players) {
    const d = deltas[p.id];
    d.totalDelta = d.basePoints + d.decoyBonus;
    p.roundDelta = d.totalDelta;
    p.score = p.score + d.totalDelta;
  }

  room.lastScoreSummary = {
    caseType,
    headline,
    storytellerId: storyteller.id,
    storytellerCardId: storytellerSub.cardId,
    deltas,
  };
  room.phase = 'SCORING';
  room.nudgeTimestamp = null;
  room.nudgeTargetIds = [];

  schedulePhaseTimeout(room, GAME_TIMERS.scoringDurationMs, () => {
    room.phase = 'GARDEN_PATH';
    broadcastRoomState(room);
  });
}

function beginNextRound(room: GameRoom, nextStorytellerIndex: number) {
  clearPhaseTimer(room);
  // Move submitted cards to discard pile and top up every player's hand back to 6 cards
  for (const sub of room.submissions) {
    room.discardPile.push(sub.cardId);
  }
  room.submissions = [];
  room.revealedCount = 0;
  room.clue = '';
  room.lastScoreSummary = null;
  room.nudgeTimestamp = null;
  room.nudgeTargetIds = [];

  for (const p of room.players) {
    p.submittedCardId = null;
    p.votedCardId = null;
    p.hasSubmitted = false;
    p.hasVoted = false;
    p.roundDelta = 0;
    // Late-joining spectators transition to active players on the new round
    if (p.isSpectator) {
      p.isSpectator = false;
    }
    const needed = Math.max(0, 6 - p.hand.length);
    if (needed > 0) {
      p.hand.push(...drawCardsFromRoomDeck(room, needed));
    }
  }

  room.round += 1;
  const activePlayers = room.players.filter((p) => p.connected && !p.isSpectator);
  const totalCount = activePlayers.length > 0 ? activePlayers.length : room.players.length;
  room.storytellerIndex = nextStorytellerIndex % totalCount;
  room.storytellerId =
    activePlayers[room.storytellerIndex]?.id ||
    room.players[room.storytellerIndex]?.id ||
    room.players[0]?.id ||
    null;
  room.phase = 'STORYTELLER_CLUE';
}

function handleClientMessage(
  room: GameRoom,
  ws: WebSocket,
  boundPlayerIdRef: { current: string | null },
  msg: ClientMessage
) {
  switch (msg.type) {
    case 'JOIN_ROOM': {
      const cleanId = (msg.playerId || '').trim();
      const cleanNickname = (msg.nickname || 'Traveler').trim().slice(0, 20) || 'Traveler';
      const cleanSeed = (msg.avatarSeed || cleanNickname).trim();
      if (!cleanId) return;

      boundPlayerIdRef.current = cleanId;
      let existing = room.players.find((p) => p.id === cleanId);

      if (!existing) {
        const isFirstPlayer = room.players.length === 0;
        const color = PASTEL_PLAYER_COLORS[room.players.length % PASTEL_PLAYER_COLORS.length];
        const isLateJoiner = room.phase !== 'LOBBY';
        existing = {
          id: cleanId,
          nickname: cleanNickname,
          avatarSeed: cleanSeed,
          avatarUrl: getDiceBearMarbleUrl(cleanSeed),
          color,
          isHost: isFirstPlayer,
          isReady: true,
          connected: true,
          isSpectator: isLateJoiner,
          score: 0,
          previousScore: 0,
          roundDelta: 0,
          hand: [],
          hasSubmitted: false,
          hasVoted: false,
          submittedCardId: null,
          votedCardId: null,
        };
        room.players.push(existing);
      } else {
        existing.nickname = cleanNickname;
        existing.avatarSeed = cleanSeed;
        existing.avatarUrl = getDiceBearMarbleUrl(cleanSeed);
        existing.connected = true;
      }

      // Ensure at least one connected host exists
      if (!room.players.some((p) => p.isHost && p.connected)) {
        const firstConnected = room.players.find((p) => p.connected) || room.players[0];
        if (firstConnected) {
          room.players.forEach((p) => {
            p.isHost = p.id === firstConnected.id;
          });
        }
      }

      let sockSet = room.connections.get(cleanId);
      if (!sockSet) {
        sockSet = new Set();
        room.connections.set(cleanId, sockSet);
      }
      sockSet.add(ws);

      broadcastRoomState(room);
      break;
    }

    case 'TOGGLE_READY': {
      const pid = boundPlayerIdRef.current;
      if (!pid) return;
      const player = room.players.find((p) => p.id === pid);
      if (player) {
        player.isReady = msg.isReady;
        broadcastRoomState(room);
      }
      break;
    }

    case 'KICK_PLAYER': {
      const pid = boundPlayerIdRef.current;
      if (!pid) return;
      const host = room.players.find((p) => p.id === pid);
      if (!host || !host.isHost) return;
      if (msg.targetPlayerId === host.id) return;

      const targetSockets = room.connections.get(msg.targetPlayerId);
      if (targetSockets) {
        for (const tws of targetSockets) {
          sendToSocket(tws, {
            type: 'KICKED',
            reason: 'The host removed you from the room.',
          });
          tws.close();
        }
        room.connections.delete(msg.targetPlayerId);
      }

      room.players = room.players.filter((p) => p.id !== msg.targetPlayerId);
      broadcastRoomState(room);
      break;
    }

    case 'RELOAD_DECK': {
      globalCardPool = loadDynamicCardPool();
      broadcastToRoom(room, {
        type: 'CARDS_POOL_UPDATED',
        cards: globalCardPool,
      });
      broadcastRoomState(room);
      break;
    }

    case 'START_GAME': {
      const pid = boundPlayerIdRef.current;
      if (!pid) return;
      const host = room.players.find((p) => p.id === pid);
      if (!host || !host.isHost) return;

      const readyPlayers = room.players.filter((p) => p.connected && p.isReady);
      if (readyPlayers.length < 3) {
        sendToSocket(ws, {
          type: 'ERROR_MSG',
          message: 'At least 3 ready human players are required to start Dixcard.',
        });
        return;
      }

      globalCardPool = loadDynamicCardPool();
      room.deck = shuffleArray(globalCardPool.map((c) => c.id));
      room.discardPile = [];
      room.round = 0;
      room.winnerIds = [];
      for (const p of room.players) {
        p.score = 0;
        p.previousScore = 0;
        p.roundDelta = 0;
        p.hand = [];
        p.isSpectator = false;
        p.submittedCardId = null;
        p.votedCardId = null;
      }

      const randomStarterIdx = Math.floor(Math.random() * room.players.length);
      beginNextRound(room, randomStarterIdx);
      broadcastRoomState(room);
      break;
    }

    case 'SUBMIT_STORYTELLER_CLUE': {
      const pid = boundPlayerIdRef.current;
      if (!pid || room.phase !== 'STORYTELLER_CLUE' || pid !== room.storytellerId) return;
      const player = room.players.find((p) => p.id === pid);
      if (!player) return;

      const cleanClue = (msg.clue || '').trim();
      if (!cleanClue) {
        sendToSocket(ws, { type: 'ERROR_MSG', message: 'Please enter a poetic clue for your card.' });
        return;
      }
      if (!player.hand.includes(msg.cardId)) {
        sendToSocket(ws, { type: 'ERROR_MSG', message: 'Selected card is not in your hand.' });
        return;
      }

      player.hand = player.hand.filter((id) => id !== msg.cardId);
      player.submittedCardId = msg.cardId;
      player.hasSubmitted = true;
      room.clue = cleanClue;
      room.submissions = [
        {
          cardId: msg.cardId,
          ownerId: player.id,
          voterIds: [],
        },
      ];
      room.phase = 'GUESSER_SUBMIT';
      room.nudgeTimestamp = null;
      room.nudgeTargetIds = [];
      schedulePhaseTimeout(room, GAME_TIMERS.submissionTimeLimitMs, () => {
        submitPendingDecoys(room);
        startVotingPhase(room);
      });
      broadcastRoomState(room);
      break;
    }

    case 'SUBMIT_GUESSER_CARD': {
      const pid = boundPlayerIdRef.current;
      if (!pid || room.phase !== 'GUESSER_SUBMIT' || pid === room.storytellerId) return;
      const player = room.players.find((p) => p.id === pid);
      if (!player || player.isSpectator || player.submittedCardId) return;
      if (!player.hand.includes(msg.cardId)) return;

      player.hand = player.hand.filter((id) => id !== msg.cardId);
      player.submittedCardId = msg.cardId;
      player.hasSubmitted = true;
      room.submissions.push({
        cardId: msg.cardId,
        ownerId: player.id,
        voterIds: [],
      });

      const activeGuessers = room.players.filter(
        (p) => p.connected && !p.isSpectator && p.id !== room.storytellerId
      );
      const allSubmitted = activeGuessers.every((p) => Boolean(p.submittedCardId));
      if (allSubmitted) {
        startVotingPhase(room);
      } else {
        broadcastRoomState(room);
      }
      break;
    }

    case 'ADVANCE_REVEAL': {
      if (room.phase !== 'REVEAL') return;
      startVotingPhase(room);
      break;
    }

    case 'LOCK_IN_VOTE': {
      const pid = boundPlayerIdRef.current;
      if (!pid || room.phase !== 'VOTING' || pid === room.storytellerId) return;
      const player = room.players.find((p) => p.id === pid);
      if (!player || player.isSpectator || player.votedCardId) return;

      const targetSub = room.submissions.find((s) => s.cardId === msg.cardId);
      if (!targetSub) return;

      // Self-vote prevention
      if (targetSub.ownerId === player.id) {
        sendToSocket(ws, {
          type: 'ERROR_MSG',
          message: 'You cannot vote for your own submitted card!',
        });
        return;
      }

      player.votedCardId = msg.cardId;
      player.hasVoted = true;
      if (!targetSub.voterIds.includes(player.id)) {
        targetSub.voterIds.push(player.id);
      }

      const activeGuessers = room.players.filter(
        (p) => p.connected && !p.isSpectator && p.id !== room.storytellerId
      );
      const allVoted = activeGuessers.every((p) => Boolean(p.votedCardId));
      if (allVoted) {
        computeDixitScores(room);
      }
      broadcastRoomState(room);
      break;
    }

    case 'LEAVE_ROOM': {
      const pid = boundPlayerIdRef.current;
      if (!pid) return;

      const leavingSockets = room.connections.get(pid);
      if (leavingSockets) {
        for (const sock of leavingSockets) {
          sendToSocket(sock, {
            type: 'KICKED',
            reason: 'You have left the room.',
          });
          sock.close();
        }
        room.connections.delete(pid);
      }

      const leavingPlayer = room.players.find((p) => p.id === pid);
      if (leavingPlayer) {
        for (const c of leavingPlayer.hand) {
          room.discardPile.push(c);
        }
        if (leavingPlayer.submittedCardId) {
          room.discardPile.push(leavingPlayer.submittedCardId);
        }
      }

      room.players = room.players.filter((p) => p.id !== pid);
      room.submissions = room.submissions.filter((s) => s.ownerId !== pid);
      for (const s of room.submissions) {
        s.voterIds = s.voterIds.filter((vid) => vid !== pid);
      }

      // Reassign host if leaving player was host
      if (leavingPlayer?.isHost) {
        const nextHost = room.players.find((p) => p.connected);
        if (nextHost) {
          nextHost.isHost = true;
        }
      }

      // If active storyteller left during an ongoing round
      if (room.storytellerId === pid && room.phase !== 'LOBBY' && room.phase !== 'PODIUM') {
        const activeRemaining = room.players.filter((p) => p.connected && !p.isSpectator);
        if (activeRemaining.length >= 3) {
          beginNextRound(room, room.storytellerIndex);
        } else {
          clearPhaseTimer(room);
          room.phase = 'LOBBY';
        }
      } else if (room.phase === 'GUESSER_SUBMIT') {
        const activeGuessers = room.players.filter(
          (p) => p.connected && !p.isSpectator && p.id !== room.storytellerId
        );
        if (activeGuessers.length > 0 && activeGuessers.every((p) => Boolean(p.submittedCardId))) {
          startVotingPhase(room);
          return;
        }
      } else if (room.phase === 'VOTING') {
        const activeGuessers = room.players.filter(
          (p) => p.connected && !p.isSpectator && p.id !== room.storytellerId
        );
        if (activeGuessers.length > 0 && activeGuessers.every((p) => Boolean(p.votedCardId))) {
          computeDixitScores(room);
        }
      }

      broadcastRoomState(room);
      break;
    }

    case 'NEXT_ROUND': {
      if (room.phase !== 'GARDEN_PATH' && room.phase !== 'SCORING') return;
      clearPhaseTimer(room);
      // Check win condition: any player >= 30 points
      const maxScore = Math.max(...room.players.map((p) => p.score), 0);
      if (maxScore >= 30) {
        room.winnerIds = room.players
          .filter((p) => p.score === maxScore)
          .map((p) => p.id);
        room.phase = 'PODIUM';
      } else {
        beginNextRound(room, room.storytellerIndex + 1);
      }
      broadcastRoomState(room);
      break;
    }

    case 'HOST_NUDGE': {
      const pid = boundPlayerIdRef.current;
      if (!pid) return;
      const host = room.players.find((p) => p.id === pid);
      if (!host || !host.isHost) return;

      let targets: string[] = [];
      if (room.phase === 'STORYTELLER_CLUE' && room.storytellerId) {
        targets = [room.storytellerId];
      } else if (room.phase === 'GUESSER_SUBMIT') {
        targets = room.players
          .filter((p) => p.id !== room.storytellerId && !p.isSpectator && !p.submittedCardId)
          .map((p) => p.id);
      } else if (room.phase === 'VOTING') {
        targets = room.players
          .filter((p) => p.id !== room.storytellerId && !p.isSpectator && !p.votedCardId)
          .map((p) => p.id);
      }

      room.nudgeTimestamp = Date.now();
      room.nudgeTargetIds = targets;
      broadcastToRoom(room, {
        type: 'NUDGE_ALERT',
        fromHost: host.nickname,
        targetIds: targets,
      });
      broadcastRoomState(room);
      break;
    }

    case 'HOST_SKIP_PHASE': {
      const pid = boundPlayerIdRef.current;
      if (!pid) return;
      const host = room.players.find((p) => p.id === pid);
      if (!host || !host.isHost) return;

      if (room.phase === 'STORYTELLER_CLUE') {
        // Rotate to next storyteller if current storyteller is AFK
        beginNextRound(room, room.storytellerIndex + 1);
        broadcastRoomState(room);
      } else if (room.phase === 'GUESSER_SUBMIT') {
        // Auto-pick a random card from hand for any pending guesser so the round can proceed
        submitPendingDecoys(room);
        startVotingPhase(room);
      } else if (room.phase === 'REVEAL') {
        startVotingPhase(room);
      } else if (room.phase === 'VOTING') {
        // Auto-vote a valid non-owned card for any AFK guesser
        for (const p of room.players) {
          if (p.id !== room.storytellerId && !p.isSpectator && !p.votedCardId) {
            const validTarget =
              room.submissions.find((s) => s.ownerId !== p.id) || room.submissions[0];
            if (validTarget) {
              p.votedCardId = validTarget.cardId;
              p.hasVoted = true;
              if (!validTarget.voterIds.includes(p.id)) {
                validTarget.voterIds.push(p.id);
              }
            }
          }
        }
        computeDixitScores(room);
        broadcastRoomState(room);
      } else if (room.phase === 'SCORING') {
        clearPhaseTimer(room);
        room.phase = 'GARDEN_PATH';
        broadcastRoomState(room);
      }
      break;
    }

    case 'PLAY_AGAIN': {
      const pid = boundPlayerIdRef.current;
      if (!pid) return;
      globalCardPool = loadDynamicCardPool();
      room.deck = shuffleArray(globalCardPool.map((c) => c.id));
      room.discardPile = [];
      room.round = 0;
      room.winnerIds = [];
      room.lastScoreSummary = null;
      for (const p of room.players) {
        p.score = 0;
        p.previousScore = 0;
        p.roundDelta = 0;
        p.hand = [];
        p.submittedCardId = null;
        p.votedCardId = null;
      }
      beginNextRound(room, 0);
      broadcastRoomState(room);
      break;
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Dynamic Card Deck REST API
  app.get('/api/cards', (_req, res) => {
    globalCardPool = loadDynamicCardPool();
    res.json({
      count: globalCardPool.length,
      cards: globalCardPool,
    });
  });

  app.post('/api/cards/reload', (_req, res) => {
    globalCardPool = loadDynamicCardPool();
    res.json({
      count: globalCardPool.length,
      cards: globalCardPool,
    });
  });

  const httpServer = http.createServer(app);

  // PartyKit-compatible WebSocket Server (/parties/:party/:roomCode or /party/:roomCode)
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const urlObj = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // Match PartySocket paths: /parties/:party/:room or /party/:room
    const partyMatch =
      pathname.match(/^\/parties\/[^/]+\/([A-Za-z0-9_-]+)/) ||
      pathname.match(/^\/party\/([A-Za-z0-9_-]+)/);

    if (partyMatch) {
      const roomCode = partyMatch[1].toUpperCase();
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, roomCode);
      });
    }
  });

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, roomCode: string) => {
    let room = rooms.get(roomCode);
    if (!room) {
      room = createEmptyRoom(roomCode);
      rooms.set(roomCode, room);
    }

    const boundPlayerIdRef: { current: string | null } = { current: null };

    // Send latest card pool immediately on connect
    sendToSocket(ws, {
      type: 'CARDS_POOL_UPDATED',
      cards: globalCardPool,
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        handleClientMessage(room!, ws, boundPlayerIdRef, msg);
      } catch (err) {
        console.error('Invalid WS message:', err);
      }
    });

    ws.on('close', () => {
      const pid = boundPlayerIdRef.current;
      if (!pid || !room) return;
      const sockSet = room.connections.get(pid);
      if (sockSet) {
        sockSet.delete(ws);
        if (sockSet.size === 0) {
          room.connections.delete(pid);
          const player = room.players.find((p) => p.id === pid);
          if (player) {
            player.connected = false;
            // Reassign host if needed
            if (player.isHost) {
              const nextHost = room.players.find((p) => p.connected);
              if (nextHost) {
                player.isHost = false;
                nextHost.isHost = true;
              }
            }
          }
          broadcastRoomState(room);
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Dixcard server & PartySocket hub running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
