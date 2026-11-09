import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Check,
  Copy,
  Crown,
  LogOut,
  Maximize2,
  Minimize2,
  Music,
  QrCode,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { soundEngine } from '../audio/soundEngine';
import type { CardAsset, Player } from '../types/game';
import { prefetchCardImage } from '../types/game';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLeaveGame?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onLeaveGame,
}) => {
  const [settings, setSettings] = useState(() => soundEngine.getSettings());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(
    typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  );

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  if (!isOpen) return null;

  const handleToggleFullscreen = async () => {
    soundEngine.playClick();
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore iframe fullscreen restrictions if blocked by host browser
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b303a]/35 px-4">
      <div className="neo-surface rounded-3xl p-7 w-full max-w-md relative">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-display font-bold text-[#2b303a]">
              Studio & Audio Settings
            </h3>
            <p className="text-xs text-[#5e6472]">
              Customize Web Audio soundscapes and display mode
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              onClose();
            }}
            className="neo-button w-9 h-9 rounded-xl flex items-center justify-center text-[#2b303a]"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5">
          {/* Music Volume */}
          <div className="neo-card rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label
                htmlFor="music-vol-slider"
                className="text-xs font-semibold text-[#2b303a] flex items-center gap-2"
              >
                <Music className="w-4 h-4 text-[#3d7a68]" />
                <span>Ambient Music Volume</span>
              </label>
              <span className="text-xs font-mono-code font-semibold text-[#5e6472]">
                {Math.round(settings.musicVolume * 100)}%
              </span>
            </div>
            <input
              id="music-vol-slider"
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={settings.musicVolume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                const next = { ...settings, musicVolume: val };
                setSettings(next);
                soundEngine.updateSettings({ musicVolume: val });
              }}
              className="w-full accent-[#3d7a68] cursor-pointer"
            />
          </div>

          {/* SFX Volume */}
          <div className="neo-card rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <label
                htmlFor="sfx-vol-slider"
                className="text-xs font-semibold text-[#2b303a] flex items-center gap-2"
              >
                <Volume2 className="w-4 h-4 text-[#e07a5f]" />
                <span>Tactile SFX Volume</span>
              </label>
              <span className="text-xs font-mono-code font-semibold text-[#5e6472]">
                {Math.round(settings.sfxVolume * 100)}%
              </span>
            </div>
            <input
              id="sfx-vol-slider"
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={settings.sfxVolume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                const next = { ...settings, sfxVolume: val };
                setSettings(next);
                soundEngine.updateSettings({ sfxVolume: val });
              }}
              onMouseUp={() => soundEngine.playSoftPop()}
              className="w-full accent-[#e07a5f] cursor-pointer"
            />
          </div>

          {/* Mute Toggle & Fullscreen */}
          <div className="grid grid-cols-2 gap-3.5">
            <button
              type="button"
              onClick={() => {
                const nextMute = !settings.isMuted;
                setSettings({ ...settings, isMuted: nextMute });
                soundEngine.updateSettings({ isMuted: nextMute });
                if (!nextMute) soundEngine.playSoftPop();
              }}
              className={`py-3 px-4 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap ${
                settings.isMuted ? 'neo-button-coral' : 'neo-button text-[#2b303a]'
              }`}
            >
              {settings.isMuted ? (
                <>
                  <VolumeX className="w-4 h-4" />
                  <span>Audio Muted</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4 text-[#3d7a68]" />
                  <span>Mute All Audio</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="neo-button py-3 px-4 rounded-2xl text-xs font-semibold text-[#2b303a] flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-4 h-4 text-[#e07a5f]" />
                  <span>Exit Fullscreen</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-4 h-4 text-[#3d7a68]" />
                  <span>Fullscreen</span>
                </>
              )}
            </button>
          </div>

          {/* Leave Game Option */}
          {onLeaveGame && (
            <div className="pt-2 border-t border-[#d5cdc3]/60">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playSoftPop();
                  if (
                    window.confirm(
                      'Are you sure you want to leave this game room? You will be removed from the active players roster.'
                    )
                  ) {
                    soundEngine.playClick();
                    onLeaveGame();
                  }
                }}
                className="w-full neo-button-coral py-3 px-4 rounded-2xl text-xs font-semibold text-[#a84429] hover:text-[#91341c] flex items-center justify-center gap-2 whitespace-nowrap transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span>Leave Game Room</span>
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-[#d5cdc3]/60 flex justify-end">
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              onClose();
            }}
            className="neo-button-sage px-6 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

interface QRCodeModalProps {
  isOpen: boolean;
  roomCode: string;
  onClose: () => void;
  onConfirmReady?: () => void;
  showReadyButton?: boolean;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({
  isOpen,
  roomCode,
  onClose,
  onConfirmReady,
  showReadyButton = false,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !roomCode) return null;

  const shareUrl = `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`;

  const handleCopy = async () => {
    soundEngine.playSoftPop();
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b303a]/35 px-4">
      <div className="neo-surface rounded-3xl p-7 w-full max-w-md text-center relative">
        <button
          type="button"
          onClick={() => {
            soundEngine.playClick();
            onClose();
          }}
          className="neo-button w-9 h-9 rounded-xl flex items-center justify-center text-[#2b303a] absolute top-5 right-5"
          aria-label="Close QR Modal"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl neo-inset mb-3 text-[#3d7a68]">
          <QrCode className="w-6 h-6" />
        </div>

        <h3 className="text-2xl font-display font-bold text-[#2b303a]">
          Invite Players to Room
        </h3>
        <p className="text-xs text-[#5e6472] mt-1">
          Scan the QR code or enter the 4-character room code to join
        </p>

        {/* 4-Character Alphanumeric Code Display */}
        <div className="my-5 neo-inset rounded-2xl py-3.5 px-6 inline-block">
          <div className="text-[11px] font-semibold text-[#5e6472] mb-0.5">
            Room Code
          </div>
          <div className="text-3xl font-mono-code font-bold tracking-widest text-[#e07a5f]">
            {roomCode}
          </div>
        </div>

        {/* Crisp QR Code Well */}
        <div className="flex justify-center mb-5">
          <div className="neo-card p-4 rounded-2xl bg-white inline-block">
            <QRCodeSVG
              value={shareUrl}
              size={176}
              bgColor="#ffffff"
              fgColor="#2b303a"
              level="M"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 neo-button py-3 px-4 rounded-2xl text-xs font-semibold text-[#2b303a] flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-[#3d7a68]" />
                <span>Invite Link Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-[#5e6472]" />
                <span>Copy Room Link</span>
              </>
            )}
          </button>

          {showReadyButton && onConfirmReady ? (
            <button
              type="button"
              onClick={() => {
                soundEngine.playLockIn();
                onConfirmReady();
              }}
              className="flex-1 neo-button-coral py-3 px-5 rounded-2xl text-xs font-semibold whitespace-nowrap"
            >
              Ready · Enter Lobby
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onClose();
              }}
              className=" neo-button-sage py-3 px-5 rounded-2xl text-xs font-semibold whitespace-nowrap"
            >
              Back to Room
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface DeckInspectorModalProps {
  isOpen: boolean;
  cardsPool: CardAsset[];
  onClose: () => void;
  onReloadDeck: () => Promise<void>;
  onInspectCard3D?: (cardId: string) => void;
}

export const DeckInspectorModal: React.FC<DeckInspectorModalProps> = ({
  isOpen,
  cardsPool,
  onClose,
  onReloadDeck,
  onInspectCard3D,
}) => {
  const [reloading, setReloading] = useState(false);

  if (!isOpen) return null;

  const handleReload = async () => {
    soundEngine.playClick();
    setReloading(true);
    try {
      await onReloadDeck();
      soundEngine.playSoftPop();
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b303a]/40 px-4 py-6">
      <div className="neo-surface rounded-3xl p-6 sm:p-7 w-full max-w-4xl max-h-[88vh] flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#d5cdc3]/60">
          <div>
            <h3 className="text-xl font-display font-bold text-[#2b303a]">
              Fixed Dixcard Deck ({cardsPool.length} Cards)
            </h3>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReload}
              disabled={reloading}
              className="neo-button-sage px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reloading ? 'animate-spin' : ''}`} />
              <span>{reloading ? 'Scanning Folders...' : 'Hot-Reload Folder & Config'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onClose();
              }}
              className="neo-button w-9 h-9 rounded-xl flex items-center justify-center text-[#2b303a]"
              aria-label="Close deck inspector"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-5 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4 pr-1">
          {cardsPool.map((card) => (
            <button
              key={card.id}
              type="button"
              onMouseEnter={() => prefetchCardImage(card.url)}
              onFocus={() => prefetchCardImage(card.url)}
              onClick={() => {
                soundEngine.playCardSelect();
                if (onInspectCard3D) {
                  onClose();
                  onInspectCard3D(card.id);
                }
              }}
              className="group neo-card rounded-2xl p-2 text-left transition-transform hover:-translate-y-1"
            >
              <div className="relative w-full aspect-[2/3] rounded-xl overflow-hidden bg-[#ebe5de]">
                <img
                  src={card.url}
                  alt={`Card #${String(card.number).padStart(3, '0')}`}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

interface WinnerPodiumScreenProps {
  players: Player[];
  winnerIds: string[];
  onPlayAgain: () => void;
}

export const WinnerPodiumScreen: React.FC<WinnerPodiumScreenProps> = ({
  players,
  winnerIds,
  onPlayAgain,
}) => {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const topWinner = sorted[0];

  useEffect(() => {
    soundEngine.playVictoryFanfare();
    try {
      confetti({
        particleCount: 85,
        spread: 75,
        origin: { y: 0.55 },
        colors: ['#e07a5f', '#3d7a68', '#f4b942', '#9b6b9e', '#5e7ce2'],
      });
    } catch {
      // Ignore if canvas-confetti fails in headless
    }
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-center px-6 py-8 overflow-y-auto">
      <div className="neo-surface rounded-3xl p-8 sm:p-10 w-full max-w-3xl text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#fdf1d4] border border-[#d49a3a]/40 text-[#b57c1e] mb-4 shadow-sm">
          <Crown className="w-7 h-7" />
        </div>

        <div className="text-xs font-semibold text-[#3d7a68] mb-1">
          30th Garden Stone Reached
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-bold text-[#2b303a]">
          {topWinner ? `${topWinner.nickname} Triumphs!` : 'Garden Sanctuary Reached!'}
        </h1>
        <p className="text-sm text-[#5e6472] mt-1 max-w-md mx-auto">
          Through poetic clues and clever decoys, the sanctuary gate at the 30th stone has opened.
        </p>

        {/* Top 3 Podium Pillars */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 my-8 items-end">
          {sorted.slice(0, 3).map((p, idx) => {
            const isChampion = idx === 0 || winnerIds.includes(p.id);
            const rankLabels = ['1st Place · Champion', '2nd Place', '3rd Place'];
            return (
              <div
                key={p.id}
                className={`neo-card rounded-2xl p-5 flex flex-col items-center ${
                  idx === 0 ? 'sm:-translate-y-3 border-2 border-[#d49a3a]' : ''
                }`}
              >
                <div className="relative mb-3">
                  <img
                    src={p.avatarUrl}
                    alt={p.nickname}
                    className="w-16 h-16 rounded-full border-4 bg-white shadow-sm"
                    style={{ borderColor: p.color }}
                  />
                  {isChampion && (
                    <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-[#fdf1d4] border border-[#d49a3a] flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-[#b57c1e]" />
                    </span>
                  )}
                </div>
                <div className="text-xs font-semibold text-[#5e6472]">
                  {rankLabels[idx] || `${idx + 1}th Place`}
                </div>
                <div className="text-base font-display font-bold text-[#2b303a] mt-0.5 truncate max-w-full">
                  {p.nickname}
                </div>
                <div className="mt-2 text-lg font-mono-code font-bold text-[#3d7a68]">
                  {p.score} pts
                </div>
              </div>
            );
          })}
        </div>

        {/* Remaining Players */}
        {sorted.length > 3 && (
          <div className="neo-inset rounded-2xl p-4 mb-6 space-y-2 text-left">
            {sorted.slice(3).map((p, idx) => (
              <div key={p.id} className="flex items-center justify-between text-xs py-1 px-2">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono-code text-[#5e6472]">{idx + 4}.</span>
                  <img src={p.avatarUrl} alt={p.nickname} className="w-6 h-6 rounded-full" />
                  <span className="font-semibold text-[#2b303a]">{p.nickname}</span>
                </div>
                <span className="font-mono-code font-bold text-[#2b303a]">{p.score} pts</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              soundEngine.playLockIn();
              onPlayAgain();
            }}
            className="neo-button-coral py-3.5 px-8 rounded-2xl text-sm font-semibold flex items-center gap-2 whitespace-nowrap"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Play Again</span>
          </button>
        </div>
      </div>
    </div>
  );
};
