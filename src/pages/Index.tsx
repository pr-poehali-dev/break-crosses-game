import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
type Screen = "home" | "game" | "pause" | "results" | "leaderboard";

type Color = 0 | 1 | 2 | 3 | 4;
const COLOR_META: { bg: string; glow: string; emoji: string }[] = [
  { bg: "#FF6B6B", glow: "#FF6B6B88", emoji: "🔴" },
  { bg: "#FFD93D", glow: "#FFD93D88", emoji: "🟡" },
  { bg: "#6BCB77", glow: "#6BCB7788", emoji: "🟢" },
  { bg: "#4D96FF", glow: "#4D96FF88", emoji: "🔵" },
  { bg: "#CC5DE8", glow: "#CC5DE888", emoji: "🟣" },
];

interface Cell {
  id: number;
  color: Color;
  exploding: boolean;
  selected: boolean;
  falling: boolean;
}

interface FloatingScore { id: number; col: number; row: number; value: number }
interface Particle { id: number; x: number; y: number; color: string; emoji?: string }

type Difficulty = "easy" | "medium" | "hard";
const DIFF_CONFIG: Record<Difficulty, { label: string; icon: string; cols: number; rows: number; colors: number; spawnMs: number; description: string }> = {
  easy:   { label: "Лёгкий",  icon: "🐢", cols: 5, rows: 7, colors: 3, spawnMs: 2200, description: "3 цвета, медленный спавн" },
  medium: { label: "Средний", icon: "🐇", cols: 6, rows: 8, colors: 4, spawnMs: 1500, description: "4 цвета, обычный темп" },
  hard:   { label: "Сложный", icon: "🦅", cols: 7, rows: 9, colors: 5, spawnMs: 900,  description: "5 цветов, быстрый спавн" },
};

let _uid = 1;
const uid = () => _uid++;

// ─── Audio ───────────────────────────────────────────────────────────────────
function useAudio(enabled: boolean) {
  const ctx = useRef<AudioContext | null>(null);
  const getCtx = useCallback(() => {
    const AC = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx.current && AC) ctx.current = new AC();
    return ctx.current;
  }, []);

  const tone = useCallback((freq: number, type: OscillatorType, dur: number, vol = 0.2) => {
    if (!enabled) return;
    const ac = getCtx(); if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.connect(g); g.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.8, ac.currentTime + dur * 0.6);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.start(ac.currentTime); osc.stop(ac.currentTime + dur);
  }, [enabled, getCtx]);

  const playSelect = useCallback(() => tone(520, "sine", 0.12, 0.15), [tone]);
  const playExplode = useCallback((count: number) => {
    tone(300 + count * 30, "sine", 0.25, 0.25);
    setTimeout(() => tone(600 + count * 20, "triangle", 0.2, 0.2), 80);
  }, [tone]);
  const playFail = useCallback(() => tone(180, "sawtooth", 0.3, 0.18), [tone]);

  return { playSelect, playExplode, playFail };
}

// ─── Grid helpers ─────────────────────────────────────────────────────────────
function makeGrid(cols: number, rows: number, numColors: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({
      id: uid(),
      color: Math.floor(Math.random() * numColors) as Color,
      exploding: false,
      selected: false,
      falling: false,
    }))
  );
}

function floodFill(grid: Cell[][], row: number, col: number): [number, number][] {
  const color = grid[row][col].color;
  const rows = grid.length, cols = grid[0].length;
  const visited = new Set<string>();
  const result: [number, number][] = [];
  const stack: [number, number][] = [[row, col]];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    if (grid[r][c].color !== color) continue;
    visited.add(key);
    result.push([r, c]);
    stack.push([r-1,c],[r+1,c],[r,c-1],[r,c+1]);
  }
  return result;
}

