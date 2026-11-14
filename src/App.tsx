/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PartySocket from 'partysocket';
import {
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  FastForward,
  Layers,
  Lock,
  QrCode,
  Send,
  Settings,
  Sparkles,
  UserMinus,
  Users,
} from 'lucide-react';
import { soundEngine } from './audio/soundEngine';
import { GardenScoringBoard } from './components/GardenScoringBoard';
import {
  DeckInspectorModal,
  QRCodeModal,
  SettingsModal,
  WinnerPodiumScreen,
} from './components/ModalsAndPodium';
import { ThreeCardViewport } from './components/ThreeCardViewport';
import type {
  CardAsset,
  ClientMessage,
  DeckInfo,
  RoomState,
  ServerMessage,
} from './types/game';
import { getDiceBearMarbleUrl, prefetchCardImage } from './types/game';

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getOrCreatePlayerId(): string {
  try {
    const existing = sessionStorage.getItem('dixcard_player_id');
    if (existing) return existing;
    const created = `p_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    sessionStorage.setItem('dixcard_player_id', created);
    return created;
  } catch {
    return `p_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function useMouseDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<T>) => {
    if (event.button !== 0) return;

    const element = event.currentTarget;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: element.scrollLeft,
      startScrollTop: element.scrollTop,
    };

    element.setPointerCapture(event.pointerId);
    element.classList.add('is-dragging');
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<T>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const element = event.currentTarget;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    element.scrollLeft = drag.startScrollLeft - deltaX;
    element.scrollTop = drag.startScrollTop - deltaY;
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<T>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragState.current = null;
    const element = event.currentTarget;
    element.classList.remove('is-dragging');

    try {
      element.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore cases where the pointer was not captured.
    }
  }, []);

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

