import { useState, useEffect, useRef, useCallback } from "react";

type Screen = "home" | "game" | "pause" | "results" | "leaderboard" | "settings";

interface Cross {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  rotation: number;
  born: number;
  lifespan: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  emoji?: string;
}

interface FloatingScore {
  id: number;
  x: number;
  y: number;
  value: number;
}

const CROSS_COLORS = ["#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#FF922B", "#CC5DE8", "#F06595"];
const PARTICLE_EMOJIS = ["⭐", "💥", "✨", "🌟", "💫"];

const DIFFICULTIES = {
  easy: { label: "Легко 🐢", spawnInterval: 1800, maxCrosses: 6, lifespan: 4000 },
  medium: { label: "Средне 🐇", spawnInterval: 1200, maxCrosses: 9, lifespan: 3000 },
  hard: { label: "Сложно 🦅", spawnInterval: 650, maxCrosses: 14, lifespan: 1800 },
};

type Difficulty = keyof typeof DIFFICULTIES;

function useAudio(enabled: boolean) {
  const ctx = useRef<AudioContext | null>(null);

  const getCtx = () => {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx.current && AudioCtx) ctx.current = new AudioCtx();
    return ctx.current;
  };

  const playPop = useCallback((freq = 440) => {
    if (!enabled) return;
    const ac = getCtx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 2, ac.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.3);
    osc.type = "sine";
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + 0.3);
  }, [enabled]);

  const playMiss = useCallback(() => {
    if (!enabled) return;
    const ac = getCtx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.frequency.setValueAtTime(200, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ac.currentTime + 0.2);
    gain.gain.setValueAtTime(0.15, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
    osc.type = "sawtooth";
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + 0.2);
  }, [enabled]);

  return { playPop, playMiss };
}

