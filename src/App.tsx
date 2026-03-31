/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { 
  Layers, 
  Trophy, 
  RotateCcw, 
  User, 
  ArrowRight, 
  AlertCircle 
} from "lucide-react";
import confetti from "canvas-confetti";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Tile {
  id: string;
  symbol: string;
  owner: number;
  isRevealed: boolean;
}

interface Player {
  id: string;
  name: string;
  grid: Tile[][];
}

interface GameState {
  players: Player[];
  activeTile: Tile | null;
  turn: number;
  status: "waiting" | "rolling" | "playing" | "finished";
  winner: string | null;
  diceResults: { p1: number; p2: number } | null;
  timer: number;
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("gameState", (state: GameState) => {
      setGameState(state);
      if (state.status === "finished" && state.winner) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    });

    newSocket.on("error", (msg: string) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const joinGame = () => {
    if (socket && playerName.trim()) {
      socket.emit("joinGame", playerName);
      setIsJoined(true);
    }
  };

  const rollDice = () => {
    if (socket) socket.emit("rollDice");
  };

  const pushTile = (colIndex: number) => {
    if (socket) socket.emit("pushTile", colIndex);
  };

  const resetGame = () => {
    if (socket) socket.emit("resetGame");
  };

  if (!gameState) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-orange-500 font-mono text-sm tracking-widest uppercase">Sunucuya Bağlanılıyor...</p>
        </div>
      </div>
    );
  }

  const myPlayerIndex = gameState.players.findIndex(p => p.id === socket?.id);
  const myPlayer = myPlayerIndex !== -1 ? gameState.players[myPlayerIndex] : null;
  const isMyTurn = myPlayerIndex !== -1 && gameState.turn === myPlayerIndex;

  // Lobby View
  if (gameState.status === "waiting") {
    if (!isJoined) {
      return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 font-mono">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md bg-[#151619] border border-[#2a2b2e] rounded-2xl p-8 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(249,115,22,0.4)]">
                <Layers className="text-black w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tighter uppercase">Mahjong Push</h1>
                <p className="text-[10px] text-zinc-500 tracking-widest uppercase">Tek Masa • 1v1</p>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Oyuncu Adı</label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Adınızı girin..."
                  className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                />
              </div>

              <button 
                onClick={joinGame}
                disabled={!playerName.trim() || gameState.players.length >= 2}
                className="w-full py-4 bg-orange-500 text-black font-bold rounded-xl hover:bg-orange-400 active:scale-95 transition-all uppercase tracking-widest disabled:opacity-50 disabled:grayscale"
              >
                Masaya Otur
              </button>

              {gameState.players.length > 0 && (
                <div className="pt-4 border-t border-[#2a2b2e]">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Masadaki Oyuncu</p>
                  <div className="flex items-center gap-2 text-sm text-orange-500">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    {gameState.players[0].name}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      );
    } else {
      return (
        <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 font-mono">
          <div className="text-center space-y-6">
            <div className="w-20 h-20 bg-orange-500/10 border-2 border-orange-500 rounded-2xl flex items-center justify-center mx-auto animate-bounce shadow-[0_0_30px_rgba(249,115,22,0.2)]">
              <User className="w-10 h-10 text-orange-500" />
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tighter italic">RAKİP BEKLENİYOR...</h2>
            <p className="text-zinc-500 text-sm uppercase tracking-widest">Masa Hazırlanıyor</p>
            
            {gameState.players.length === 1 && (
              <button 
                onClick={() => socket?.emit("playWithRobot")}
                className="mt-8 px-8 py-3 bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700 active:scale-95 transition-all uppercase tracking-widest border border-zinc-700"
              >
                Robot ile Oyna
              </button>
            )}
          </div>
        </div>
      );
    }
  }

  // Rolling Dice View
  if (gameState.status === "rolling") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 font-mono">
        <div className="text-center space-y-8">
          <h2 className="text-2xl font-bold uppercase tracking-tighter italic">KİM BAŞLAYACAK?</h2>
          
          <div className="flex gap-12 items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">{gameState.players[0].name}</span>
              <div className="w-20 h-20 bg-[#151619] border-2 border-orange-500 rounded-2xl flex items-center justify-center text-4xl font-semibold">
                {gameState.diceResults?.p1 || "?"}
              </div>
            </div>
            <div className="text-orange-500 font-semibold text-2xl">VS</div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">{gameState.players[1].name}</span>
              <div className="w-20 h-20 bg-[#151619] border-2 border-orange-500 rounded-2xl flex items-center justify-center text-4xl font-semibold">
                {gameState.diceResults?.p2 || "?"}
              </div>
            </div>
          </div>

          <button 
            onClick={rollDice}
            className="px-12 py-4 bg-orange-500 text-black font-semibold rounded-xl hover:bg-orange-400 active:scale-95 transition-all uppercase tracking-widest shadow-[0_0_30px_rgba(249,115,22,0.3)]"
          >
            Zar At
          </button>
        </div>
      </div>
    );
  }

  // Game Finished View
  if (gameState.status === "finished") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-6 font-mono">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center space-y-8"
        >
          <div className="w-32 h-32 bg-orange-500/10 border-2 border-orange-500 rounded-full flex items-center justify-center mx-auto shadow-[0_0_50px_rgba(249,115,22,0.2)]">
            <Trophy className="w-16 h-16 text-orange-500" />
          </div>
          <div>
            <h1 className="text-4xl font-semibold uppercase tracking-tighter italic">OYUN BİTTİ</h1>
            <p className="text-xl text-orange-500 font-medium mt-2 uppercase tracking-widest">Kazanan: {gameState.winner}</p>
          </div>
          <button 
            onClick={resetGame}
            className="px-12 py-4 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 active:scale-95 transition-all uppercase tracking-widest"
          >
            Yeni Oyun
          </button>
        </motion.div>
      </div>
    );
  }

  // Main Game View
  const activePlayer = gameState.players[gameState.turn];
  const displayPlayer = activePlayer || gameState.players[0];

  if (!displayPlayer) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-mono overflow-hidden">
      
      {/* Header */}
      <header className="h-16 border-b border-[#2a2b2e] bg-[#151619] flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-2 h-2 rounded-full",
            isMyTurn ? "bg-green-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]" : "bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]"
          )} />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-zinc-400">
              {isMyTurn ? "Sizin Sıranız" : "Rakibin Sırası"}
            </span>
            <span className="text-xs font-semibold uppercase text-white">
              {displayPlayer.name} Tahtası
            </span>
          </div>
        </div>

        {/* Timer Display */}
        <div className="flex flex-col items-center">
          <div className={cn(
            "text-2xl font-semibold transition-colors duration-300",
            gameState.timer <= 3 ? "text-red-500 animate-pulse" : "text-orange-500"
          )}>
            {gameState.timer < 10 ? `0${gameState.timer}` : gameState.timer}
          </div>
          <div className="w-24 h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
            <motion.div 
              initial={false}
              animate={{ width: `${(gameState.timer / 10) * 100}%` }}
              className={cn(
                "h-full transition-colors duration-300",
                gameState.timer <= 3 ? "bg-red-500" : "bg-orange-500"
              )}
            />
          </div>
        </div>

        <button onClick={resetGame} className="p-2 hover:bg-[#2a2b2e] rounded-lg transition-colors">
          <RotateCcw className="w-4 h-4 text-zinc-500" />
        </button>
      </header>

      {/* Main Game Area */}
      <main className="flex-1 relative flex flex-col">
        
        {/* Turn Overlay (Dimming) */}
        {!isMyTurn && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center pointer-events-none"
          >
            <div className="bg-orange-500 text-black px-6 py-2 rounded-full font-semibold text-sm uppercase tracking-tighter shadow-2xl animate-pulse">
              RAKİP HAMLESİ İZLENİYOR...
            </div>
          </motion.div>
        )}

        {/* The Grid Container */}
        <div className="flex-1 flex flex-col items-center justify-center p-1 sm:p-6">
          <div className="w-full max-w-[500px] aspect-square bg-[#151619] border-2 border-[#2a2b2e] rounded-2xl sm:rounded-3xl p-1.5 sm:p-3 shadow-2xl flex flex-col relative">
            
            {/* Push Buttons */}
            <div className="grid grid-cols-6 gap-1 sm:gap-2 mb-1.5 sm:mb-3">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <button
                  key={i}
                  disabled={!isMyTurn}
                  onClick={() => pushTile(i)}
                  className={cn(
                    "aspect-square rounded-lg sm:rounded-xl flex items-center justify-center transition-all active:scale-90 border-2",
                    isMyTurn 
                      ? "bg-orange-500 text-black border-orange-400 shadow-[0_3px_0_rgb(194,65,12)] sm:shadow-[0_5px_0_rgb(194,65,12)]" 
                      : "bg-[#0a0a0a] text-zinc-800 border-[#2a2b2e] opacity-50"
                  )}
                >
                  <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 rotate-90" />
                </button>
              ))}
            </div>

            {/* Tiles Grid */}
            <div className="flex-1 grid grid-cols-6 gap-1 sm:gap-2">
              {displayPlayer.grid.map((col, colIdx) => (
                <div key={colIdx} className="flex flex-col gap-1 sm:gap-2">
                  {/* Render existing tiles */}
                  {col.map((tile) => (
                    <motion.div 
                      key={tile.id}
                      layout
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={cn(
                        "flex-1 rounded-lg sm:rounded-xl flex items-center justify-center text-4xl sm:text-6xl transition-all duration-500 shadow-inner",
                        tile.isRevealed 
                          ? "bg-[#fdfcf0] text-black border-b-2 sm:border-b-4 border-zinc-300" 
                          : "bg-zinc-800/50 border border-zinc-700/30 text-transparent"
                      )}
                    >
                      {tile.isRevealed ? tile.symbol : ""}
                    </motion.div>
                  ))}
                  {/* Fill remaining slots with empty divs */}
                  {Array.from({ length: 6 - col.length }).map((_, i) => (
                    <div 
                      key={`empty-${colIdx}-${i}`}
                      className="flex-1 rounded-lg sm:rounded-xl bg-zinc-800/30 border border-zinc-700/10"
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Active Tile Display (Bottom) */}
        <div className="h-40 sm:h-48 bg-[#151619] border-t-2 border-[#2a2b2e] flex flex-col items-center justify-center gap-2 sm:gap-4 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1 sm:mb-2">
                {isMyTurn ? "SIRADAKİ TAŞINIZ" : "RAKİBİN ELİNDEKİ"}
              </span>
              
              <AnimatePresence mode="wait">
                {gameState.activeTile && (
                  <motion.div
                    key={gameState.activeTile.id}
                    initial={{ scale: 0.5, opacity: 0, rotate: -10 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 1.5, opacity: 0, rotate: 10 }}
                    className={cn(
                      "w-16 h-20 sm:w-20 sm:h-24 rounded-xl sm:rounded-2xl flex items-center justify-center text-5xl sm:text-6xl shadow-2xl border-2",
                      isMyTurn 
                        ? "bg-[#fdfcf0] text-black border-zinc-300 border-b-4 sm:border-b-8" 
                        : "bg-zinc-800 text-zinc-600 border-zinc-700 grayscale"
                    )}
                  >
                    {gameState.activeTile.symbol}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {!isMyTurn && (
            <div className="flex items-center gap-2 text-orange-500">
              <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-ping" />
              <span className="text-[10px] uppercase tracking-widest">Rakip Düşünüyor...</span>
            </div>
          )}
        </div>

      </main>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-6 left-6 right-6 bg-red-500 text-white p-4 rounded-xl flex items-center gap-3 shadow-2xl z-50"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-xs uppercase tracking-widest">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
