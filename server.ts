import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface Tile {
  id: string;
  symbol: string;
  owner: number; // 0 or 1
  isRevealed: boolean;
}

interface Player {
  id: string;
  name: string;
  grid: Tile[][]; // 6 columns
  pool: Tile[]; // Remaining tiles not on grid
  lastTileSymbol?: string; // To ensure variety on next draw
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

const SYMBOLS_P1 = ["🀇", "🀈", "🀉", "🀊", "🀋", "🀌"]; // 1-6 Myriads
const SYMBOLS_P2 = ["🀀", "🀁", "🀂", "🀃", "🀄", "🀅"]; // Winds/Dragons for variety, or also Myriads if preferred

function createInitialGrids(): { g1: Tile[][], g2: Tile[][], p1Pool: Tile[], p2Pool: Tile[] } {
  const p1Tiles: Tile[] = [];
  const p2Tiles: Tile[] = [];
  
  // Create exactly 36 tiles for P1 (Owner 0)
  SYMBOLS_P1.forEach((sym, sIdx) => {
    for (let i = 0; i < 6; i++) {
      p1Tiles.push({ id: `p1-${sIdx}-${i}-${Math.random()}`, symbol: sym, owner: 0, isRevealed: true });
    }
  });
  
  // Create exactly 36 tiles for P2 (Owner 1)
  SYMBOLS_P2.forEach((sym, sIdx) => {
    for (let i = 0; i < 6; i++) {
      p2Tiles.push({ id: `p2-${sIdx}-${i}-${Math.random()}`, symbol: sym, owner: 1, isRevealed: true });
    }
  });

  // Shuffle
  const s1 = [...p1Tiles].sort(() => Math.random() - 0.5);
  const s2 = [...p2Tiles].sort(() => Math.random() - 0.5);

  const grid1: Tile[][] = [[], [], [], [], [], []];
  const grid2: Tile[][] = [[], [], [], [], [], []];
  
  // Grids start empty as requested. All 36 tiles stay in the pools.

  return { g1: grid1, g2: grid2, p1Pool: s1, p2Pool: s2 };
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
          // Time's up! Return tile to pool and switch turn
          if (gameState.activeTile) {
            const currentP = gameState.players[gameState.turn];
            currentP.lastTileSymbol = gameState.activeTile.symbol; // Mark as last used
            currentP.pool.push(gameState.activeTile);
            gameState.activeTile = null;
          }
          
          gameState.turn = (gameState.turn + 1) % 2;
          drawNextTile();
          gameState.timer = 10;
          io.emit("gameState", gameState);

          // If it's Robot's turn, trigger robot move
          if (gameState.status === "playing" && gameState.players[gameState.turn].id === "robot-id") {
            setTimeout(() => {
              const robot = gameState.players[gameState.turn];
              const activeTile = gameState.activeTile;
              if (!activeTile) return;

              let bestCol = -1;
              for (let i = 0; i < 6; i++) {
                if (robot.grid[i].some(t => t.symbol === activeTile.symbol)) {
                  bestCol = i;
                  break;
                }
              }

              if (bestCol === -1) {
                bestCol = robot.grid.reduce((minIdx, col, idx, arr) => 
                  col.length < arr[minIdx].length ? idx : minIdx, 0);
              }

              handlePushTile(bestCol);
            }, 1500);
          }
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

  function drawNextTile() {
    const nextP = gameState.players[gameState.turn];
    if (nextP.pool.length > 0) {
      // Try to find a tile with a different symbol than the last one
      let tileIndex = -1;
      if (nextP.lastTileSymbol) {
        tileIndex = nextP.pool.findIndex(t => t.symbol !== nextP.lastTileSymbol);
      }

      // If no different symbol found or no last symbol, pick random
      if (tileIndex === -1) {
        tileIndex = Math.floor(Math.random() * nextP.pool.length);
      }

      const [tile] = nextP.pool.splice(tileIndex, 1);
      gameState.activeTile = tile;
    } else {
      gameState.activeTile = null;
    }
  }

  function handlePushTile(colIndex: number) {
    if (!gameState.activeTile) return;

    const pIdx = gameState.turn;
    const grid = gameState.players[pIdx].grid;
    const column = grid[colIndex];
    
    // Save current symbol as last used for this player
    gameState.players[pIdx].lastTileSymbol = gameState.activeTile.symbol;

    // Push active tile into top
    column.unshift(gameState.activeTile);
    
    // If column exceeds 6, bottom tile falls out and goes back to its owner's pool
    if (column.length > 6) {
      const poppedTile = column.pop()!;
      const ownerP = gameState.players[poppedTile.owner];
      ownerP.pool.push(poppedTile);
    }
    
    // Turn always switches in this version
    gameState.turn = (pIdx + 1) % 2;
    
    // Draw new active tile for the next player
    drawNextTile();

    // Reset timer
    gameState.timer = 10;

    // Check win condition
    checkWin();
    
    io.emit("gameState", gameState);

    // If it's Robot's turn, trigger robot move
    if (gameState.status === "playing" && gameState.players[gameState.turn].id === "robot-id") {
      setTimeout(() => {
        const robot = gameState.players[gameState.turn];
        const activeTile = gameState.activeTile;
        if (!activeTile) return;

        // Smart move: find a column that already has this symbol
        let bestCol = -1;
        for (let i = 0; i < 6; i++) {
          if (robot.grid[i].some(t => t.symbol === activeTile.symbol)) {
            bestCol = i;
            break;
          }
        }

        // If no match found, pick a column with fewer tiles
        if (bestCol === -1) {
          bestCol = robot.grid.reduce((minIdx, col, idx, arr) => 
            col.length < arr[minIdx].length ? idx : minIdx, 0);
        }

        handlePushTile(bestCol);
      }, 1500);
    }
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
          pool: [],
        };
        gameState.players.push(newPlayer);
        
        if (gameState.players.length === 2) {
          gameState.status = "rolling";
          
          // If one of the players is a robot, trigger dice roll automatically
          if (gameState.players.some(p => p.id === "robot-id")) {
            setTimeout(() => {
              rollDiceInternal();
            }, 1000);
          }
        }
        io.emit("gameState", gameState);
      } else {
        socket.emit("error", "Masa dolu veya oyun zaten başladı.");
      }
    });

    function rollDiceInternal() {
      if (gameState.status === "rolling") {
        const p1 = Math.floor(Math.random() * 6) + 1;
        const p2 = Math.floor(Math.random() * 6) + 1;
        gameState.diceResults = { p1, p2 };
        
        if (p1 !== p2) {
          gameState.turn = p1 > p2 ? 0 : 1;
          const { g1, g2, p1Pool, p2Pool } = createInitialGrids();
          gameState.players[0].grid = g1;
          gameState.players[0].pool = p1Pool;
          gameState.players[1].grid = g2;
          gameState.players[1].pool = p2Pool;
          
          // Initial draw
          drawNextTile();
          
          gameState.status = "playing";
          startTurnTimer();

          // If it's Robot's turn, trigger robot move
          if (gameState.players[gameState.turn].id === "robot-id") {
            setTimeout(() => {
              const robot = gameState.players[gameState.turn];
              const activeTile = gameState.activeTile;
              if (!activeTile) return;

              let bestCol = -1;
              for (let i = 0; i < 6; i++) {
                if (robot.grid[i].some(t => t.symbol === activeTile.symbol)) {
                  bestCol = i;
                  break;
                }
              }

              if (bestCol === -1) {
                bestCol = robot.grid.reduce((minIdx, col, idx, arr) => 
                  col.length < arr[minIdx].length ? idx : minIdx, 0);
              }

              handlePushTile(bestCol);
            }, 1500);
          }
        }
        io.emit("gameState", gameState);
      }
    }

    socket.on("rollDice", () => {
      rollDiceInternal();
    });

    socket.on("pushTile", (colIndex: number) => {
      const pIdx = gameState.players.findIndex(p => p.id === socket.id);
      if (pIdx === gameState.turn && gameState.status === "playing" && gameState.activeTile) {
        handlePushTile(colIndex);
      }
    });

    socket.on("playWithRobot", () => {
      if (gameState.players.length === 1 && gameState.status === "waiting") {
        const robotPlayer: Player = {
          id: "robot-id",
          name: "Robot",
          grid: [[], [], [], [], [], []],
          pool: [],
        };
        gameState.players.push(robotPlayer);
        gameState.status = "rolling";
        io.emit("gameState", gameState);
      }
    });

    socket.on("resetGame", () => {
      if (turnInterval) clearInterval(turnInterval);
      turnInterval = null;
      
      const currentPlayers = gameState.players.map(p => ({
        ...p,
        grid: [[], [], [], [], [], []],
        pool: [],
        lastTileSymbol: undefined
      }));

      gameState = {
        players: currentPlayers,
        activeTile: null,
        turn: 0,
        status: currentPlayers.length === 2 ? "rolling" : "waiting",
        winner: null,
        diceResults: null,
        timer: 10,
      };

      if (gameState.status === "rolling" && gameState.players.some(p => p.id === "robot-id")) {
        setTimeout(() => {
          rollDiceInternal();
        }, 1000);
      }

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
      const player = gameState.players[pIdx];
      if (!player) return;

      // Win condition: All 36 tiles of your owner ID are on your grid
      // AND each column is 6-of-a-kind.
      let win = true;
      
      // First, check if all tiles in the grid belong to the player and are revealed
      player.grid.forEach(col => {
        if (col.length !== 6) win = false;
        const firstSym = col[0]?.symbol;
        col.forEach(tile => {
          if (!tile.isRevealed || tile.owner !== pIdx) win = false;
          if (tile.symbol !== firstSym) win = false; // Must be 6-of-a-kind
        });
      });

      if (win) {
        gameState.status = "finished";
        gameState.winner = player.name;
      }
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