function applyGravity(grid: Cell[][]): Cell[][] {
  const cols = grid[0].length;
  const rows = grid.length;
  const newGrid = grid.map(row => [...row]);
  for (let c = 0; c < cols; c++) {
    const col: (Cell | null)[] = newGrid.map(r => r[c]);
    const alive = col.filter(Boolean) as Cell[];
    const empty = col.length - alive.length;
    const filled: (Cell | null)[] = [
      ...Array(empty).fill(null),
      ...alive,
    ];
    for (let r = 0; r < rows; r++) newGrid[r][c] = filled[r]!;
  }
  return newGrid;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Index() {
  const [screen, setScreen] = useState<Screen>("home");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [soundOn, setSoundOn] = useState(true);
  const [grid, setGrid] = useState<(Cell | null)[][]>([]);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [floatingScores, setFloatingScores] = useState<FloatingScore[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(90);
  const [bestScore, setBestScore] = useState(() => Number(localStorage.getItem("bestScore") || 0));
  const [leaderboard, setLeaderboard] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem("leaderboard") || "[]"); } catch { return []; }
  });
  const [gameOver, setGameOver] = useState(false);
  const [highlightGroup, setHighlightGroup] = useState<Set<string>>(new Set());

  const scoreRef = useRef(0);
  const gameActive = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawnRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cfg = DIFF_CONFIG[difficulty];
  const { playSelect, playExplode, playFail } = useAudio(soundOn);

  // ── stop all timers ──
  const stopAll = useCallback(() => {
    gameActive.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (spawnRef.current) clearInterval(spawnRef.current);
  }, []);

  // ── end game ──
  const endGame = useCallback(() => {
    stopAll();
    const final = scoreRef.current;
    setBestScore(prev => {
      const nb = Math.max(prev, final);
      localStorage.setItem("bestScore", String(nb));
      return nb;
    });
    setLeaderboard(prev => {
      const up = [...prev, final].sort((a, b) => b - a).slice(0, 10);
      localStorage.setItem("leaderboard", JSON.stringify(up));
      return up;
    });
    setGameOver(true);
    setScreen("results");
  }, [stopAll]);

  useEffect(() => {
    if (timeLeft <= 0 && gameActive.current) endGame();
  }, [timeLeft, endGame]);

  // ── spawn a new row at top ──
  const spawnRow = useCallback((currentGrid: (Cell | null)[][], numColors: number): (Cell | null)[][] => {
    const cols = currentGrid[0]?.length || cfg.cols;
    const newRow: Cell[] = Array.from({ length: cols }, () => ({
      id: uid(),
      color: Math.floor(Math.random() * numColors) as Color,
      exploding: false, selected: false, falling: false,
    }));
    // shift everything down, drop bottom row if full
    const shifted = [newRow, ...currentGrid.slice(0, currentGrid.length - 1)];
    return shifted;
  }, [cfg.cols]);

  // ── start game ──
  const startGame = useCallback(() => {
    stopAll();
    setSelected(null);
    setHighlightGroup(new Set());
    setFloatingScores([]);
    setParticles([]);
    setScore(0);
    scoreRef.current = 0;
    setGameOver(false);
    const { cols, rows, colors, spawnMs } = DIFF_CONFIG[difficulty];
    const g = makeGrid(cols, rows, colors);
    setGrid(g);
    setTimeLeft(90);
    gameActive.current = true;
    setScreen("game");

    timerRef.current = setInterval(() => {
      setTimeLeft(t => t <= 1 ? 0 : t - 1);
    }, 1000);

    spawnRef.current = setInterval(() => {
      if (!gameActive.current) return;
      setGrid(prev => spawnRow(prev, colors));
    }, spawnMs);
  }, [difficulty, stopAll, spawnRow]);

  useEffect(() => () => stopAll(), [stopAll]);

  // ── highlight group on hover/touch ──
  const getGroup = useCallback((g: (Cell | null)[][], r: number, c: number) => {
    if (!g[r]?.[c]) return new Set<string>();
    const group = floodFill(g as Cell[][], r, c);
    if (group.length < 2) return new Set<string>();
    return new Set(group.map(([row, col]) => `${row},${col}`));
  }, []);

  // ── tap cell ──
  const tapCell = useCallback((row: number, col: number) => {
    if (!gameActive.current) return;
    setGrid(prevGrid => {
      const cell = prevGrid[row]?.[col];
      if (!cell) return prevGrid;

      const group = floodFill(prevGrid as Cell[][], row, col);
      if (group.length < 2) {
        // single — just select/deselect
        playFail();
        setSelected(prev => (prev?.[0] === row && prev?.[1] === col) ? null : [row, col]);
        setHighlightGroup(new Set());
        return prevGrid;
      }

      // explode group!
      playExplode(group.length);
      const pts = group.length * group.length * 10;
      scoreRef.current += pts;
      setScore(scoreRef.current);

      // floating score at center of group
      const avgRow = group.reduce((s, [r]) => s + r, 0) / group.length;
      const avgCol = group.reduce((s, [, c]) => s + c, 0) / group.length;
      const fid = uid();
      setFloatingScores(prev => [...prev, { id: fid, col: avgCol, row: avgRow, value: pts }]);
      setTimeout(() => setFloatingScores(prev => prev.filter(f => f.id !== fid)), 900);

      // particles
      const color = COLOR_META[cell.color].bg;
      const newParts: Particle[] = group.slice(0, 8).map(([r, c]) => ({
        id: uid(),
        x: c, y: r,
        color,
        emoji: Math.random() > 0.5 ? ["💥","✨","⭐","🌟","💫"][Math.floor(Math.random()*5)] : undefined,
      }));
      setParticles(prev => [...prev, ...newParts]);
      setTimeout(() => setParticles(prev => prev.filter(p => !newParts.find(np => np.id === p.id))), 650);

      // remove exploded cells and apply gravity
      const newGrid = prevGrid.map(r => [...r]) as (Cell | null)[][];
      const groupSet = new Set(group.map(([r, c]) => `${r},${c}`));
      for (let r = 0; r < newGrid.length; r++)
        for (let c = 0; c < newGrid[0].length; c++)
          if (groupSet.has(`${r},${c}`)) newGrid[r][c] = null;

      const gravGrid = applyGravity(newGrid);
      setSelected(null);
      setHighlightGroup(new Set());
      return gravGrid;
    });
  }, [playExplode, playFail]);

  const hoverCell = useCallback((row: number, col: number) => {
    setGrid(g => {
      setHighlightGroup(getGroup(g as Cell[][], row, col));
      return g;
    });
  }, [getGroup]);

  const timerPct = (timeLeft / 90) * 100;
  const timerColor = timeLeft > 30 ? "#6BCB77" : timeLeft > 15 ? "#FFD93D" : "#FF6B6B";
  const { cols, rows } = cfg;

  return (
    <div className="gr">

      {/* ══════════ HOME ══════════ */}
      {screen === "home" && (
        <div className="sc home-sc">
          <div className="home-bg-floats">
            {["💥","⭐","✨","🌟","❌","🎮","🏆","💫","🔴","🟡","🟢","🔵"].map((e, i) => (
              <span key={i} className="bgf" style={{ left:`${4+i*8}%`, top:`${10+(i%4)*22}%`, animationDelay:`${i*0.3}s`, animationDuration:`${3+i*0.2}s` }}>{e}</span>
            ))}
          </div>
          <div className="home-inner">
            <div className="mascot-wrap">
              <span className="mascot">🤖</span>
              <div className="mascot-speech">Соединяй одинаковые!</div>
            </div>
            <h1 className="gtitle">Разбей<br/>крестики!</h1>
            <div className="best-badge">🏆 Рекорд: <strong>{bestScore}</strong></div>

            {/* difficulty selector */}
            <div className="diff-section">
              <div className="diff-title">Выбери уровень:</div>
              <div className="diff-cards">
                {(Object.keys(DIFF_CONFIG) as Difficulty[]).map(d => (
                  <button
                    key={d}
                    className={`diff-card ${difficulty === d ? "active" : ""}`}
                    onClick={() => setDifficulty(d)}
                  >
                    <span className="diff-card-icon">{DIFF_CONFIG[d].icon}</span>
                    <span className="diff-card-label">{DIFF_CONFIG[d].label}</span>
                    <span className="diff-card-desc">{DIFF_CONFIG[d].description}</span>
                  </button>
                ))}
              </div>
            </div>

            <button className="btn-play" onClick={startGame}>🎮 ИГРАТЬ!</button>

            <div className="home-row">
              <button className="btn-nav" onClick={() => setScreen("leaderboard")}>🏆<br/><small>Рекорды</small></button>
              <button className="btn-nav" onClick={() => setSoundOn(s => !s)}>
                {soundOn ? "🔊" : "🔇"}<br/><small>{soundOn ? "Звук вкл" : "Звук выкл"}</small>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ GAME ══════════ */}
      {screen === "game" && (
        <div className="sc game-sc">
          {/* HUD */}
          <div className="hud">
            <div className="hud-s">⭐ {score}</div>
            <div className="hud-mid">
              <div className="tbar-wrap">
                <div className="tbar" style={{ width:`${timerPct}%`, background: timerColor }} />
              </div>
              <div className="hud-t" style={{ color: timerColor }}>{timeLeft}с</div>
            </div>
            <button className="hud-pause" onClick={() => { stopAll(); setScreen("pause"); }}>⏸</button>
          </div>

          {/* hint */}
          <div className="hint-bar">Нажми на группу одинаковых крестиков — они взорвутся!</div>

          {/* Grid */}
          <div className="field">
            <div
              className="game-grid"
              style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
              onMouseLeave={() => setHighlightGroup(new Set())}
            >
              {grid.map((row, ri) =>
                row.map((cell, ci) => {
                  const key = `${ri},${ci}`;
                  const isHighlighted = highlightGroup.has(key);
                  const meta = cell ? COLOR_META[cell.color] : null;
                  return (
                    <div
                      key={cell ? cell.id : `empty-${key}`}
                      className={`gcell ${cell ? "has-cell" : "empty-cell"} ${isHighlighted ? "highlighted" : ""}`}
                      onMouseEnter={() => cell && hoverCell(ri, ci)}
                      onTouchStart={() => cell && tapCell(ri, ci)}
                      onClick={() => cell && tapCell(ri, ci)}
                    >
                      {cell && (
                        <div
                          className="cross-tile"
                          style={{
                            background: meta!.bg,
                            boxShadow: isHighlighted ? `0 0 16px ${meta!.glow}, 0 0 32px ${meta!.glow}` : `0 2px 8px ${meta!.glow}`,
                            transform: isHighlighted ? "scale(1.15)" : "scale(1)",
                          }}
                        >
                          ✕
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* particles */}
            {particles.map(p => (
              <div
                key={p.id}
                className="grid-particle"
                style={{
                  left: `${(p.x + 0.5) / cols * 100}%`,
                  top: `${(p.y + 0.5) / rows * 100}%`,
                  color: p.color,
                }}
              >
                {p.emoji || "●"}
              </div>
            ))}

            {/* floating scores */}
            {floatingScores.map(f => (
              <div
                key={f.id}
                className="fscore"
                style={{
                  left: `${(f.col + 0.5) / cols * 100}%`,
                  top: `${(f.row + 0.5) / rows * 100}%`,
                }}
              >
                +{f.value}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════ PAUSE ══════════ */}
      {screen === "pause" && (
        <div className="sc ov-sc">
          <div className="card">
            <div className="ov-msc">😴</div>
            <h2 className="ov-title">Пауза</h2>
            <div className="ov-score">⭐ {score} очков</div>
            <button className="btn-play" onClick={() => {
              gameActive.current = true;
              setScreen("game");
              timerRef.current = setInterval(() => setTimeLeft(t => t <= 1 ? 0 : t - 1), 1000);
              const { colors, spawnMs } = DIFF_CONFIG[difficulty];
              spawnRef.current = setInterval(() => {
                if (!gameActive.current) return;
                setGrid(prev => spawnRow(prev, colors));
              }, spawnMs);
            }}>▶️ Продолжить</button>
            <button className="btn-sec" onClick={() => { stopAll(); setScreen("home"); }}>🏠 В меню</button>
            <button className="btn-dng" onClick={startGame}>🔄 Заново</button>
          </div>
        </div>
      )}

      {/* ══════════ RESULTS ══════════ */}
      {screen === "results" && (
        <div className="sc ov-sc">
          <div className="card results-c">
            <div className="ov-msc big">
              {score >= bestScore && score > 0 ? "🏆" : score > 300 ? "😎" : "😅"}
            </div>
            {score >= bestScore && score > 0 && <div className="new-rec">🎉 НОВЫЙ РЕКОРД!</div>}
            <h2 className="ov-title">Игра окончена!</h2>
            <div className="stats">
              <div className="stat-r"><span>⭐ Очки</span><strong>{score}</strong></div>
              <div className="stat-r"><span>🏆 Рекорд</span><strong>{bestScore}</strong></div>
              <div className="stat-r"><span>🎮 Уровень</span><strong>{DIFF_CONFIG[difficulty].label}</strong></div>
            </div>
            <button className="btn-play" onClick={startGame}>🔄 Ещё раз!</button>
            <button className="btn-sec" onClick={() => setScreen("leaderboard")}>🏆 Рекорды</button>
            <button className="btn-ghost" onClick={() => setScreen("home")}>🏠 В меню</button>
          </div>
        </div>
      )}

      {/* ══════════ LEADERBOARD ══════════ */}
      {screen === "leaderboard" && (
        <div className="sc ov-sc">
          <div className="card lb-card">
            <button className="back-btn" onClick={() => setScreen("home")}>← Назад</button>
            <div className="ov-msc">🏆</div>
            <h2 className="ov-title">Таблица рекордов</h2>
            {leaderboard.length === 0 ? (
              <p className="empty-msg">Пока нет результатов.<br/>Сыграй первым! 🎮</p>
            ) : (
              <div className="lb-list">
                {leaderboard.slice(0, 10).map((s, i) => (
                  <div key={i} className={`lb-row ${i===0?"gold":i===1?"silver":i===2?"bronze":""}`}>
                    <span className="lb-pl">{i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`}</span>
                    <span className="lb-sc">{s} очков</span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-play" onClick={startGame}>🎮 Играть!</button>
            <button className="btn-ghost" onClick={() => {
              localStorage.removeItem("bestScore"); localStorage.removeItem("leaderboard");
              setBestScore(0); setLeaderboard([]);
            }}>🗑️ Сбросить</button>
          </div>
        </div>
      )}
    </div>
  );
}