export default function Index() {
  const [screen, setScreen] = useState<Screen>("home");
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => Number(localStorage.getItem("bestScore") || 0));
  const [leaderboard, setLeaderboard] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem("leaderboard") || "[]"); } catch { return []; }
  });
  const [crosses, setCrosses] = useState<Cross[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [floatingScores, setFloatingScores] = useState<FloatingScore[]>([]);
  const [timeLeft, setTimeLeft] = useState(60);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [soundOn, setSoundOn] = useState(true);
  const [combo, setCombo] = useState(0);
  const [level, setLevel] = useState(1);
  const [missedCrosses, setMissedCrosses] = useState(0);

  const gameActive = useRef(false);
  const crossId = useRef(0);
  const particleId = useRef(0);
  const floatId = useRef(0);
  const lastComboTime = useRef(0);
  const comboRef = useRef(0);
  const spawnTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelRef = useRef(1);
  const scoreRef = useRef(0);
  const diffRef = useRef(difficulty);
  diffRef.current = difficulty;

  const { playPop, playMiss } = useAudio(soundOn);

  const stopTimers = useCallback(() => {
    gameActive.current = false;
    if (spawnTimer.current) clearInterval(spawnTimer.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (cleanupTimer.current) clearInterval(cleanupTimer.current);
  }, []);

  const endGame = useCallback(() => {
    stopTimers();
    const finalScore = scoreRef.current;
    setBestScore(prev => {
      const newBest = Math.max(prev, finalScore);
      localStorage.setItem("bestScore", String(newBest));
      return newBest;
    });
    setLeaderboard(prev => {
      const updated = [...prev, finalScore].sort((a, b) => b - a).slice(0, 10);
      localStorage.setItem("leaderboard", JSON.stringify(updated));
      return updated;
    });
    setCrosses([]);
    setScreen("results");
  }, [stopTimers]);

  const spawnLoop = useCallback(() => {
    const diff = DIFFICULTIES[diffRef.current];
    const lvl = levelRef.current;
    const interval = Math.max(280, diff.spawnInterval - (lvl - 1) * 80);

    if (spawnTimer.current) clearInterval(spawnTimer.current);
    spawnTimer.current = setInterval(() => {
      if (!gameActive.current) return;
      setCrosses(prev => {
        const max = diff.maxCrosses + Math.floor(levelRef.current * 1.5);
        if (prev.length >= max) return prev;
        const id = ++crossId.current;
        const size = 44 + Math.random() * 22;
        const x = 6 + Math.random() * 84;
        const y = 14 + Math.random() * 74;
        const color = CROSS_COLORS[Math.floor(Math.random() * CROSS_COLORS.length)];
        const ls = diff.lifespan / (1 + (levelRef.current - 1) * 0.12);
        return [...prev, { id, x, y, size, color, rotation: Math.random() * 40 - 20, born: Date.now(), lifespan: ls }];
      });
    }, interval);
  }, []);

  const startGame = useCallback(() => {
    stopTimers();
    setCrosses([]);
    setParticles([]);
    setFloatingScores([]);
    setScore(0);
    scoreRef.current = 0;
    setTimeLeft(60);
    setCombo(0);
    comboRef.current = 0;
    setLevel(1);
    levelRef.current = 1;
    setMissedCrosses(0);
    gameActive.current = true;

    setScreen("game");

    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { return 0; }
        return t - 1;
      });
    }, 1000);

    spawnLoop();

    cleanupTimer.current = setInterval(() => {
      if (!gameActive.current) return;
      const now = Date.now();
      setCrosses(prev => {
        const alive = prev.filter(c => now - c.born <= c.lifespan);
        const missed = prev.length - alive.length;
        if (missed > 0) {
          playMiss();
          setMissedCrosses(m => m + missed);
        }
        return alive;
      });
      const newLvl = Math.floor(scoreRef.current / 120) + 1;
      if (newLvl !== levelRef.current) {
        levelRef.current = newLvl;
        setLevel(newLvl);
        spawnLoop();
      }
    }, 400);
  }, [stopTimers, spawnLoop, playMiss]);

  useEffect(() => {
    if (timeLeft === 0 && gameActive.current) {
      endGame();
    }
  }, [timeLeft, endGame]);

  useEffect(() => () => stopTimers(), [stopTimers]);

  const burstCross = useCallback((cross: Cross, e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!gameActive.current) return;

    const rect = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const cx = (cross.x / 100) * rect.width;
    const cy = (cross.y / 100) * rect.height;

    setCrosses(prev => prev.filter(c => c.id !== cross.id));

    const now = Date.now();
    const isCombo = now - lastComboTime.current < 900;
    lastComboTime.current = now;
    const newCombo = isCombo ? comboRef.current + 1 : 1;
    comboRef.current = newCombo;
    setCombo(newCombo);
    setTimeout(() => {
      if (comboRef.current === newCombo) { comboRef.current = 0; setCombo(0); }
    }, 900);

    const pts = (10 + (newCombo - 1) * 5) * levelRef.current;
    scoreRef.current += pts;
    setScore(scoreRef.current);

    playPop(280 + newCombo * 70);

    const newParticles: Particle[] = Array.from({ length: 9 }, (_, i) => ({
      id: ++particleId.current,
      x: cx,
      y: cy,
      vx: (Math.random() - 0.5) * 9,
      vy: (Math.random() - 0.5) * 9 - 2,
      color: CROSS_COLORS[Math.floor(Math.random() * CROSS_COLORS.length)],
      size: 6 + Math.random() * 9,
      opacity: 1,
      rotation: Math.random() * 360,
      emoji: Math.random() > 0.55 ? PARTICLE_EMOJIS[Math.floor(Math.random() * PARTICLE_EMOJIS.length)] : undefined,
    }));

    setParticles(prev => [...prev, ...newParticles]);
    setTimeout(() => {
      setParticles(prev => prev.filter(p => !newParticles.find(np => np.id === p.id)));
    }, 700);

    const fid = ++floatId.current;
    setFloatingScores(prev => [...prev, { id: fid, x: cx, y: cy, value: pts }]);
    setTimeout(() => setFloatingScores(prev => prev.filter(f => f.id !== fid)), 900);
  }, [playPop]);

  const pauseGame = () => {
    stopTimers();
    setScreen("pause");
  };

  const resumeGame = () => {
    gameActive.current = true;
    setScreen("game");

    timerRef.current = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) return 0; return t - 1; });
    }, 1000);

    spawnLoop();

    cleanupTimer.current = setInterval(() => {
      if (!gameActive.current) return;
      const now = Date.now();
      setCrosses(prev => {
        const alive = prev.filter(c => now - c.born <= c.lifespan);
        const missed = prev.length - alive.length;
        if (missed > 0) { playMiss(); setMissedCrosses(m => m + missed); }
        return alive;
      });
    }, 400);
  };

  const timerPct = (timeLeft / 60) * 100;
  const timerColor = timeLeft > 20 ? "#6BCB77" : timeLeft > 10 ? "#FFD93D" : "#FF6B6B";

  return (
    <div className="gr">
      {/* ───── HOME ───── */}
      {screen === "home" && (
        <div className="sc home-sc">
          <div className="home-bg-floats">
            {["💥","⭐","✨","🌟","💫","🎯","🎮","❌","🏆"].map((e, i) => (
              <span key={i} className="bgf" style={{
                left: `${5 + i * 11}%`,
                top: `${5 + (i % 3) * 28}%`,
                animationDelay: `${i * 0.35}s`,
                animationDuration: `${3.5 + i * 0.25}s`,
              }}>{e}</span>
            ))}
          </div>
          <div className="home-inner">
            <div className="mascot-wrap">
              <span className="mascot">🤖</span>
              <div className="mascot-speech">Тапай быстрее!</div>
            </div>
            <h1 className="gtitle">Разбей<br/>крестики!</h1>
            <div className="best-badge">🏆 Рекорд: <strong>{bestScore}</strong></div>
            <button className="btn-play" onClick={startGame}>🎮 ИГРАТЬ!</button>
            <div className="home-row">
              <button className="btn-nav" onClick={() => setScreen("leaderboard")}>🏆<br/><small>Рекорды</small></button>
              <button className="btn-nav" onClick={() => setScreen("settings")}>⚙️<br/><small>Настройки</small></button>
            </div>
          </div>
        </div>
      )}

      {/* ───── GAME ───── */}
      {screen === "game" && (
        <div className="sc game-sc" style={{ touchAction: "none", userSelect: "none" }}>
          <div className="hud">
            <div className="hud-s">⭐ {score}</div>
            <div className="hud-mid">
              <div className="tbar-wrap">
                <div className="tbar" style={{ width: `${timerPct}%`, background: timerColor }} />
              </div>
              <div className="hud-t" style={{ color: timerColor }}>{timeLeft}с</div>
            </div>
            <button className="hud-pause" onClick={pauseGame}>⏸</button>
          </div>

          {combo > 1 && (
            <div className="combo-pop">🔥 x{combo} КОМБО!</div>
          )}

          <div className="lv-badge">Ур.{level}</div>

          <div className="field">
            {crosses.map(cross => {
              const age = (Date.now() - cross.born);
              const pct = Math.min(age / cross.lifespan, 1);
              return (
                <button
                  key={cross.id}
                  className="cross"
                  style={{
                    left: `${cross.x}%`,
                    top: `${cross.y}%`,
                    width: cross.size,
                    height: cross.size,
                    fontSize: cross.size * 0.72,
                    color: cross.color,
                    transform: `translate(-50%,-50%) rotate(${cross.rotation}deg) scale(${1 - pct * 0.28})`,
                    opacity: Math.max(0.4, 1 - pct * 0.55),
                    textShadow: `0 0 12px ${cross.color}cc`,
                  }}
                  onTouchStart={e => burstCross(cross, e)}
                  onClick={e => burstCross(cross, e)}
                >
                  ✕
                </button>
              );
            })}

            {particles.map(p => (
              <div key={p.id} className="ptcl" style={{ left: p.x, top: p.y }}>
                {p.emoji
                  ? <span style={{ fontSize: p.size + 6 }}>{p.emoji}</span>
                  : <div style={{ width: p.size, height: p.size, background: p.color, borderRadius: "50%" }} />
                }
              </div>
            ))}

            {floatingScores.map(f => (
              <div key={f.id} className="fscore" style={{ left: f.x, top: f.y }}>
                +{f.value}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ───── PAUSE ───── */}
      {screen === "pause" && (
        <div className="sc ov-sc">
          <div className="card">
            <div className="ov-msc">😴</div>
            <h2 className="ov-title">Пауза</h2>
            <div className="ov-score">⭐ {score} очков</div>
            <button className="btn-play" onClick={resumeGame}>▶️ Продолжить</button>
            <button className="btn-sec" onClick={() => { stopTimers(); setScreen("home"); }}>🏠 В меню</button>
            <button className="btn-dng" onClick={() => startGame()}>🔄 Заново</button>
          </div>
        </div>
      )}

      {/* ───── RESULTS ───── */}
      {screen === "results" && (
        <div className="sc ov-sc">
          <div className="card results-c">
            <div className="ov-msc big">
              {score >= bestScore && score > 0 ? "🏆" : score > 150 ? "😎" : "😅"}
            </div>
            {score >= bestScore && score > 0 && (
              <div className="new-rec">🎉 НОВЫЙ РЕКОРД!</div>
            )}
            <h2 className="ov-title">Игра окончена!</h2>
            <div className="stats">
              <div className="stat-r"><span>⭐ Очки</span><strong>{score}</strong></div>
              <div className="stat-r"><span>🏆 Рекорд</span><strong>{bestScore}</strong></div>
              <div className="stat-r"><span>🎯 Уровень</span><strong>{level}</strong></div>
              <div className="stat-r"><span>💔 Пропустил</span><strong>{missedCrosses}</strong></div>
            </div>
            <button className="btn-play" onClick={startGame}>🔄 Ещё раз!</button>
            <button className="btn-sec" onClick={() => setScreen("leaderboard")}>🏆 Рекорды</button>
            <button className="btn-ghost" onClick={() => setScreen("home")}>🏠 В меню</button>
          </div>
        </div>
      )}

      {/* ───── LEADERBOARD ───── */}
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
                  <div key={i} className={`lb-row ${i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : ""}`}>
                    <span className="lb-pl">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}</span>
                    <span className="lb-sc">{s} очков</span>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-play" onClick={startGame}>🎮 Играть!</button>
          </div>
        </div>
      )}

      {/* ───── SETTINGS ───── */}
      {screen === "settings" && (
        <div className="sc ov-sc">
          <div className="card">
            <button className="back-btn" onClick={() => setScreen("home")}>← Назад</button>
            <div className="ov-msc">⚙️</div>
            <h2 className="ov-title">Настройки</h2>

            <div className="set-sec">
              <div className="set-lbl">🔊 Звук</div>
              <div className="tog-row">
                <button className={`tog ${soundOn ? "on" : ""}`} onClick={() => setSoundOn(true)}>Вкл</button>
                <button className={`tog ${!soundOn ? "on" : ""}`} onClick={() => setSoundOn(false)}>Выкл</button>
              </div>
            </div>

            <div className="set-sec">
              <div className="set-lbl">🎮 Сложность</div>
              <div className="diff-row">
                {(Object.keys(DIFFICULTIES) as Difficulty[]).map(d => (
                  <button key={d} className={`diff-b ${difficulty === d ? "on" : ""}`} onClick={() => setDifficulty(d)}>
                    {DIFFICULTIES[d].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="set-sec">
              <div className="set-lbl">🗑️ Сбросить рекорды</div>
              <button className="btn-dng small" onClick={() => {
                localStorage.removeItem("bestScore");
                localStorage.removeItem("leaderboard");
                setBestScore(0);
                setLeaderboard([]);
              }}>Сбросить</button>
            </div>

            <button className="btn-play" onClick={startGame}>🎮 Играть!</button>
          </div>
        </div>
      )}
    </div>
  );
}