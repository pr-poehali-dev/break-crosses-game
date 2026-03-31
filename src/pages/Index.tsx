import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────
type Screen = "home" | "game" | "pause" | "results" | "leaderboard";

type Color = 0 | 1 | 2 | 3 | 4;
// Изумруды: каждый цвет — драгоценный камень со своим оттенком
const COLOR_META: { bg: string; light: string; dark: string; glow: string; shine: string; label: string }[] = [
  { bg: "#00b87c", light: "#4dffc3", dark: "#006644", glow: "#00b87caa", shine: "#a8ffd8", label: "emerald" },
  { bg: "#0077e6", light: "#55aaff", dark: "#003d80", glow: "#0077e6aa", shine: "#aad4ff", label: "sapphire" },
  { bg: "#cc2222", light: "#ff7777", dark: "#7a0000", glow: "#cc2222aa", shine: "#ffbbbb", label: "ruby"    },
  { bg: "#cc8800", light: "#ffcc44", dark: "#7a4d00", glow: "#cc8800aa", shine: "#ffe8aa", label: "topaz"   },
  { bg: "#8833cc", light: "#cc77ff", dark: "#4d1a7a", glow: "#8833ccaa", shine: "#ddb3ff", label: "amethyst"},
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
    if (!enabled) return;
    const ac = getCtx(); if (!ac) return;

    // белый шум — основа звука разбитого стекла
    const bufSize = ac.sampleRate * 0.35;
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const noise = ac.createBufferSource();
    noise.buffer = buf;

    // высокочастотный фильтр — убираем низы, остаётся «стеклянный» треск
    const hpf = ac.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 2200 + count * 120;

    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.55, ac.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);

    noise.connect(hpf); hpf.connect(noiseGain); noiseGain.connect(ac.destination);
    noise.start(ac.currentTime); noise.stop(ac.currentTime + 0.35);

    // короткий удар — «первый контакт»
    const imp = ac.createOscillator();
    const impGain = ac.createGain();
    imp.connect(impGain); impGain.connect(ac.destination);
    imp.type = "sine";
    imp.frequency.setValueAtTime(900 + count * 40, ac.currentTime);
    imp.frequency.exponentialRampToValueAtTime(200, ac.currentTime + 0.06);
    impGain.gain.setValueAtTime(0.4, ac.currentTime);
    impGain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);
    imp.start(ac.currentTime); imp.stop(ac.currentTime + 0.1);

    // звон осколков — несколько тонов с задержкой
    [0, 30, 65, 110].forEach((delay, i) => {
      setTimeout(() => {
        const ac2 = getCtx(); if (!ac2) return;
        const o = ac2.createOscillator();
        const g2 = ac2.createGain();
        o.connect(g2); g2.connect(ac2.destination);
        o.type = "triangle";
        o.frequency.value = 1800 + i * 430 + count * 60;
        g2.gain.setValueAtTime(0.12 - i * 0.02, ac2.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ac2.currentTime + 0.18);
        o.start(ac2.currentTime); o.stop(ac2.currentTime + 0.2);
      }, delay);
    });
  }, [enabled, getCtx]);

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