export default function App() {
  const [playerId] = useState<string>(() => getOrCreatePlayerId());

  // Landing Screen State
  const [nicknameInput, setNicknameInput] = useState<string>('');
  const [avatarSeed, setAvatarSeed] = useState<string>('celestial-dreamer');
  const [landingMode, setLandingMode] = useState<'IDLE' | 'HOST' | 'JOIN'>('IDLE');
  const [roomCodeInput, setRoomCodeInput] = useState<string>('');
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [inLobbyOrGame, setInLobbyOrGame] = useState<boolean>(false);

  // Dynamic Card Deck State
  const [cardsPool, setCardsPool] = useState<CardAsset[]>([]);
  const [availableDecks, setAvailableDecks] = useState<DeckInfo[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>('dreamscape');

  // Authoritative Multiplayer Room State synced via PartySocket
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [yourHand, setYourHand] = useState<string[]>([]);
  const [yourSubmittedCardId, setYourSubmittedCardId] = useState<string | null>(null);
  const [yourVotedCardId, setYourVotedCardId] = useState<string | null>(null);

  // Local Interactive UI State
  const [selectedHandCardId, setSelectedHandCardId] = useState<string | null>(null);
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(null);
  const [selectedVoteCardId, setSelectedVoteCardId] = useState<string | null>(null);
  const [clueDraft, setClueDraft] = useState<string>('');
  const [isDockCollapsed, setIsDockCollapsed] = useState<boolean>(false);

  // Modals & Notifications
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState<boolean>(false);
  const [isDeckModalOpen, setIsDeckModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const socketRef = useRef<PartySocket | null>(null);
  const voteTrayScroll = useMouseDragScroll<HTMLDivElement>();

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4200);
  }, []);

  // Load initial dynamic card pool and check URL query param `?room=XXXX`
  useEffect(() => {
    fetch('/api/decks')
      .then((r) => r.json())
      .then((data) => {
        const decks = Array.isArray(data.decks) ? data.decks : [];
        if (decks.length) {
          setAvailableDecks(decks);
          setSelectedDeckId(data.defaultDeck || decks[0].id);
        }
      })
      .catch(() => {});

    fetch('/api/cards')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.cards)) {
          setCardsPool(data.cards);
        }
      })
      .catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam && /^[A-Za-z0-9]{4}$/.test(roomParam.trim())) {
      setLandingMode('JOIN');
      setRoomCodeInput(roomParam.trim().toUpperCase());
    }
  }, []);

  useEffect(() => {
    if (!cardsPool.length) return;

    cardsPool.slice(0, 12).forEach((card) => prefetchCardImage(card.url));
  }, [cardsPool]);

  const handleReloadDeck = useCallback(async () => {
    const res = await fetch('/api/cards/reload', { method: 'POST' });
    const data = await res.json();
    if (Array.isArray(data.cards)) {
      setCardsPool(data.cards);
    }
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: 'RELOAD_DECK' };
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Sync dynamic background music mood to the active screen/phase
  useEffect(() => {
    if (!inLobbyOrGame || !roomState || roomState.phase === 'LOBBY') {
      soundEngine.setMood('WHIMSICAL');
    } else if (
      roomState.phase === 'STORYTELLER_CLUE' ||
      roomState.phase === 'GUESSER_SUBMIT' ||
      roomState.phase === 'REVEAL' ||
      roomState.phase === 'VOTING'
    ) {
      soundEngine.setMood('MYSTERIOUS');
    } else if (
      roomState.phase === 'SCORING' ||
      roomState.phase === 'GARDEN_PATH' ||
      roomState.phase === 'PODIUM'
    ) {
      soundEngine.setMood('FESTIVE');
    }
  }, [inLobbyOrGame, roomState?.phase]);

  // Reset per-round selections when round or phase changes
  useEffect(() => {
    if (roomState?.phase === 'STORYTELLER_CLUE') {
      setSelectedHandCardId(null);
      setSelectedVoteCardId(null);
      setClueDraft('');
      setInspectedCardId(null);
    } else if (roomState?.phase === 'GUESSER_SUBMIT') {
      setSelectedHandCardId(null);
      setInspectedCardId(null);
    } else if (roomState?.phase === 'VOTING') {
      setSelectedVoteCardId(null);
      setInspectedCardId(null);
    }
  }, [roomState?.phase, roomState?.round]);

  // Connect PartySocket when activeRoomCode and inLobbyOrGame are set
  useEffect(() => {
    if (!activeRoomCode || !inLobbyOrGame) return;

    const cleanNick = nicknameInput.trim() || 'Dreamer';
    const cleanSeed = avatarSeed.trim() || cleanNick;

    const ps = new PartySocket({
      host: window.location.host,
      room: activeRoomCode,
    });
    socketRef.current = ps;

    ps.addEventListener('open', () => {
      const joinMsg: ClientMessage = {
        type: 'JOIN_ROOM',
        playerId,
        nickname: cleanNick,
        avatarSeed: cleanSeed,
      };
      ps.send(JSON.stringify(joinMsg));
    });

    ps.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(String(evt.data)) as ServerMessage;
        if (msg.type === 'ROOM_STATE') {
          setRoomState(msg.state);
          setYourHand(msg.yourHand);
          setYourSubmittedCardId(msg.yourSubmittedCardId);
          setYourVotedCardId(msg.yourVotedCardId);
        } else if (msg.type === 'CARDS_POOL_UPDATED') {
          setCardsPool(msg.cards);
        } else if (msg.type === 'KICKED') {
          showToast(msg.reason || 'You were removed from the room.');
          ps.close();
          setInLobbyOrGame(false);
          setActiveRoomCode(null);
          setRoomState(null);
        } else if (msg.type === 'NUDGE_ALERT') {
          if (msg.targetIds.includes(playerId)) {
            soundEngine.playNudgeChime();
            showToast(`${msg.fromHost} sent a friendly nudge — it's your turn!`);
          }
        } else if (msg.type === 'ERROR_MSG') {
          showToast(msg.message);
        }
      } catch (e) {
        console.error('Failed to parse server message:', e);
      }
    });

    return () => {
      ps.close();
      socketRef.current = null;
    };
  }, [activeRoomCode, inLobbyOrGame, playerId, nicknameInput, avatarSeed, showToast]);

  const sendMessage = useCallback((msg: ClientMessage) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const currentPlayer = useMemo(() => {
    return roomState?.players.find((p) => p.id === playerId) || null;
  }, [roomState, playerId]);

  const isHost = Boolean(currentPlayer?.isHost);
  const activeDeckId = roomState?.deckId || selectedDeckId;
  const isStoryteller = Boolean(
    roomState && roomState.storytellerId && roomState.storytellerId === playerId
  );
  const storytellerPlayer = useMemo(() => {
    return roomState?.players.find((p) => p.id === roomState.storytellerId) || null;
  }, [roomState]);

  const avatarPreviewUrl = useMemo(() => {
    return getDiceBearMarbleUrl(avatarSeed);
  }, [avatarSeed]);

  // --- Handlers for Phase 1: Landing & Lobby ---

  const handleNicknameBlur = () => {
    const trimmed = nicknameInput.trim();
    if (trimmed) {
      setAvatarSeed(trimmed);
      soundEngine.playSoftPop();
    }
  };

  const handleClickHostRoom = () => {
    soundEngine.unlockAndStart('WHIMSICAL');
    soundEngine.playClick();
    const trimmed = nicknameInput.trim();
    if (!trimmed) {
      showToast('Please enter a nickname before hosting a room.');
      return;
    }
    setAvatarSeed(trimmed);
    const newCode = generateRoomCode();
    setRoomCodeInput(newCode);
    setActiveRoomCode(newCode);
    setLandingMode('HOST');
    setIsQRModalOpen(true);
  };

  const handleClickJoinRoom = () => {
    soundEngine.unlockAndStart('WHIMSICAL');
    soundEngine.playClick();
    const trimmed = nicknameInput.trim();
    if (!trimmed) {
      showToast('Please enter a nickname before joining a room.');
      return;
    }
    setAvatarSeed(trimmed);
    setLandingMode('JOIN');
  };

  const handleReadyEnterLobby = () => {
    soundEngine.unlockAndStart('WHIMSICAL');
    const trimmedNickname = nicknameInput.trim();
    if (!trimmedNickname) {
      showToast('Please enter a nickname before joining or hosting.');
      return;
    }
    const code = (activeRoomCode || roomCodeInput).trim().toUpperCase();
    if (code.length !== 4) {
      showToast('Please enter a valid 4-character alphanumeric room code.');
      return;
    }
    setAvatarSeed(trimmedNickname);
    soundEngine.playLockIn();
    setActiveRoomCode(code);
    setIsQRModalOpen(false);
    setInLobbyOrGame(true);
  };

  const handleLeaveGame = useCallback(() => {
    sendMessage({ type: 'LEAVE_ROOM' });
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setInLobbyOrGame(false);
    setActiveRoomCode(null);
    setRoomState(null);
    setYourHand([]);
    setSelectedHandCardId(null);
    setSelectedVoteCardId(null);
    setInspectedCardId(null);
    setIsSettingsOpen(false);
    soundEngine.setMood('WHIMSICAL');
    showToast('You left the game room.');
  }, [sendMessage, showToast]);

  const pendingGuessers = useMemo(() => {
    if (!roomState) return [];
    return roomState.players.filter(
      (p) => !p.isSpectator && p.id !== roomState.storytellerId && !p.hasSubmitted
    );
  }, [roomState]);

  const pendingVoters = useMemo(() => {
    if (!roomState) return [];
    return roomState.players.filter(
      (p) => !p.isSpectator && p.id !== roomState.storytellerId && !p.hasVoted
    );
  }, [roomState]);

  const orderedHand = useMemo(() => {
    return yourHand;
  }, [yourHand]);

  // ============================================================================
  // RENDER 1: LANDING SCREEN
  // ============================================================================
  if (!inLobbyOrGame) {
    return (
      <div className="min-h-screen w-full flex flex-col justify-between bg-[#f2ede7] text-[#2b303a]">
        {/* Top Bar Contract: Zone 1 Brand | Zone 2 Nav | Zone 3 Primary Action */}
        <header className="flex items-center justify-between gap-8 px-6 sm:px-10 py-4 border-b border-[#d5cdc3]/60">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              soundEngine.playClick();
            }}
            className="text-xl font-display font-bold tracking-tight text-[#2b303a] whitespace-nowrap shrink-0"
          >
            Dixcard
          </a>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setIsSettingsOpen(true);
              }}
              className="neo-button px-4 py-2 rounded-xl text-xs font-semibold text-[#2b303a] flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5 text-[#3d7a68]" />
              <span>Settings</span>
            </button>
          </div>
        </header>

        {/* Main Centered Neomorphic Landing Split */}
        <main className="flex-1 flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left 7 Cols: Hero Showcase & Featured 3D Storybook Cards Preview */}
            <div className="lg:col-span-7 neo-surface rounded-3xl p-8 flex flex-col justify-between">
              <div>
                <h1
                  className="text-3xl sm:text-5xl font-display font-bold text-[#2b303a] leading-tight text-center"
                  style={{ textWrap: 'balance' }}
                >
                  Where Dreamlike Cards Meet Poetic Deception.
                </h1>
              </div>

              {/* Fan of 3 Uploaded Dixit Cards Preview */}
              <div className="my-6 flex items-center justify-center gap-4 sm:gap-6 py-2">
                {cardsPool.slice(0, 3).map((card, i) => (
                  <button
                    key={card.id}
                    type="button"
                    className={`neo-card p-2 rounded-2xl transition-transform duration-300 hover:-translate-y-2 ${
                      i === 0
                        ? '-rotate-6 translate-y-2'
                        : i === 2
                          ? 'rotate-6 translate-y-2'
                          : 'scale-105 z-10'
                    }`}
                  >
                    <img
                      src={card.url}
                      alt={`Card #${String(card.number).padStart(3, '0')}`}
                      referrerPolicy="no-referrer"
                      className="w-28 sm:w-36 aspect-[2/3] object-cover rounded-xl"
                    />
                  </button>
                ))}
              </div>
              <p className="text-sm sm:text-base text-[#5e6472] mt-3 leading-relaxed max-w-xl mx-auto text-center">
                AI Generated 3D storybook illustrations, craft a single clue as the Storyteller, fool your friends with clever decoys, and hop stone-by-stone up the 30-step Sanctuary Garden path.
              </p>
            </div>

            {/* Right 5 Cols: Tactile Neomorphic Player & Room Entry Card */}
            <div className="lg:col-span-5 neo-surface rounded-3xl p-8 flex flex-col justify-between">
              <div>
                <h2 className="text-2xl font-display font-bold text-[#2b303a] text-center">
                  Create Your Traveler
                </h2>

                {/* Sculpted Neomorphic Avatar Well */}
                <div className="flex flex-col items-center my-6">
                  <div className="w-24 h-24 rounded-full neo-inset p-2 flex items-center justify-center">
                    <img
                      src={avatarPreviewUrl}
                      alt="Player Marble Avatar Preview"
                      className="w-full h-full rounded-full object-cover shadow-inner"
                    />
                  </div>
                </div>

                {/* Nickname Input (Updates DiceBear Avatar onBlur as required) */}
                <div className="mb-5">
                  <label
                    htmlFor="nickname-input"
                    className="block text-xs font-semibold text-[#2b303a] mb-2"
                  >
                    Player Nickname
                  </label>
                  <input
                    id="nickname-input"
                    type="text"
                    maxLength={20}
                    placeholder="Enter your nickname..."
                    value={nicknameInput}
                    onChange={(e) => setNicknameInput(e.target.value)}
                    onBlur={handleNicknameBlur}
                    className="w-full neo-inset rounded-2xl px-4 py-3 text-sm font-medium text-[#2b303a] placeholder:text-[#5e6472]/60 focus:outline-none focus:ring-2 focus:ring-[#3d7a68]"
                  />
                </div>

                {/* Host Room & Join Room Buttons */}
                <div className="grid grid-cols-2 gap-3.5 mb-5">
                  <button
                    type="button"
                    onClick={handleClickHostRoom}
                    onMouseEnter={() => soundEngine.playHover()}
                    disabled={!nicknameInput.trim()}
                    className={`py-3.5 px-4 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
                      landingMode === 'HOST'
                        ? 'neo-button-sage'
                        : 'neo-button text-[#2b303a]'
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Host Room</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleClickJoinRoom}
                    onMouseEnter={() => soundEngine.playHover()}
                    disabled={!nicknameInput.trim()}
                    className={`py-3.5 px-4 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
                      landingMode === 'JOIN'
                        ? 'neo-button-sage'
                        : 'neo-button text-[#2b303a]'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>Join Room</span>
                  </button>
                </div>

                {/* Reveal 4-Character Code Input when Join Room or Host Room is active */}
                {(landingMode === 'JOIN' || landingMode === 'HOST') && (
                  <div className="neo-card rounded-2xl p-4 mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <label
                        htmlFor="room-code-input"
                        className="text-xs font-semibold text-[#2b303a]"
                      >
                        4-Character Room Code
                      </label>
                      {landingMode === 'HOST' && (
                        <button
                          type="button"
                          onClick={() => {
                            soundEngine.playClick();
                            setIsQRModalOpen(true);
                          }}
                          className="text-xs font-semibold text-[#3d7a68] hover:underline"
                        >
                          Show QR Code
                        </button>
                      )}
                    </div>
                    <input
                      id="room-code-input"
                      type="text"
                      maxLength={4}
                      placeholder="E.g. D1M3"
                      value={roomCodeInput}
                      onChange={(e) => {
                        const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                        setRoomCodeInput(clean);
                        if (landingMode === 'HOST' && clean.length === 4) {
                          setActiveRoomCode(clean);
                        }
                      }}
                      className="w-full neo-inset rounded-xl px-4 py-2.5 text-center font-mono-code text-xl font-bold tracking-widest uppercase text-[#e07a5f] focus:outline-none focus:ring-2 focus:ring-[#e07a5f]"
                    />
                  </div>
                )}
              </div>

              {/* Ready Button Jumps User Into Lobby Screen */}
              <button
                type="button"
                onClick={handleReadyEnterLobby}
                onMouseEnter={() => soundEngine.playHover()}
                disabled={!nicknameInput.trim() || roomCodeInput.trim().length !== 4}
                className="w-full neo-button-coral py-4 px-6 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <Check className="w-4 h-4" />
                <span>Ready · Enter Lobby</span>
              </button>
            </div>
          </div>
        </main>

        {/* Modals */}
        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        <QRCodeModal
          isOpen={isQRModalOpen}
          roomCode={activeRoomCode || roomCodeInput}
          onClose={() => setIsQRModalOpen(false)}
          onConfirmReady={handleReadyEnterLobby}
          showReadyButton={true}
        />
        <DeckInspectorModal
          isOpen={isDeckModalOpen}
          cardsPool={cardsPool}
          onClose={() => setIsDeckModalOpen(false)}
          onReloadDeck={handleReloadDeck}
        />

        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 neo-surface px-5 py-3 rounded-2xl text-xs font-semibold text-[#2b303a] shadow-lg">
            {toastMessage}
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDER 2: LOBBY SCREEN
  // ============================================================================
  if (!roomState || roomState.phase === 'LOBBY') {
    const players = roomState?.players || [];
    const connectedReadyCount = players.filter((p) => p.connected && p.isReady).length;
    const canStartGame = isHost && connectedReadyCount >= 3;

    return (
      <div className="min-h-screen w-full flex flex-col justify-between bg-[#f2ede7] text-[#2b303a]">
        {/* Top Bar Contract */}
        <header className="flex items-center justify-between gap-8 px-6 sm:px-10 py-4 border-b border-[#d5cdc3]/60">
          <span
            className="text-xl font-display font-bold tracking-tight text-[#2b303a] whitespace-nowrap shrink-0"
          >
            Dixcard
          </span>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setIsSettingsOpen(true);
              }}
              className="neo-button px-4 py-2 rounded-xl text-xs font-semibold text-[#2b303a] flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Settings className="w-3.5 h-3.5 text-[#3d7a68]" />
              <span>Settings</span>
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-6 py-8">
          <div className="w-full max-w-4xl neo-surface rounded-3xl p-8">
            {/* Lobby Header & Room Code Strip */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#d5cdc3]/60">
              <div>
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-[#2b303a]">
                  Gathering Storytellers ({connectedReadyCount} / 3+ Ready)
                </h1>
              </div>

              <div className="flex items-center gap-3">
                <div className="neo-inset px-4 py-2 rounded-2xl flex items-center gap-2.5">
                  <span className="text-xs text-[#5e6472]">Room Code:</span>
                  <span className="font-mono-code text-lg font-bold text-[#e07a5f] tracking-wider">
                    {activeRoomCode}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setIsQRModalOpen(true);
                  }}
                  className="neo-button px-4 py-2.5 rounded-2xl text-xs font-semibold text-[#2b303a] flex items-center gap-2 whitespace-nowrap"
                >
                  <QrCode className="w-4 h-4 text-[#3d7a68]" />
                  <span>Share QR</span>
                </button>
              </div>
            </div>

            {/* Connected Players Grid */}
            <div className="my-7 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {players.map((p) => {
                const isMe = p.id === playerId;
                return (
                  <div
                    key={p.id}
                    className="neo-card rounded-2xl p-4 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={p.avatarUrl}
                        alt={p.nickname}
                        className="w-12 h-12 rounded-full border-2 bg-white shrink-0"
                        style={{ borderColor: p.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#2b303a] truncate">
                          {p.nickname} {isMe ? '(You)' : ''}
                        </div>
                        <div className="text-xs text-[#5e6472]">
                          {p.isHost ? 'Host' : 'Player'} ·{' '}
                          <span className={p.isReady ? 'text-[#3d7a68] font-semibold' : ''}>
                            {p.isReady ? 'Ready' : 'Not Ready'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Host Kick Control next to each peer */}
                    {isHost && !isMe && (
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.playClick();
                          sendMessage({ type: 'KICK_PLAYER', targetPlayerId: p.id });
                        }}
                        className="neo-button p-2 rounded-xl text-[#e07a5f] hover:text-[#c95b3e] shrink-0"
                        title={`Kick ${p.nickname}`}
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Empty Slot Placeholders up to 3 minimum */}
              {Array.from({ length: Math.max(0, 3 - players.length) }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="neo-inset rounded-2xl p-4 flex items-center gap-3 opacity-75"
                >
                  <div className="w-12 h-12 rounded-full border border-dashed border-[#5e6472]/40 flex items-center justify-center text-xs font-mono-code text-[#5e6472]">
                    ?
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[#5e6472]">
                      Waiting for Player...
                    </div>
                    <div className="text-[11px] text-[#5e6472]/80">
                      Join with code {activeRoomCode}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {isHost && availableDecks.length > 0 && (
              <div className="mt-6 neo-card rounded-2xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5e6472]">
                      Table Theme
                    </div>
                    <div className="text-sm font-semibold text-[#2b303a] mt-1">
                      {availableDecks.find((deck) => deck.id === activeDeckId)?.name || 'Dreamscape'}
                    </div>
                  </div>

                  <label className="flex items-center gap-3 text-xs font-medium text-[#2b303a]">
                    <span className="text-[#5e6472]">Deck</span>
                    <select
                      value={activeDeckId}
                      onChange={(event) => {
                        const nextDeckId = event.target.value;
                        setSelectedDeckId(nextDeckId);
                        soundEngine.playClick();
                        sendMessage({ type: 'SET_ROOM_DECK', deckId: nextDeckId });
                      }}
                      className="neo-inset rounded-xl px-3 py-2 text-sm font-semibold text-[#2b303a] bg-transparent focus:outline-none focus:ring-2 focus:ring-[#3d7a68]"
                    >
                      {availableDecks.map((deck) => (
                        <option key={deck.id} value={deck.id}>
                          {deck.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {/* Bottom Lobby Actions */}
            <div className="pt-5 border-t border-[#d5cdc3]/60 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playSoftPop();
                    sendMessage({
                      type: 'TOGGLE_READY',
                      isReady: !currentPlayer?.isReady,
                    });
                  }}
                  className="neo-button px-5 py-3 rounded-2xl text-xs font-semibold text-[#2b303a] whitespace-nowrap"
                >
                  {currentPlayer?.isReady ? 'Status: Ready ✓' : 'Click to Mark Ready'}
                </button>
              </div>

              {isHost ? (
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playLockIn();
                    sendMessage({ type: 'START_GAME' });
                  }}
                  disabled={!canStartGame}
                  className="neo-button-coral px-8 py-3.5 rounded-2xl text-sm font-semibold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {canStartGame
                      ? 'Start Game'
                      : `Need ${Math.max(0, 3 - connectedReadyCount)} More Player(s)`}
                  </span>
                </button>
              ) : (
                <div className="text-xs font-medium text-[#5e6472]">
                  {connectedReadyCount >= 3
                    ? 'Waiting for Host to click Start Game...'
                    : `Waiting for ${3 - connectedReadyCount} more player(s) to join...`}
                </div>
              )}
            </div>
          </div>
        </main>

        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        <QRCodeModal
          isOpen={isQRModalOpen}
          roomCode={activeRoomCode || ''}
          onClose={() => setIsQRModalOpen(false)}
        />
        <DeckInspectorModal
          isOpen={isDeckModalOpen}
          cardsPool={cardsPool}
          onClose={() => setIsDeckModalOpen(false)}
          onReloadDeck={handleReloadDeck}
        />

        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 neo-surface px-5 py-3 rounded-2xl text-xs font-semibold text-[#2b303a] shadow-lg">
            {toastMessage}
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // RENDER 3: ACTIVE GAMEPLAY PHASES (3D TABLE / GARDEN / PODIUM)
  // ============================================================================
  const { phase, round, clue, players, revealedCards, revealedCount, lastScoreSummary } =
    roomState;
  const isStorytellerHandLocked = isStoryteller && phase !== 'STORYTELLER_CLUE';
  const pinnedSubmittedCardId =
    (phase === 'GUESSER_SUBMIT' || phase === 'REVEAL' || phase === 'VOTING')
      ? yourSubmittedCardId
      : null;
  const isHandLocked = isStorytellerHandLocked || Boolean(pinnedSubmittedCardId);
  const previewCardId = phase === 'VOTING' && !isStoryteller
    ? selectedVoteCardId ?? pinnedSubmittedCardId
    : pinnedSubmittedCardId ?? inspectedCardId;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#f2ede7] text-[#2b303a] relative">
      {/* Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3 border-b border-[#d5cdc3]/60 z-30 shrink-0 bg-[#f2ede7]/95">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            soundEngine.playClick();
          }}
          className="text-lg font-display font-bold tracking-tight text-[#2b303a] whitespace-nowrap shrink-0"
        >
          Dixcard
        </a>

        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-[#5e6472]">
          <span className="whitespace-nowrap shrink-0">
            Room <strong className="font-mono-code text-[#2b303a]">{roomState.roomCode}</strong>
          </span>
          <span className="whitespace-nowrap shrink-0">
            Round <strong className="font-mono-code text-[#2b303a]">{round}</strong>
          </span>
          <span className="whitespace-nowrap shrink-0">
            Storyteller:{' '}
            <strong className="text-[#3d7a68]">{storytellerPlayer?.nickname || '—'}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setIsQRModalOpen(true);
            }}
            className="hover:text-[#2b303a] transition-colors whitespace-nowrap shrink-0"
          >
            Invite QR
          </button>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          {isHost && (phase === 'SCORING' || phase === 'GARDEN_PATH') && (
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                sendMessage({ type: phase === 'SCORING' ? 'HOST_SKIP_PHASE' : 'NEXT_ROUND' });
              }}
              className="neo-button-sage px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              title={phase === 'SCORING' ? 'Continue to the garden scoreboard' : 'Continue to the next round'}
            >
              <FastForward className="w-3.5 h-3.5" />
              <span>Next</span>
            </button>
          )}
          {isHost &&
            (phase === 'STORYTELLER_CLUE' ||
              phase === 'GUESSER_SUBMIT' ||
              phase === 'VOTING') && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    sendMessage({ type: 'HOST_NUDGE' });
                  }}
                  className="neo-button px-3 py-1.5 rounded-xl text-xs font-semibold text-[#2b303a] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  title="Send a gentle audio chime to pending players"
                >
                  <Bell className="w-3.5 h-3.5 text-[#e07a5f]" />
                  <span>Nudge</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    sendMessage({ type: 'HOST_SKIP_PHASE' });
                  }}
                  className="neo-button px-3 py-1.5 rounded-xl text-xs font-semibold text-[#5e6472] hover:text-[#2b303a] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  title="Force advance if a player is idle"
                >
                  <FastForward className="w-3.5 h-3.5" />
                  <span>Skip Idle</span>
                </button>
              </>
            )}

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setIsSettingsOpen(true);
            }}
            className="neo-button px-3.5 py-1.5 rounded-xl text-xs font-semibold text-[#2b303a] flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Settings className="w-3.5 h-3.5 text-[#3d7a68]" />
            <span>Settings</span>
          </button>
        </div>
      </header>

      {/* Top Prominent Phase & Clue Banner Overlay */}
      {phase !== 'GARDEN_PATH' && phase !== 'PODIUM' && (
        <div className="pointer-events-none absolute inset-x-0 top-[64px] z-20  flex flex-col items-center">
          {/* Spectator Notification Banner */}
          {currentPlayer?.isSpectator && (
            <div className="mb-1 rounded-full border border-white/40 bg-white/10 backdrop-blur-[2px] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5e7ce2] flex items-center justify-center gap-1.5">
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>Spectator mode · Round {roomState.round} · active in {roomState.round + 1}</span>
            </div>
          )}

          <div className="max-w-3xl w-full text-center rounded-2xl bg-white/50 backdrop-blur-[1px] px-8 py-2">
            {phase === 'STORYTELLER_CLUE' && (
              <div>
                <h2 className="text-lg sm:text-xl font-display font-bold text-[#2b303a]">
                  {isStoryteller
                    ? 'Select a card from your hand & craft a clue'
                    : `Waiting for ${storytellerPlayer?.nickname || 'the Storyteller'} to select a card and craft a clue...`}
                </h2>
              </div>
            )}

            {phase === 'GUESSER_SUBMIT' && (
              <div>
                <p className="text-xs text-[#5e6472] mt-0.5">
                  {currentPlayer?.isSpectator
                    ? `Spectator Mode: Waiting for ${
                        pendingGuessers.length > 0
                          ? pendingGuessers.map((p) => p.nickname).join(', ')
                          : 'all guessers'
                      } to submit a decoy card...`
                    : isStoryteller
                      ? `You submitted the clue:`
                      : yourSubmittedCardId
                        ? `Decoy card submitted! Waiting for ${pendingGuessers.length} remaining guessers...`
                        : 'Select a card from your hand that best evokes the clue'}
                </p>
                <div className="text-xl sm:text-2xl font-display font-bold text-[#2b303a]">
                  “{clue}”
                </div>

                {/* Real-time status chips for all active guessers */}
                <div className="flex flex-wrap items-center justify-center gap-3 mt-2 pt-2 border-t border-[#d5cdc3]/50">
                  {players
                    .filter((p) => !p.isSpectator && p.id !== roomState.storytellerId)
                    .map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5 text-xs">
                        <img
                          src={p.avatarUrl}
                          alt={p.nickname}
                          className="w-5 h-5 rounded-full border"
                          style={{ borderColor: p.color }}
                        />
                        <span className="font-medium text-[#2b303a]">{p.nickname}</span>
                        <span className="text-[#5e6472]">·</span>
                        <span
                          className={
                            p.hasSubmitted
                              ? 'text-[#3d7a68] font-semibold'
                              : 'text-[#e07a5f] font-medium'
                          }
                        >
                          {p.hasSubmitted ? 'Submitted ✓' : 'Choosing...'}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {phase === 'REVEAL' && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-left">
                  <div className="text-xs font-semibold text-[#e07a5f]">
                    Find the Storyteller’s Card
                  </div>
                  <h2 className="text-lg font-display font-bold text-[#2b303a]">
                    {clue}
                  </h2>
                </div>
              </div>
            )}

            {phase === 'VOTING' && (
              <div>
                <div className="text-lg sm:text-xl font-display font-bold text-[#2b303a]">
                  Clue: “{clue}”
                </div>
                <p className="text-xs text-[#5e6472]">
                  {currentPlayer?.isSpectator
                    ? `Spectator Mode: Waiting for votes from ${
                        pendingVoters.length > 0
                          ? pendingVoters.map((p) => p.nickname).join(', ')
                          : 'all guessers'
                      }...`
                    : isStoryteller
                      ? `You are the Storyteller · Waiting for votes from ${
                          pendingVoters.length > 0
                            ? pendingVoters.map((p) => p.nickname).join(', ')
                            : 'all guessers'
                        }...`
                      : yourVotedCardId
                        ? `Vote locked in! Waiting for ${
                            pendingVoters.length > 0
                              ? pendingVoters.map((p) => p.nickname).join(', ')
                              : 'remaining votes'
                          }...`
                        : `Click the card you believe belongs to ${
                            storytellerPlayer?.nickname || 'the Storyteller'
                          }, then click Lock In`}
                </p>

                {/* Display all active guesser avatars with real-time vote status */}
                <div className="flex flex-wrap items-center justify-center gap-3 mt-2 pt-2 border-t border-[#d5cdc3]/50">
                  {players
                    .filter((p) => !p.isSpectator && p.id !== roomState.storytellerId)
                    .map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5 text-xs">
                        <img
                          src={p.avatarUrl}
                          alt={p.nickname}
                          className="w-5 h-5 rounded-full border"
                          style={{ borderColor: p.color }}
                        />
                        <span className="font-medium text-[#2b303a]">{p.nickname}</span>
                        <span className="text-[#5e6472]">·</span>
                        <span
                          className={
                            p.hasVoted
                              ? 'text-[#3d7a68] font-semibold'
                              : 'text-[#e07a5f] font-medium'
                          }
                        >
                          {p.hasVoted ? 'Locked In ✓' : 'Voting...'}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {phase === 'SCORING' && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-left">
                  <h2 className="text-base sm:text-lg font-display font-bold text-[#2b303a]">
                    {lastScoreSummary?.headline || `Clue: “${clue}”`}
                  </h2>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Central Stage Area: 3D Viewport OR Garden Path OR Winner Podium */}
      <div
        className="relative flex-1 w-full min-h-0"
        style={{ paddingBottom: phase === 'SCORING' ? 0 : 'clamp(2rem, 6vh, 5rem)' }}
      >
        {phase === 'GARDEN_PATH' ? (
          <GardenScoringBoard
            players={players}
            scoreSummary={lastScoreSummary}
            isHost={isHost}
            onNextRound={() => sendMessage({ type: 'NEXT_ROUND' })}
          />
        ) : phase === 'PODIUM' ? (
          <WinnerPodiumScreen
            players={players}
            winnerIds={roomState.winnerIds}
            onPlayAgain={() => sendMessage({ type: 'PLAY_AGAIN' })}
          />
        ) : (
          <ThreeCardViewport
            phase={phase}
            cardsPool={cardsPool}
            inspectedCardId={phase === 'SCORING' ? null : previewCardId}
            onCloseInspect={() => {
              if (!pinnedSubmittedCardId) setInspectedCardId(null);
            }}
            revealedCards={revealedCards}
            revealedCount={revealedCount}
            selectedVoteCardId={selectedVoteCardId}
            onSelectVoteCard={(cid) => setSelectedVoteCardId(cid)}
            yourSubmittedCardId={yourSubmittedCardId}
            storytellerCardId={
              phase === 'SCORING'
                ? lastScoreSummary?.storytellerCardId || null
                : null
            }
            players={players}
            currentPlayerId={playerId}
          />
        )}
      </div>

      {/* Always-visible player hand dock */}
      {phase !== 'SCORING' && phase !== 'GARDEN_PATH' && phase !== 'PODIUM' && (
        <div
          className="fixed bottom-2 left-1/2 -translate-x-1/2 z-30 w-full px-3"
          style={{ maxWidth: 'min(960px, 97vw)' }}
        >
          <div className={`neo-surface rounded-3xl transition-transform duration-200 ${phase === 'VOTING' ? 'p-2 sm:p-2.5' : 'p-3 sm:p-4'}`}>
            {currentPlayer?.isSpectator ? (
              <div className="py-2 px-4 text-center">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5e7ce2] flex items-center justify-center gap-2 mb-1">
                  <Eye className="w-3.5 h-3.5" />
                  <span>Spectator hand</span>
                </div>
                <p className="text-[11px] text-[#5e6472] max-w-lg mx-auto">
                  Joined mid-game · inspect the 3D table and you’ll enter active play in Round {roomState.round + 1}.
                </p>
              </div>
            ) : (
              <>
                {/* Row 1: Contextual Phase Action Bar (Storyteller Clue Input / Guesser Submit / Voting Lock In) */}
                {phase === 'STORYTELLER_CLUE' && isStoryteller && (
                  <div className="flex flex-nowrap items-center gap-3 mb-4 pb-3 border-b border-[#d5cdc3]/60">
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        maxLength={50}
                        placeholder={
                          selectedHandCardId
                            ? 'Type a clue, phrase, concept or sound for your selected card...'
                            : 'Pick one of your cards below to select & preview...'
                        }
                        value={clueDraft}
                        onChange={(e) => setClueDraft(e.target.value)}
                        className="w-full neo-inset rounded-xl px-4 py-2.5 text-xs sm:text-sm font-medium text-[#2b303a] placeholder:text-[#5e6472]/70 focus:outline-none focus:ring-2 focus:ring-[#3d7a68]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!selectedHandCardId || !clueDraft.trim()}
                      onClick={() => {
                        if (!selectedHandCardId || !clueDraft.trim()) return;
                        soundEngine.playLockIn();
                        sendMessage({
                          type: 'SUBMIT_STORYTELLER_CLUE',
                          cardId: selectedHandCardId,
                          clue: clueDraft.trim(),
                        });
                        setInspectedCardId(selectedHandCardId);
                      }}
                      className="neo-button-coral px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Clue</span>
                    </button>
                  </div>
                )}

                {phase === 'GUESSER_SUBMIT' && !isStoryteller && (
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-[#d5cdc3]/60">
                    <div className="text-xs font-medium text-[#2b303a]">
                      {yourSubmittedCardId
                        ? 'Your decoy card is submitted! Waiting for other guessers...'
                        : selectedHandCardId
                          ? 'Click Submit to lock it in.'
                          : 'Click any card to inspect.'}
                    </div>
                    {!yourSubmittedCardId && (
                      <button
                        type="button"
                        disabled={!selectedHandCardId}
                        onClick={() => {
                          if (!selectedHandCardId) return;
                          soundEngine.playLockIn();
                          sendMessage({
                            type: 'SUBMIT_GUESSER_CARD',
                            cardId: selectedHandCardId,
                          });
                          setInspectedCardId(selectedHandCardId);
                        }}
                        className="neo-button-coral px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Submit Decoy Card</span>
                      </button>
                    )}
                  </div>
                )}

                {phase === 'VOTING' && !isStoryteller && (
                  <div className="flex items-center justify-between gap-2 mb-1.5 pb-1.5 border-b border-[#d5cdc3]/60">
                    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-1">
                      {revealedCards.map((entry, idx) => {
                        const isOwn = entry.cardId === yourSubmittedCardId;
                        const isSelected = entry.cardId === selectedVoteCardId;
                        const meta = cardsPool.find((c) => c.id === entry.cardId);
                        return (
                          <button
                            key={entry.cardId}
                            type="button"
                            disabled={isOwn || Boolean(yourVotedCardId)}
                            onClick={() => {
                              soundEngine.playCardSelect();
                              setSelectedVoteCardId(entry.cardId);
                            }}
                            className={`shrink-0 px-2 py-1.5 rounded-xl text-[10px] sm:text-xs font-semibold flex items-center gap-1 transition-all whitespace-nowrap ${
                              isOwn
                                ? 'neo-inset text-[#5e6472]/50 grayscale cursor-not-allowed'
                                : isSelected
                                  ? 'neo-button-coral'
                                  : 'neo-button text-[#2b303a]'
                            }`}
                          >
                            <span>Vote Card #{idx + 1}</span>
                            {isOwn && <span>(Yours)</span>}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      disabled={!selectedVoteCardId || Boolean(yourVotedCardId)}
                      onClick={() => {
                        if (!selectedVoteCardId) return;
                        soundEngine.playLockIn();
                        sendMessage({
                          type: 'LOCK_IN_VOTE',
                          cardId: selectedVoteCardId,
                        });
                      }}
                      className="neo-button-sage px-3 py-2 rounded-xl text-[10px] sm:text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>{yourVotedCardId ? 'Vote Locked In ✓' : 'Lock In Vote'}</span>
                    </button>
                  </div>
                )}

                {/* Row 2: View all submitted cards in a scrollable tray during voting; otherwise show player hand */}
                {phase === 'VOTING' && !isStoryteller ? (
                  <div className="mt-1">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <div className="text-[10px] font-semibold text-[#5e6472] flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[#3d7a68]" />
                        <span>All Submitted Cards · Scroll to compare every option</span>
                      </div>
                    </div>

                    <div
                      ref={voteTrayScroll.ref}
                      onPointerDown={voteTrayScroll.onPointerDown}
                      onPointerMove={voteTrayScroll.onPointerMove}
                      onPointerUp={voteTrayScroll.onPointerUp}
                      onPointerLeave={voteTrayScroll.onPointerUp}
                      className="mouse-drag-scroll overflow-x-auto pt-1 pb-1 -mx-1 px-1"
                    >
                      <div className="flex min-w-max gap-2">
                        {revealedCards.map((entry, idx) => {
                          const isOwn = entry.cardId === yourSubmittedCardId;
                          const isSelected = entry.cardId === selectedVoteCardId;
                          const cardMeta = cardsPool.find((c) => c.id === entry.cardId);

                          return (
                            <button
                              key={entry.cardId}
                              type="button"
                              disabled={isOwn || Boolean(yourVotedCardId)}
                              onClick={() => {
                                if (isOwn || yourVotedCardId) return;
                                soundEngine.playCardSelect();
                                setSelectedVoteCardId(entry.cardId);
                              }}
                              className={`group relative shrink-0 rounded-xl p-1 transition-all duration-200 text-left ${
                                isOwn
                                  ? 'bg-[#f4efe9] opacity-55 grayscale cursor-not-allowed'
                                  : isSelected
                                    ? 'bg-[#fdf1d4] ring-2 ring-[#e07a5f] -translate-y-1 shadow-md'
                                    : 'neo-card hover:-translate-y-1'
                              }`}
                            >
                              <div className="relative w-[clamp(40px,8vh,64px)] sm:w-[clamp(48px,9vh,80px)] aspect-[2/3] overflow-hidden rounded-lg bg-[#ebe5de]">
                                {cardMeta ? (
                                  <img
                                    src={cardMeta.url}
                                    alt={`Submitted Card ${idx + 1}`}
                                    referrerPolicy="no-referrer"
                                    loading="lazy"
                                    decoding="async"
                                    fetchPriority="low"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[10px] font-mono-code text-[#5e6472]">
                                    {entry.cardId}
                                  </div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 via-black/5 to-transparent px-2 py-1.5 text-[10px] font-semibold text-white">
                                  {isOwn ? 'Your Card' : `Card ${idx + 1}`}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-[#5e6472] flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[#3d7a68]" />
                        <span>Your Hand ({yourHand.length} Cards)</span>
                        {isHandLocked && (
                          <span className="flex items-center gap-1 text-[#3d7a68]">
                            <Lock className="w-3 h-3" />
                            Card submitted.
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-6 gap-2 sm:gap-3 justify-items-center lg:scale-[0.9] lg:origin-bottom">
                      {orderedHand.map((cid) => {
                        const cardMeta = cardsPool.find((c) => c.id === cid);
                        const isSelected = (isHandLocked ? yourSubmittedCardId : selectedHandCardId) === cid;
                        const isInspected = (pinnedSubmittedCardId ?? inspectedCardId) === cid;
                        return (
                          <button
                            key={cid}
                            type="button"
                            disabled={isHandLocked}
                            onMouseEnter={() => {
                              if (!isHandLocked) soundEngine.playHover();
                              if (cardMeta) prefetchCardImage(cardMeta.url);
                            }}
                            onFocus={() => {
                              if (cardMeta) prefetchCardImage(cardMeta.url);
                            }}
                            onClick={() => {
                              if (isHandLocked) return;
                              soundEngine.playCardSelect();
                              const isActive = selectedHandCardId === cid || inspectedCardId === cid;
                              setSelectedHandCardId(isActive ? null : cid);
                              setInspectedCardId((prev) => (prev === cid ? null : cid));
                            }}
                            className={`group relative rounded-xl p-1 transition-all duration-200 disabled:cursor-not-allowed ${
                              isSelected || isInspected
                                ? 'bg-[#fdf1d4] ring-2 ring-[#e07a5f] -translate-y-2 shadow-md'
                                : isHandLocked
                                  ? 'neo-card opacity-50'
                                : 'neo-card hover:-translate-y-1'
                            }`}
                          >
                            <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-[#ebe5de]">
                              {cardMeta ? (
                                <img
                                  src={cardMeta.url}
                                  alt={`Card #${String(cardMeta.number).padStart(3, '0')}`}
                                  referrerPolicy="no-referrer"
                                  loading="lazy"
                                  decoding="async"
                                  fetchPriority="low"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] font-mono-code text-[#5e6472]">
                                  {cid}
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors flex items-center justify-center">
                                <Eye className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Shared Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onLeaveGame={handleLeaveGame}
      />
      <QRCodeModal
        isOpen={isQRModalOpen}
        roomCode={roomState.roomCode}
        onClose={() => setIsQRModalOpen(false)}
      />
      <DeckInspectorModal
        isOpen={isDeckModalOpen}
        cardsPool={cardsPool}
        onClose={() => setIsDeckModalOpen(false)}
        onReloadDeck={handleReloadDeck}
        onInspectCard3D={(cid) => setInspectedCardId(cid)}
      />

      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 neo-surface px-5 py-3 rounded-2xl text-xs font-semibold text-[#2b303a] shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
