import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

interface Tile {
  id: string;
  symbol: string;
  owner: number; // 0 or 1
  isRevealed: boolean;
}

interface Player {
  id: string;
  name: string;
  grid: Tile[][]; // 6 columns, each with 6 tiles
}

interface GameState {
  players: Player[];
  activeTile: Tile | null;
  turn: number; // 0 or 1
  status: "waiting" | "rolling" | "playing" | "finished";
  winner: string | null;
  diceResults: { p1: number; p2: number } | null;
  timer: number;
}

let gameState: GameState = {
  players: [],
  activeTile: null,
  turn: 0,
  status: "waiting",
  winner: null,
  diceResults: null,
  timer: 10,
};

let turnInterval: NodeJS.Timeout | null = null;

const SYMBOLS_P1 = ["🀀", "🀁", "🀂", "🀃", "🀄", "🀅"];
const SYMBOLS_P2 = ["🀇", "🀈", "🀉", "🀊", "🀋", "🀌"];

function createInitialGrids(): { g1: Tile[][], g2: Tile[][], active: Tile } {
  const allTiles: Tile[] = [];
  
  // Create 36 tiles for P1
  SYMBOLS_P1.forEach((sym, sIdx) => {
    for (let i = 0; i < 6; i++) {
      allTiles.push({ id: `p1-${sIdx}-${i}-${Math.random()}`, symbol: sym, owner: 0, isRevealed: false });
    }
  });
  
  // Create 36 tiles for P2
  SYMBOLS_P2.forEach((sym, sIdx) => {
    for (let i = 0; i < 6; i++) {
      allTiles.push({ id: `p2-${sIdx}-${i}-${Math.random()}`, symbol: sym, owner: 1, isRevealed: false });
    }
  });

  // Shuffle all 72 tiles
  const shuffled = allTiles.sort(() => Math.random() - 0.5);

  const activeTile = shuffled.pop()!;
  activeTile.isRevealed = true;

  const grid1: Tile[][] = [];
  const grid2: Tile[][] = [];
  
  // Fill grid1 (36 tiles)
  for (let col = 0; col < 6; col++) {
    grid1[col] = shuffled.slice(col * 6, (col + 1) * 6);
  }
  
  // Fill grid2 (35 tiles, one column will have 5)
  const remaining = shuffled.slice(36);
  for (let col = 0; col < 6; col++) {
    grid2[col] = remaining.slice(col * 6, (col + 1) * 6);
  }

  return { g1: grid1, g2: grid2, active: activeTile };
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  function startTurnTimer() {
    if (turnInterval) clearInterval(turnInterval);
    gameState.timer = 10;
    
    turnInterval = setInterval(() => {
      if (gameState.status === "playing") {
        gameState.timer -= 1;
        
        if (gameState.timer <= 0) {
          // Time's up! Switch turn
          gameState.turn = (gameState.turn + 1) % 2;
          gameState.timer = 10;
          io.emit("gameState", gameState);
        } else {
          io.emit("gameState", gameState);
        }
      } else {
        if (turnInterval) {
          clearInterval(turnInterval);
          turnInterval = null;
        }
      }
    }, 1000);
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  io.on("connection", (socket) => {
    socket.emit("gameState", gameState);

    socket.on("joinGame", (name: string) => {
      if (gameState.players.length < 2 && gameState.status === "waiting") {
        const newPlayer: Player = {
          id: socket.id,
          name: name || `Oyuncu ${gameState.players.length + 1}`,
          grid: [],
        };
        gameState.players.push(newPlayer);
        
        if (gameState.players.length === 2) {
          gameState.status = "rolling";
        }
        io.emit("gameState", gameState);
      } else {
        socket.emit("error", "Masa dolu veya oyun zaten başladı.");
      }
    });

    socket.on("rollDice", () => {
      if (gameState.status === "rolling") {
        const p1 = Math.floor(Math.random() * 6) + 1;
        const p2 = Math.floor(Math.random() * 6) + 1;
        gameState.diceResults = { p1, p2 };
        
        if (p1 !== p2) {
          gameState.turn = p1 > p2 ? 0 : 1;
          const { g1, g2, active } = createInitialGrids();
          gameState.players[0].grid = g1;
          gameState.players[1].grid = g2;
          gameState.activeTile = active;
          gameState.status = "playing";
          startTurnTimer();
        }
        io.emit("gameState", gameState);
      }
    });

    socket.on("pushTile", (colIndex: number) => {
      const pIdx = gameState.players.findIndex(p => p.id === socket.id);
      if (pIdx === gameState.turn && gameState.status === "playing" && gameState.activeTile) {
        const grid = gameState.players[pIdx].grid;
        const column = grid[colIndex];
        
        // Push active tile into top, pop bottom
        const poppedTile = column.pop()!;
        column.unshift(gameState.activeTile);
        
        // Reveal popped tile
        poppedTile.isRevealed = true;
        
        // The popped tile becomes the new active tile
        gameState.activeTile = poppedTile;

        // Check if popped tile belongs to current player
        // If it belongs to the opponent, turn switches
        if (poppedTile.owner !== pIdx) {
          gameState.turn = (pIdx + 1) % 2;
        }

        // Reset timer on every successful move
        gameState.timer = 10;

        // Check win condition
        checkWin();
        
        io.emit("gameState", gameState);
      }
    });

    socket.on("resetGame", () => {
      if (turnInterval) clearInterval(turnInterval);
      turnInterval = null;
      gameState = {
        players: [],
        activeTile: null,
        turn: 0,
        status: "waiting",
        winner: null,
        diceResults: null,
        timer: 10,
      };
      io.emit("gameState", gameState);
    });

    socket.on("disconnect", () => {
      const pIdx = gameState.players.findIndex(p => p.id === socket.id);
      if (pIdx !== -1) {
        if (turnInterval) clearInterval(turnInterval);
        turnInterval = null;
        gameState = {
          players: [],
          activeTile: null,
          turn: 0,
          status: "waiting",
          winner: null,
          diceResults: null,
          timer: 10,
        };
        io.emit("gameState", gameState);
      }
    });
  });

  function checkWin() {
    [0, 1].forEach((pIdx) => {
      let revealedCount = 0;
      // Count revealed tiles of this owner in ALL grids
      gameState.players.forEach(player => {
        player.grid.forEach(col => {
          col.forEach(tile => {
            if (tile.isRevealed && tile.owner === pIdx) revealedCount++;
          });
        });
      });
      // Also check the active tile
      if (gameState.activeTile?.isRevealed && gameState.activeTile.owner === pIdx) {
        revealedCount++;
      }

      if (revealedCount === 36) {
        gameState.status = "finished";
        gameState.winner = gameState.players[pIdx].name;
      }
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