function floodFill(grid: (Cell | null)[][], row: number, col: number): [number, number][] {
  const startCell = grid[row]?.[col];
  if (!startCell) return [];
  const color = startCell.color;
  const rows = grid.length, cols = grid[0].length;
  const visited = new Set<string>();
  const result: [number, number][] = [];
  const stack: [number, number][] = [[row, col]];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    const cell = grid[r][c];
    if (!cell || cell.color !== color) continue;
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

  const [hoverCount, setHoverCount] = useState(0);
  const [hoverColor, setHoverColor] = useState<string>("");

  // ── highlight group on hover/touch ──
  const getGroup = useCallback((g: (Cell | null)[][], r: number, c: number) => {
    if (!g[r]?.[c]) return new Set<string>();
    const group = floodFill(g, r, c);
    if (group.length < 2) return new Set<string>();
    return new Set(group.map(([row, col]) => `${row},${col}`));
  }, []);

  // ── tap cell ──
  const tapCell = useCallback((row: number, col: number) => {
    if (!gameActive.current) return;
    setGrid(prevGrid => {
      const cell = prevGrid[row]?.[col];
      if (!cell) return prevGrid;

      const group = floodFill(prevGrid, row, col);
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

      // осколки изумруда — много мелких кусочков на каждую ячейку
      const meta = COLOR_META[cell.color];
      const shardColors = [meta.bg, meta.light, meta.shine, meta.dark];
      const newParts: Particle[] = group.flatMap(([r, c]) =>
        Array.from({ length: 5 }, () => ({
          id: uid(),
          x: c + (Math.random() - 0.5) * 0.6,
          y: r + (Math.random() - 0.5) * 0.6,
          color: shardColors[Math.floor(Math.random() * shardColors.length)],
          emoji: undefined,
        }))
      );
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
      const group = floodFill(g, row, col);
      const s = new Set(group.map(([r, c]) => `${r},${c}`));
      setHighlightGroup(s);
      setHoverCount(group.length >= 2 ? group.length : 0);
      const cell = g[row]?.[col];
      setHoverColor(cell && group.length >= 2 ? COLOR_META[cell.color].bg : "");
      return g;
    });
  }, []);

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

          {/* hint / hover badge */}
          {hoverCount >= 2 ? (
            <div className="hint-bar hint-active" style={{ borderBottomColor: hoverColor + "66" }}>
              <span style={{ color: hoverColor, fontWeight: 900 }}>{hoverCount} крестиков</span>
              {" "}— нажми! &nbsp;⭐ <strong>+{hoverCount * hoverCount * 10}</strong>
            </div>
          ) : (
            <div className="hint-bar">Наведи на группу одинаковых крестиков</div>
          )}

          {/* Grid */}
          <div className="field">
            <div
              className="game-grid"
              style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
              onMouseLeave={() => { setHighlightGroup(new Set()); setHoverCount(0); setHoverColor(""); }}
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
                      onTouchStart={e => { e.preventDefault(); if (cell) { hoverCell(ri, ci); tapCell(ri, ci); } }}
                      onClick={() => cell && tapCell(ri, ci)}
                    >
                      {cell && (
                        <div
                          className={`gem-tile gem-tile--${COLOR_META[cell.color].label} ${isHighlighted ? "gem-tile--lit" : ""}`}
                          style={{ "--glow": COLOR_META[cell.color].glow, "--light": COLOR_META[cell.color].light, "--bg": COLOR_META[cell.color].bg, "--dark": COLOR_META[cell.color].dark, "--shine": COLOR_META[cell.color].shine } as React.CSSProperties}
                        >
                          <div className="gem-face gem-top" />
                          <div className="gem-face gem-left" />
                          <div className="gem-face gem-right" />
                          <div className="gem-face gem-bottom" />
                          <div className="gem-shine" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* осколки изумруда */}
            {particles.map((p, i) => {
              const angle = (i * 137.5) % 360;
              const dist = 20 + (i % 5) * 14;
              const tx = Math.cos(angle * Math.PI / 180) * dist;
              const ty = Math.sin(angle * Math.PI / 180) * dist - 10;
              const shapes = ["shard-a","shard-b","shard-c","shard-d"];
              const shape = shapes[i % shapes.length];
              return (
                <div
                  key={p.id}
                  className={`gem-shard ${shape}`}
                  style={{
                    left: `${(p.x + 0.5) / cols * 100}%`,
                    top: `${(p.y + 0.5) / rows * 100}%`,
                    background: p.color,
                    "--tx": `${tx}px`,
                    "--ty": `${ty}px`,
                    "--rot": `${angle}deg`,
                  } as React.CSSProperties}
                />
              );
            })}

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