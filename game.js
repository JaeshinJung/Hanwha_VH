/* ============================================================
   LIFEPLUS 2D Survivors - game.js
   A Vampire-Survivors-style mini game driven by the report card
   grades (read from localStorage). 30-second waves, an intermission
   shop with a Hanwha Life energy potion, and gold-funded wellness
   upgrades that write straight back to localStorage.
   ============================================================ */

/* ============================================================
   localStorage bridge (shared with the report page, index/app.js)
   ============================================================ */
const STORAGE_KEY = "lifeplus_save";

// Pure lifestyle inputs (lifeData). Never changed by the shop — only by the report page.
const state = {
  name: "홍길동",
  status: "오늘도 갓생 산다!",
  sleep: 7,
  savings: 100,
  work: 45,
  exercise: 3,
};

// Save schema isolates lifeData (raw inputs) from trainingBonus (game stat bonus)
function loadSave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.lifeData) {
      ["name", "status", "sleep", "savings", "work", "exercise"].forEach((k) => {
        if (d.lifeData[k] !== undefined) state[k] = d.lifeData[k];
      });
    }
    if (typeof d.gold === "number") gold = d.gold;
    if (d.trainingBonus) {
      for (const m of ["physical", "financial", "inspirational", "mental"]) {
        if (typeof d.trainingBonus[m] === "number") trainingBonus[m] = d.trainingBonus[m];
      }
    }
  } catch (e) {
    /* corrupted storage; keep defaults */
  }
}

// Persist isolated lifeData + gold + trainingBonus
function writeSave() {
  const data = {
    lifeData: {
      name: state.name,
      status: state.status,
      sleep: state.sleep,
      savings: state.savings,
      work: state.work,
      exercise: state.exercise,
    },
    gold: gold,
    trainingBonus: trainingBonus,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    /* ignore */
  }
}

/* ============================================================
   Wellness grading (mirrors app.js so the game stays in sync)
   ============================================================ */
function gradePhysical(sleep, exercise) {
  if (sleep <= 3) return "F";
  if (sleep >= 7 && sleep <= 8 && exercise >= 3) return "A";
  if (sleep >= 6 && sleep <= 9 && exercise >= 2) return "B";
  if (sleep >= 5 && sleep <= 10 && exercise >= 1) return "C";
  if (sleep <= 4 || exercise === 0) return "D";
  return "C";
}
function gradeFinancial(savings) {
  if (savings >= 150) return "A";
  if (savings >= 80) return "B";
  if (savings >= 40) return "C";
  if (savings >= 10) return "D";
  return "F";
}
function gradeInspirational(work) {
  if (work < 10 || work > 80) return "F";
  if (work >= 40 && work <= 52) return "A";
  if ((work >= 30 && work < 40) || (work > 52 && work <= 60)) return "B";
  if ((work >= 20 && work < 30) || (work > 60 && work <= 70)) return "C";
  return "D";
}
function gradeMental(sleep, work, exercise) {
  if (work > 60 && sleep < 5) return "F";
  if (sleep >= 6 && work <= 45 && exercise >= 1) return "A";
  if (sleep >= 6 && work <= 50 && exercise >= 1) return "B";
  if (work > 60 || sleep < 5) return "D";
  if (sleep >= 5 && work <= 55) return "C";
  return "C";
}
/* ---- Grade scoring + SSS promotion via training ---- */
const GRADE_SCORE = { F: 0, D: 1, C: 2, B: 3, A: 4, S: 5, SS: 6, SSS: 7 };
const SCORE_LETTER = ["F", "D", "C", "B", "A", "S", "SS", "SSS"];

// Extra tiers earned by buying training after a metric already hit A
const trainingBonus = { physical: 0, financial: 0, inspirational: 0, mental: 0 };
const TYPE_TO_METRIC = { pt: "physical", finance: "financial", career: "inspirational", mental: "mental" };

// Effective grade = base score + training bonus (can climb up to SSS)
function promote(metric, base) {
  return SCORE_LETTER[Math.min(7, GRADE_SCORE[base] + trainingBonus[metric])];
}

function computeGrades(s) {
  return {
    physical: promote("physical", gradePhysical(s.sleep, s.exercise)),
    financial: promote("financial", gradeFinancial(s.savings)),
    inspirational: promote("inspirational", gradeInspirational(s.work)),
    mental: promote("mental", gradeMental(s.sleep, s.work, s.exercise)),
  };
}

/* ============================================================
   Grade -> player spec tables (balance pass)
   Physical -> Max HP, Financial -> melee ATK,
   Inspirational -> move speed, Mental -> magnet range.
   Attack interval is fixed for everyone.
   ============================================================ */
const HP_BY_GRADE = { SSS: 220, SS: 170, S: 130, A: 100, B: 80, C: 60, D: 45, F: 30 };
const DMG_BY_GRADE = { SSS: 65, SS: 48, S: 35, A: 25, B: 18, C: 12, D: 8, F: 5 };
// Mental -> magnet range (px)
const MAG_BY_GRADE = { SSS: 150, SS: 120, S: 95, A: 75, B: 58, C: 42, D: 27, F: 12 };
// Inspirational -> move speed (px per frame @60fps)
const SPD_BY_GRADE = { SSS: 7.0, SS: 6.0, S: 5.2, A: 4.5, B: 3.8, C: 3.2, D: 2.7, F: 2.2 };

// Melee "money swing" tuning
const SWING_DURATION = 0.15; // visible swing time (~10 frames)
const KNOCKBACK = 42; // px enemies are pushed back on hit
const STORM_DURATION = 0.2; // money-storm effect time

/* ============================================================
   Financial-grade weapon evolution (PRD 2.2)
   coin -> cash -> bag -> storm as the Financial grade climbs
   ============================================================ */
const WEAPON_DEFS = {
  // cooldown (s), range (px), halfArc (rad; 0 = projectile, PI*2 = omni)
  coin: { cooldown: 1.5, range: 150, halfArc: 0 }, // single ranged throw
  cash: { cooldown: 0.9, range: 80, halfArc: Math.PI / 3 }, // 120° cone
  bag: { cooldown: 0.7, range: 110, halfArc: Math.PI / 2 }, // 180° cone
  storm: { cooldown: 0.5, range: 160, halfArc: Math.PI * 2 }, // 360° omni
};

// Map a Financial grade letter to its weapon tier
function weaponForGrade(grade) {
  const s = GRADE_SCORE[grade];
  if (s <= 1) return "coin"; // F, D
  if (s <= 3) return "cash"; // C, B
  if (s <= 5) return "bag"; // A, S
  return "storm"; // SS, SSS
}

/* ============================================================
   Canvas + world
   ============================================================ */
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
ctx.imageSmoothingEnabled = false; // keep pixel art crisp when scaled

const player = {
  x: W / 2,
  y: H / 2,
  r: 14,
  hp: undefined, // set by applySpecs()
  maxHp: undefined,
  damage: 20,
  magnet: 100,
  speed: 180, // px/sec (set by applySpecs)
  attackCd: 0,
  // weapon state (set by applySpecs from the Financial grade)
  weaponType: "coin",
  attackInterval: 1.5,
  attackRange: 150,
  attackHalfArc: 0,
  swing: { active: false, t: 0, angle: 0, range: 0, halfArc: 0 }, // melee swing visual
  storm: { active: false, t: 0 }, // money-storm visual
  hitFlash: 0,
  slowTimer: 0, // seconds of 50% movement slow remaining (boss freeze zones)
};

let enemies = [];
let golds = [];
let coins = []; // player coin projectiles (coin weapon)

/* ============================================================
   Game state
   ============================================================ */
let gold = 0;
let currentWave = 1;
let waveTimer = 30; // seconds remaining in the wave
let isPaused = false;
let gameOver = false;
let spawnCd = 0;
let lastTime = 0;

// Boss + gold-penalty state
let bossActive = false;
let boss = null;
let bossBullets = []; // also reused for ranged-enemy projectiles
let goldAtWaveStart = 0; // gold backed up at the start of each wave
let playerFlip = false; // true when the player faces left
let explosions = []; // bomber blast visuals
let bomberCd = 0; // throttles how often bombers may spawn
let endingScene = false; // true once the cinematic retirement scene is playing
let freezeZones = []; // boss 10 "asset freeze" slow fields
let hazards = []; // telegraphed boss attacks (boss 30 reject stamp)

/* ============================================================
   Input (keyboard + pointer)
   ============================================================ */
const keys = {};
const pointer = { active: false, x: 0, y: 0 };

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    togglePause();
    return;
  }
  keys[e.key.toLowerCase()] = true;
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

function toCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width / rect.width),
    y: (clientY - rect.top) * (canvas.height / rect.height),
  };
}
canvas.addEventListener("pointerdown", (e) => {
  pointer.active = true;
  const p = toCanvas(e.clientX, e.clientY);
  pointer.x = p.x;
  pointer.y = p.y;
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointer.active) return;
  const p = toCanvas(e.clientX, e.clientY);
  pointer.x = p.x;
  pointer.y = p.y;
});
canvas.addEventListener("pointerup", () => (pointer.active = false));
canvas.addEventListener("pointerleave", () => (pointer.active = false));

/* ============================================================
   Spec application (grades -> player stats, live)
   ============================================================ */
function applySpecs() {
  const g = computeGrades(state);
  const newMax = HP_BY_GRADE[g.physical];

  if (player.maxHp === undefined) {
    player.maxHp = newMax;
    player.hp = newMax; // first spawn at full HP
  } else if (newMax > player.maxHp) {
    player.hp += newMax - player.maxHp; // an upgrade also heals the gained HP
  }
  player.maxHp = newMax;
  player.hp = Math.min(player.hp, player.maxHp);

  player.damage = DMG_BY_GRADE[g.financial];
  player.magnet = MAG_BY_GRADE[g.mental];
  // table is px/frame; convert to px/sec for the dt-based movement loop
  player.speed = SPD_BY_GRADE[g.inspirational] * 60;

  // Financial grade also evolves the attack weapon
  player.weaponType = weaponForGrade(g.financial);
  const wd = WEAPON_DEFS[player.weaponType];
  player.attackInterval = wd.cooldown;
  player.attackRange = wd.range;
  player.attackHalfArc = wd.halfArc;
}

/* ============================================================
   Spawning + helpers
   ============================================================ */
// Which monster types are unlocked at the current wave (every 5 waves)
function spawnPool() {
  if (currentWave <= 5) return ["basic"];
  if (currentWave <= 10) return ["basic", "fast"];
  if (currentWave <= 15) return ["basic", "fast", "bomber"];
  if (currentWave <= 20) return ["basic", "fast", "bomber", "ranged"];
  return ["basic", "fast", "bomber", "ranged", "tank"];
}

function spawnEnemy() {
  const pool = spawnPool();
  let type = pool[Math.floor(Math.random() * pool.length)];
  // Bombers are rare: keep them at least 10s apart
  if (type === "bomber" && bomberCd > 0) type = "basic";
  if (type === "bomber") bomberCd = 10;

  const t = ENEMY_TYPES[type];
  // Linear difficulty growth per wave (HP +15%/wave, damage +10%/wave)
  const hpScale = 1 + (currentWave - 1) * 0.15;
  const dmgScale = 1 + (currentWave - 1) * 0.1;

  const edge = Math.floor(Math.random() * 4);
  let x, y;
  if (edge === 0) { x = Math.random() * W; y = -20; }
  else if (edge === 1) { x = W + 20; y = Math.random() * H; }
  else if (edge === 2) { x = Math.random() * W; y = H + 20; }
  else { x = -20; y = Math.random() * H; }

  const hp = Math.round(t.hp * hpScale);
  const e = {
    type, x, y, r: t.r,
    hp, maxHp: hp,
    speed: t.speed * 60, // px/frame -> px/sec
    contactDps: t.contactDps * dmgScale,
    gold: t.gold,
    sprite: t.sprite,
    colorMap: t.colorMap,
  };
  if (type === "bomber") {
    e.isExploding = false;
    e.explodeTimer = 0;
    e.explodeDmg = t.explodeDmg * dmgScale;
  }
  if (type === "ranged") {
    e.fireCd = 2.0;
    e.shotDmg = t.shotDmg * dmgScale;
  }
  enemies.push(e);
}

function nearestEnemy() {
  let best = null;
  let bestD = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function dropGold(e) {
  golds.push({ x: e.x, y: e.y, value: e.gold, collected: false });
}

// Smallest signed angle between a and b (radians)
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---- Shared hit helpers ----
function hitEnemyAt(i, e, dx, dy, dist, knock) {
  e.hp -= player.damage;
  if (knock) {
    const nx = dist ? dx / dist : 1, ny = dist ? dy / dist : 0;
    e.x += nx * knock;
    e.y += ny * knock;
  }
  if (e.hp <= 0) {
    dropGold(e);
    enemies.splice(i, 1);
  }
}
function hitBoss(dx, dy, dist, knock) {
  boss.hp -= player.damage;
  if (knock) {
    const nx = dist ? dx / dist : 1, ny = dist ? dy / dist : 0;
    boss.x += nx * knock;
    boss.y += ny * knock;
  }
  if (boss.hp <= 0) defeatBoss();
  else updateBossHud();
}

function faceAngle(angle) {
  if (Math.cos(angle) < 0) playerFlip = true;
  else if (Math.cos(angle) > 0) playerFlip = false;
}

// Route an attack to the weapon matching the Financial grade
function fireWeapon(angle) {
  if (player.weaponType === "coin") throwCoin(angle);
  else if (player.weaponType === "storm") doStorm();
  else doMeleeSwing(angle); // cash (120°) or bag (180°)
}

// coin: launch a single coin projectile toward the target
function throwCoin(angle) {
  faceAngle(angle);
  const sp = 420;
  coins.push({
    x: player.x, y: player.y,
    vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp,
    r: 7, dmg: player.damage,
    life: player.attackRange / sp, // travels up to its range then fades
  });
}

// cash / bag: instant fan-shaped melee within the weapon's arc + range
function doMeleeSwing(angle) {
  faceAngle(angle);
  player.swing.active = true;
  player.swing.t = SWING_DURATION;
  player.swing.angle = angle;
  player.swing.range = player.attackRange;
  player.swing.halfArc = player.attackHalfArc;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const dx = e.x - player.x, dy = e.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > player.attackRange + e.r) continue;
    if (Math.abs(angleDiff(Math.atan2(dy, dx), angle)) > player.attackHalfArc) continue;
    hitEnemyAt(i, e, dx, dy, dist, KNOCKBACK);
  }
  if (bossActive && boss) {
    const dx = boss.x - player.x, dy = boss.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= player.attackRange + boss.r && Math.abs(angleDiff(Math.atan2(dy, dx), angle)) <= player.attackHalfArc) {
      hitBoss(dx, dy, dist, 8);
    }
  }
}

// storm: 360° omni blast — hit everything within range
function doStorm() {
  player.storm.active = true;
  player.storm.t = STORM_DURATION;
  const R = player.attackRange;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const dx = e.x - player.x, dy = e.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= R + e.r) hitEnemyAt(i, e, dx, dy, dist, 30);
  }
  if (bossActive && boss) {
    const dx = boss.x - player.x, dy = boss.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= R + boss.r) hitBoss(dx, dy, dist, 6);
  }
}

/* ============================================================
   Update (one frame, dt in seconds)
   ============================================================ */
function update(dt) {
  if (isPaused || gameOver) return;

  // ---- Movement: keyboard first, pointer as fallback ----
  let mx = 0, my = 0;
  if (keys["w"] || keys["arrowup"]) my -= 1;
  if (keys["s"] || keys["arrowdown"]) my += 1;
  if (keys["a"] || keys["arrowleft"]) mx -= 1;
  if (keys["d"] || keys["arrowright"]) mx += 1;

  if (mx === 0 && my === 0 && pointer.active) {
    const dx = pointer.x - player.x, dy = pointer.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) { mx = dx / d; my = dy / d; }
  } else if (mx || my) {
    const d = Math.hypot(mx, my);
    mx /= d; my /= d;
  }
  // Face the direction of travel
  if (mx < -0.01) playerFlip = true;
  else if (mx > 0.01) playerFlip = false;
  // 50% slow while an "asset freeze" debuff is active
  const slowMul = player.slowTimer > 0 ? 0.5 : 1;
  if (player.slowTimer > 0) player.slowTimer -= dt;
  player.x += mx * player.speed * slowMul * dt;
  player.y += my * player.speed * slowMul * dt;
  player.x = Math.max(player.r, Math.min(W - player.r, player.x));
  player.y = Math.max(player.r, Math.min(H - player.r, player.y));

  // ---- Spawn enemies (paused during boss waves) ----
  if (bomberCd > 0) bomberCd -= dt;
  if (!bossActive) {
    spawnCd -= dt;
    if (spawnCd <= 0) {
      spawnEnemy();
      spawnCd = Math.max(0.35, 1.1 - (currentWave - 1) * 0.08);
    }
  }

  // ---- Enemy AI (per type) ----
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const dx = player.x - e.x, dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;

    if (e.type === "bomber") {
      if (e.isExploding) {
        // Stay still, count down, then blow up
        e.explodeTimer -= dt;
        if (e.explodeTimer <= 0) {
          explosions.push({ x: e.x, y: e.y, r: 0, life: 0.4 });
          if (Math.hypot(player.x - e.x, player.y - e.y) <= 80) {
            player.hp -= e.explodeDmg;
            player.hitFlash = 0.15;
          }
          enemies.splice(i, 1);
          continue;
        }
      } else {
        e.x += (dx / d) * e.speed * dt;
        e.y += (dy / d) * e.speed * dt;
        if (d <= 40) { e.isExploding = true; e.explodeTimer = 1.0; } // arm the bomb
      }
    } else if (e.type === "ranged") {
      // Hold at ~200px and lob slow projectiles
      if (d > 200) {
        e.x += (dx / d) * e.speed * dt;
        e.y += (dy / d) * e.speed * dt;
      }
      e.fireCd -= dt;
      if (e.fireCd <= 0) {
        const sp = 2 * 60; // 2px/frame
        bossBullets.push({ x: e.x, y: e.y, vx: (dx / d) * sp, vy: (dy / d) * sp, r: 6, dmg: e.shotDmg, life: 5 });
        e.fireCd = 2.0;
      }
    } else {
      // basic / fast / tank: chase + contact damage
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
      if (d < e.r + player.r) {
        player.hp -= e.contactDps * dt;
        player.hitFlash = 0.12;
      }
    }
  }

  // ---- Explosion visuals expand then fade ----
  for (const ex of explosions) {
    ex.life -= dt;
    ex.r += 220 * dt;
  }
  explosions = explosions.filter((ex) => ex.life > 0);

  // ---- Freeze zones (boss 10): slow the player while standing inside ----
  for (const fz of freezeZones) {
    fz.life -= dt;
    if (Math.hypot(player.x - fz.x, player.y - fz.y) <= fz.r) {
      player.slowTimer = 2.0; // refreshed to 2s while inside the field
    }
  }
  freezeZones = freezeZones.filter((fz) => fz.life > 0);

  // ---- Telegraphed hazards (boss 30 reject stamp): wind up, then slam ----
  for (let i = hazards.length - 1; i >= 0; i--) {
    const hz = hazards[i];
    hz.t -= dt;
    if (hz.t <= 0) {
      explosions.push({ x: hz.x, y: hz.y, r: 0, life: 0.4 });
      if (Math.hypot(player.x - hz.x, player.y - hz.y) <= hz.r) {
        player.hp -= hz.dmg;
        player.hitFlash = 0.2;
        knockbackPlayer(hz.x, hz.y, 70);
      }
      hazards.splice(i, 1);
    }
  }

  // ---- Boss behaviour (boss waves only) ----
  if (bossActive && boss) {
    const dx = player.x - boss.x, dy = player.y - boss.y;
    const d = Math.hypot(dx, dy) || 1;
    boss.x += (dx / d) * boss.speed * dt;
    boss.y += (dy / d) * boss.speed * dt;
    if (d < boss.r + player.r) {
      player.hp -= boss.contactDmg * dt;
      player.hitFlash = 0.12;
    }
    updateBossPattern(dt); // wave-specific gimmick patterns
  }

  // ---- Boss bullets travel + hit the player ----
  for (const bb of bossBullets) {
    bb.x += bb.vx * dt;
    bb.y += bb.vy * dt;
    bb.life -= dt;
    if (Math.hypot(bb.x - player.x, bb.y - player.y) < bb.r + player.r) {
      player.hp -= bb.dmg;
      player.hitFlash = 0.12;
      bb.life = 0;
    }
  }
  bossBullets = bossBullets.filter((bb) => bb.life > 0 && bb.x > -30 && bb.x < W + 30 && bb.y > -30 && bb.y < H + 30);

  if (player.hitFlash > 0) player.hitFlash -= dt;

  if (player.hp <= 0) {
    player.hp = 0;
    triggerGameOver();
    return;
  }

  // ---- Attack: fire the Financial-grade weapon at the nearest target ----
  player.attackCd -= dt;
  if (player.attackCd <= 0) {
    const target = bossActive && boss ? boss : nearestEnemy();
    if (target) {
      fireWeapon(Math.atan2(target.y - player.y, target.x - player.x));
      player.attackCd = player.attackInterval;
    }
  }
  // attack-visual timers
  if (player.swing.active) {
    player.swing.t -= dt;
    if (player.swing.t <= 0) player.swing.active = false;
  }
  if (player.storm.active) {
    player.storm.t -= dt;
    if (player.storm.t <= 0) player.storm.active = false;
  }

  // ---- Coin projectiles travel + hit the first target ----
  for (let ci = coins.length - 1; ci >= 0; ci--) {
    const c = coins[ci];
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.life -= dt;
    let hit = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (Math.hypot(e.x - c.x, e.y - c.y) < e.r + c.r) {
        hitEnemyAt(i, e, e.x - player.x, e.y - player.y, Math.hypot(e.x - player.x, e.y - player.y), 0);
        hit = true;
        break;
      }
    }
    if (!hit && bossActive && boss && Math.hypot(boss.x - c.x, boss.y - c.y) < boss.r + c.r) {
      hitBoss(boss.x - player.x, boss.y - player.y, 1, 0);
      hit = true;
    }
    if (hit || c.life <= 0 || c.x < -20 || c.x > W + 20 || c.y < -20 || c.y > H + 20) {
      coins.splice(ci, 1);
    }
  }

  // ---- Gold magnet + pickup ----
  for (const g of golds) {
    const dx = player.x - g.x, dy = player.y - g.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < player.magnet) {
      g.x += (dx / d) * 260 * dt;
      g.y += (dy / d) * 260 * dt;
    }
    if (d < player.r + 6) {
      gold += g.value;
      g.collected = true;
    }
  }
  golds = golds.filter((g) => !g.collected);

  updateHUD();
}

/* ============================================================
   Pixel-art engine — sprites are matrices of digit chars,
   each digit looked up in a colorMap ("0"/unknown = transparent).
   No external images: everything is drawn with fillRect.
   ============================================================ */

// ---- Player aging stages (changes every 10 waves) ----

// Stage 1 (W1~10): 신입사원 — hard hat, bright blue suit
const PLAYER_NEWBIE = [
  "000111110000",
  "001111111000",
  "011111111100",
  "002222222000",
  "002422242000",
  "002222222000",
  "000335330000",
  "003335333000",
  "003335333000",
  "003333333000",
  "000330330000",
  "000660660000",
];
const PLAYER_NEWBIE_MAP = {
  "1": "#f4c430", "2": "#ffd2a6", "3": "#2e5cb8", "4": "#20232a", "5": "#ff6a13", "6": "#14131a",
};

// Stage 2 (W11~20): 대리/과장 — brown hair, gray suit, blue tie
const PLAYER_MANAGER = [
  "000111100000",
  "001111110000",
  "011111111000",
  "002222222000",
  "002422242000",
  "002222222000",
  "000335330000",
  "003335333000",
  "003335333000",
  "003333333000",
  "000330330000",
  "000660660000",
];
const PLAYER_MANAGER_MAP = {
  "1": "#6b4a2a", "2": "#ffd2a6", "3": "#4a4f5a", "4": "#20232a", "5": "#2e6db8", "6": "#14131a",
};

// Stage 3 (W21~30): 부장/임원 — gray hair, glasses, dark suit, red tie
const PLAYER_EXEC = [
  "000111100000",
  "001111110000",
  "011111111000",
  "002222222000",
  "007777777700",
  "002222222000",
  "000335330000",
  "003335333000",
  "003335333000",
  "003333333000",
  "000330330000",
  "000660660000",
];
const PLAYER_EXEC_MAP = {
  "1": "#b8b8c0", "2": "#ffd2a6", "3": "#20232e", "5": "#c0392b", "6": "#14131a", "7": "#c8c8c8",
};

// Ending: 은퇴 노인 — white hair, glasses, cardigan, cane (used in the cinematic)
const PLAYER_ELDER = [
  "000111100000",
  "001111110000",
  "011111111000",
  "002222222000",
  "007777777700",
  "002222222000",
  "000333330080",
  "003333333080",
  "003333333080",
  "003333333080",
  "000330330080",
  "000660660080",
];
const PLAYER_ELDER_MAP = {
  "1": "#e8e8ee", "2": "#e8c9a0", "3": "#8a6f5a", "6": "#14131a", "7": "#c8c8c8", "8": "#6b4a2a",
};

// White palette reused for the hit flash (covers every sprite digit)
const PLAYER_HIT_MAP = {
  "1": "#fff", "2": "#fff", "3": "#fff", "4": "#fff", "5": "#fff", "6": "#fff", "7": "#fff", "8": "#fff",
};

// Pick the player sprite for the current career stage
function playerStage() {
  if (currentWave <= 10) return { sprite: PLAYER_NEWBIE, map: PLAYER_NEWBIE_MAP };
  if (currentWave <= 20) return { sprite: PLAYER_MANAGER, map: PLAYER_MANAGER_MAP };
  return { sprite: PLAYER_EXEC, map: PLAYER_EXEC_MAP };
}

// ENEMY 1 — 야근 요괴 (basic purple imp, horns + wings)
const ENEMY_1_SPRITE = [
  "001000001000",
  "001100011000",
  "001111111000",
  "011111111100",
  "411311131114",
  "411111111114",
  "011666661100",
  "001111111000",
  "001111111000",
  "000110110000",
  "000110110000",
  "000000000000",
];
const ENEMY_1_MAP = { "1": "#9b5cff", "2": "#5a2a9a", "3": "#ffe070", "4": "#c89bff", "6": "#2a1040" };

// ENEMY 2 — 업무 독촉 마귀 (fast, small sleek red imp)
const ENEMY_2_SPRITE = [
  "000000010000",
  "000000110000",
  "000111110000",
  "041111110000",
  "041311130000",
  "004111110000",
  "000116100000",
  "000111100000",
  "000011000000",
  "000110000000",
  "001100000000",
  "000000000000",
];
const ENEMY_2_MAP = { "1": "#ff4d4d", "2": "#a31515", "3": "#ffe070", "4": "#ff9aa2", "6": "#5a0a0a" };

// ENEMY 3 — 충동지출 자폭령 (black bomb with a lit fuse)
const ENEMY_3_SPRITE = [
  "00000055000000",
  "00000455000000",
  "00000445000000",
  "00000440000000",
  "00011111100000",
  "00111111110000",
  "01111221111000",
  "01122111111000",
  "11111111111100",
  "11111111111100",
  "11111111111100",
  "01111111111000",
  "00111111110000",
  "00001111000000",
];
const ENEMY_3_MAP = { "1": "#1a1a22", "2": "#4a4a5a", "3": "#b06a2a", "4": "#ffd166", "5": "#ff5a1f" };
// All-red palette used while the bomber blinks before exploding
const BOMBER_FLASH_MAP = { "1": "#ff2e2e", "2": "#ff6a6a", "3": "#ff2e2e", "4": "#ffd166", "5": "#ff5a1f" };

// ENEMY 4 — 잔소리 화살 악령 (pale ghost with a speech bubble)
const ENEMY_4_SPRITE = [
  "00000000044400",
  "00011111044400",
  "00111111104400",
  "01111111110000",
  "01133113110000",
  "01111111110000",
  "01111111110000",
  "01111111110000",
  "01111111110000",
  "01111111110000",
  "01111111110000",
  "01010101010000",
  "00100100100000",
  "00000000000000",
];
const ENEMY_4_MAP = { "1": "#bcd6ef", "2": "#6a8caf", "3": "#20324a", "4": "#ffffff" };

// ENEMY 5 — 실적 압박 골렘 (bulky gray stone tank)
const ENEMY_5_SPRITE = [
  "0000000000000000",
  "0011111111110000",
  "0111111111111000",
  "0111111111111000",
  "0114111111411000",
  "0111111111111000",
  "0111122221111000",
  "0111111111111000",
  "1111111111111100",
  "1111111111111100",
  "0111111111111000",
  "0111111111111000",
  "0111221122110000",
  "0011100011100000",
  "0011100011100000",
  "0000000000000000",
];
const ENEMY_5_MAP = { "1": "#6b7280", "2": "#3f4650", "3": "#9aa3b0", "4": "#ff7a3c" };

// Per-type base stats (HP/damage scaled per wave at spawn time)
const ENEMY_TYPES = {
  basic:  { hp: 15, speed: 1.2, contactDps: 8,  r: 13, gold: 5,  sprite: ENEMY_1_SPRITE, colorMap: ENEMY_1_MAP },
  fast:   { hp: 8,  speed: 2.2, contactDps: 6,  r: 10, gold: 6,  sprite: ENEMY_2_SPRITE, colorMap: ENEMY_2_MAP },
  bomber: { hp: 25, speed: 1.6, contactDps: 0,  r: 13, gold: 12, sprite: ENEMY_3_SPRITE, colorMap: ENEMY_3_MAP, explodeDmg: 20 },
  ranged: { hp: 12, speed: 1.0, contactDps: 0,  r: 12, gold: 10, sprite: ENEMY_4_SPRITE, colorMap: ENEMY_4_MAP, shotDmg: 8 },
  tank:   { hp: 80, speed: 0.6, contactDps: 14, r: 22, gold: 20, sprite: ENEMY_5_SPRITE, colorMap: ENEMY_5_MAP },
};

// Wave 10 boss: stern GRAY-SUIT AUDITOR demon — glasses + folder (16x16)
const BOSS_1_SPRITE = [
  "0000000000000000",
  "0000500000050000",
  "0000522222250000",
  "0002222222222000",
  "0022222222222200",
  "0023333333332200",
  "0022222222222200",
  "0002222222222000",
  "0000222222200000",
  "0001144444411000",
  "0001144744411000",
  "0001114774111000",
  "0001111666666000",
  "0001111666666000",
  "0001110001110000",
  "0001100000011000",
];
const BOSS_1_MAP = {
  "1": "#3a3f4b", // charcoal suit / shoes
  "2": "#7e8c84", // gray-green skin
  "3": "#e8eaf0", // light glasses frame (stands out on the dark suit)
  "4": "#eef1f6", // shirt
  "5": "#a07840", // horns (brighter so they read as horns)
  "6": "#e8d48a", // audit folder
  "7": "#7a2b2b", // tie
};

// Wave 20 boss: NEON-GLITCH SERVER RACK — tangled cables + sparks (16x16)
const BOSS_2_SPRITE = [
  "0000040000400000",
  "0001111111111000",
  "0001222222221000",
  "0001233333321000",
  "0001234444321000",
  "0001233663321000",
  "0001222222221000",
  "0001166116611000",
  "0001111111111000",
  "0001616161611000",
  "0001111111111000",
  "0001111111111000",
  "0005003005003000",
  "0030050530050300",
  "0500305003530050",
  "0000000000000000",
];
const BOSS_2_MAP = {
  "1": "#1a2230", // rack metal
  "2": "#4fe0ff", // cyan screen
  "3": "#2a6cff", // blue
  "4": "#eafcff", // white spark
  "5": "#8a5cff", // tangled cable
  "6": "#ff4d4d", // error LED
};

// Wave 30 boss: RED DEMON KING — giant horns + "반려" stamps (16x16)
const BOSS_3_SPRITE = [
  "0030000000000300",
  "0033000000003300",
  "0033300000033300",
  "0003311111133000",
  "0001111111111000",
  "0011111111111100",
  "0011111111111100",
  "0011144114411100",
  "0011111111111100",
  "0011166666611100",
  "0011667667661100",
  "0011166666611100",
  "0001111111110000",
  "0555011111105550",
  "0575011111105750",
  "0001100001100000",
];
const BOSS_3_MAP = {
  "1": "#c0241a", // red body
  "2": "#7a140d", // shade
  "3": "#ffce5c", // golden horns
  "4": "#ffe070", // glowing eyes
  "5": "#ff2e2e", // 반려 stamp
  "6": "#3a0a06", // mouth
  "7": "#ffffff", // stamp text / fangs
};

const BOSS_SPRITES = { 10: BOSS_1_SPRITE, 20: BOSS_2_SPRITE, 30: BOSS_3_SPRITE };
const BOSS_MAPS = { 10: BOSS_1_MAP, 20: BOSS_2_MAP, 30: BOSS_3_MAP };

// Sparkling gold coin
const GOLD_SPRITE = [
  "00111100",
  "01222210",
  "11233211",
  "12233221",
  "12233221",
  "11233211",
  "01222210",
  "00111100",
];
const GOLD_MAP = { "1": "#d4a015", "2": "#ffd166", "3": "#fff3c4" };

// Hanwha-styled energy potion (orange liquid, green cross) — for shop flavour
const POTION_SPRITE = [
  "000003300000",
  "000033330000",
  "000011110000",
  "000111111000",
  "001155551100",
  "011554455110",
  "011544445110",
  "011522225110",
  "011222222110",
  "011222222110",
  "001122221100",
  "000111111000",
];
const POTION_MAP = {
  "1": "#dff0ff",
  "2": "#ff8c2b",
  "3": "#8a5a2b",
  "4": "#57e07a",
  "5": "#bcd6ef",
};

// Money bundle (swung as the melee weapon)
const MONEY_SPRITE = [
  "1111111111",
  "1222222221",
  "1233333321",
  "1232112321",
  "1233333321",
  "1222222221",
  "1111111111",
];
const MONEY_MAP = {
  "1": "#1f8f3a", // dark green edge
  "2": "#57e07a", // green bill
  "3": "#ffd166", // gold band
};

// Money bag (swung as the high-tier "bag" weapon)
const BAG_SPRITE = [
  "0001331000",
  "0011111100",
  "0111111112",
  "1111311112",
  "1113331112",
  "1111311112",
  "1111111122",
  "0111111122",
  "0011111220",
  "0001111200",
];
const BAG_MAP = {
  "1": "#2e7d32", // bag green
  "2": "#1b5e20", // side shadow
  "3": "#ffd166", // gold $ / tie
};

// Draw a sprite matrix centered at (x,y), scaled to width x height
function drawPixelSprite(sprite, x, y, width, height, colorMap, flip = false) {
  const rows = sprite.length;
  const cols = sprite[0].length;
  const pw = width / cols;
  const ph = height / rows;
  const left = x - width / 2;
  const top = y - height / 2;
  for (let r = 0; r < rows; r++) {
    const row = sprite[r];
    for (let c = 0; c < cols; c++) {
      const color = colorMap[row[flip ? cols - 1 - c : c]];
      if (!color) continue; // "0" / unknown = transparent
      ctx.fillStyle = color;
      // +1 overlap removes hairline gaps between scaled pixels
      ctx.fillRect(Math.floor(left + c * pw), Math.floor(top + r * ph), Math.ceil(pw) + 1, Math.ceil(ph) + 1);
    }
  }
}

/* ============================================================
   Render
   ============================================================ */
function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

function render() {
  if (endingScene) {
    drawEndingScene();
    return;
  }

  ctx.clearRect(0, 0, W, H);
  drawGrid();

  // faint magnet range
  ctx.strokeStyle = "rgba(255,176,32,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.magnet, 0, Math.PI * 2);
  ctx.stroke();

  // gold coins (pixel sprite)
  for (const g of golds) drawPixelSprite(GOLD_SPRITE, g.x, g.y, 16, 16, GOLD_MAP);

  // coin-weapon projectiles
  for (const c of coins) drawPixelSprite(GOLD_SPRITE, c.x, c.y, 16, 16, GOLD_MAP);

  // enemies (per-type sprites) + tiny hp pips
  for (const e of enemies) {
    // bombers blink red while arming
    let map = e.colorMap;
    if (e.type === "bomber" && e.isExploding && Math.floor(e.explodeTimer * 10) % 2 === 0) {
      map = BOMBER_FLASH_MAP;
    }
    const size = e.r * 2.4;
    drawPixelSprite(e.sprite, e.x, e.y, size, size, map, player.x < e.x);
    const w = e.r * 2;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(e.x - e.r, e.y - e.r - 9, w, 3);
    ctx.fillStyle = "#57e07a";
    ctx.fillRect(e.x - e.r, e.y - e.r - 9, w * (e.hp / e.maxHp), 3);
  }

  // asset-freeze fields (cyan slow zones)
  for (const fz of freezeZones) {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#4fe0ff";
    ctx.beginPath(); ctx.arc(fz.x, fz.y, fz.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "#aef3ff";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(fz.x, fz.y, fz.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // explosion blasts (expanding orange rings)
  for (const ex of explosions) {
    ctx.globalAlpha = Math.max(0, ex.life / 0.4);
    ctx.fillStyle = "#ff8c2b";
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, ex.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // telegraphed reject-stamp hazards (growing red ring + "반려")
  for (const hz of hazards) {
    const k = 1 - hz.t / 0.85; // 0 -> 1 windup
    ctx.globalAlpha = 0.5 + 0.4 * k;
    ctx.strokeStyle = "#ff2e2e";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.25 + 0.5 * k;
    ctx.fillStyle = "#ff2e2e";
    ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r * k, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = "bold 20px 'Noto Sans KR', sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#7a0000";
    ctx.strokeText("반려", hz.x, hz.y + 7); // dark outline keeps it readable
    ctx.fillStyle = "#fff";
    ctx.fillText("반려", hz.x, hz.y + 7);
    ctx.textAlign = "start";
  }

  // boss bullets + ranged-enemy projectiles (per-projectile color)
  for (const bb of bossBullets) {
    ctx.fillStyle = bb.color || "#ff9a3c";
    ctx.fillRect(bb.x - bb.r, bb.y - bb.r, bb.r * 2, bb.r * 2);
  }

  // boss (pixel sprite, faces the player; glows red when enraged)
  if (bossActive && boss) {
    drawPixelSprite(boss.sprite, boss.x, boss.y, boss.r * 2.3, boss.r * 2.3, boss.colorMap, player.x < boss.x);
    if (boss.enraged) {
      // gold aura stands out against the red boss body
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = "#ffd23d";
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.r * 1.2, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#ffd23d";
      ctx.beginPath(); ctx.arc(boss.x, boss.y, boss.r * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // weapon attack visuals (drawn under the player so the character stays visible)
  drawSwing();
  drawStorm();

  // player (career stage changes the sprite; flashes white when hit)
  const stage = playerStage();
  const pMap = player.hitFlash > 0 ? PLAYER_HIT_MAP : stage.map;
  drawPixelSprite(stage.sprite, player.x, player.y, player.r * 2.6, player.r * 2.6, pMap, playerFlip);
}

// cash / bag: draw the fan cone + the weapon dot sweeping across its arc
function drawSwing() {
  if (!player.swing.active) return;
  const progress = 1 - player.swing.t / SWING_DURATION; // 0 -> 1
  const base = player.swing.angle;
  const range = player.swing.range;
  const half = player.swing.halfArc;
  const isBag = player.weaponType === "bag";

  // translucent cone showing the hit area (bag is heavier + outlined)
  ctx.fillStyle = isBag ? "rgba(46, 125, 50, 0.34)" : "rgba(87, 224, 122, 0.18)";
  ctx.beginPath();
  ctx.moveTo(player.x, player.y);
  ctx.arc(player.x, player.y, range, base - half, base + half);
  ctx.closePath();
  ctx.fill();
  if (isBag) {
    ctx.strokeStyle = "rgba(46, 125, 50, 0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // weapon dot sweeps from one edge of the cone to the other
  const ang = base - half + progress * (half * 2);
  const mx = player.x + Math.cos(ang) * (range * 0.7);
  const my = player.y + Math.sin(ang) * (range * 0.7);
  const sprite = isBag ? BAG_SPRITE : MONEY_SPRITE;
  const map = isBag ? BAG_MAP : MONEY_MAP;
  drawPixelSprite(sprite, mx, my, isBag ? 28 : 26, isBag ? 26 : 18, map, Math.cos(ang) < 0);
}

// storm: swirling green bills bursting 360° around the player
function drawStorm() {
  if (!player.storm.active) return;
  const p = 1 - player.storm.t / STORM_DURATION; // 0 -> 1 expansion
  const R = player.attackRange;

  // expanding green shockwave ring
  ctx.globalAlpha = 0.18 * (1 - p);
  ctx.fillStyle = "#57e07a";
  ctx.beginPath();
  ctx.arc(player.x, player.y, R * p, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 10 bills swirling outward (rotates as it expands)
  const n = 10;
  for (let i = 0; i < n; i++) {
    const ang = ((Math.PI * 2) / n) * i + p * Math.PI;
    const rad = R * (0.3 + 0.7 * p);
    const bx = player.x + Math.cos(ang) * rad;
    const by = player.y + Math.sin(ang) * rad;
    drawPixelSprite(MONEY_SPRITE, bx, by, 18, 12, MONEY_MAP, Math.cos(ang) < 0);
  }
}

/* ============================================================
   Cinematic retirement ending scene (drawn on the canvas)
   ============================================================ */
// Stylized orange Hanwha tri-petal emblem
function drawHanwhaEmblem(cx, cy, r) {
  ctx.fillStyle = "#fa520f";
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + i * ((Math.PI * 2) / 3);
    const px = cx + Math.cos(a) * r * 0.5;
    const py = cy + Math.sin(a) * r * 0.5;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.6, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function drawEndingScene() {
  // Sunset sky: indigo -> orange -> gold
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#2b2a5e");
  sky.addColorStop(0.5, "#c25a2a");
  sky.addColorStop(0.82, "#ffb020");
  sky.addColorStop(1, "#ffd166");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Setting sun with glow
  const sunX = W * 0.72, sunY = H * 0.45;
  const glow = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 90);
  glow.addColorStop(0, "rgba(255,240,180,0.95)");
  glow.addColorStop(1, "rgba(255,200,80,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(sunX, sunY, 90, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff1c0";
  ctx.beginPath(); ctx.arc(sunX, sunY, 34, 0, Math.PI * 2); ctx.fill();

  // Hanwha building rooftop
  const roofY = H * 0.66;
  ctx.fillStyle = "#1f2433";
  ctx.fillRect(0, roofY, W, H - roofY);

  // Diagonal grid pattern on the rooftop
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  const depth = H - roofY;
  for (let i = -depth; i < W; i += 26) {
    ctx.beginPath(); ctx.moveTo(i, roofY); ctx.lineTo(i + depth, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + depth, roofY); ctx.stroke();
  }
  // Front edge of the rooftop
  ctx.fillStyle = "#2a3142";
  ctx.fillRect(0, roofY, W, 6);

  // Orange Hanwha emblem
  drawHanwhaEmblem(66, 66, 30);

  // Retired elder with a cane, standing on the roof, gazing at the sunset
  drawPixelSprite(PLAYER_ELDER, W * 0.34, roofY - 36, 76, 76, PLAYER_ELDER_MAP, false);

  // Emotional retirement subtitles
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff8e0";
  ctx.font = "bold 22px 'Gowun Batang', serif";
  ctx.fillText("30년의 여정, 정말 수고하셨습니다.", W / 2, H - 90);
  ctx.font = "15px 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "rgba(255,248,224,0.92)";
  ctx.fillText("이제, 당신의 두 번째 인생이 시작됩니다.", W / 2, H - 62);
  ctx.textAlign = "start";
}

/* ============================================================
   Main loop (requestAnimationFrame)
   ============================================================ */
function loop(ts) {
  if (!lastTime) lastTime = ts;
  let dt = (ts - lastTime) / 1000;
  lastTime = ts;
  if (dt > 0.05) dt = 0.05; // clamp big gaps (e.g., tab switch)
  update(dt);
  render();
  requestAnimationFrame(loop);
}

/* ============================================================
   Wave timer (1s tick) — clears the wave at 0
   ============================================================ */
function startTimer() {
  setInterval(() => {
    if (isPaused || gameOver) return;
    if (bossActive) return; // boss waves are cleared by killing the boss, not the timer
    waveTimer -= 1;
    if (waveTimer <= 0) {
      waveTimer = 0;
      clearWave();
    }
    updateHUD();
  }, 1000);
}

function clearWave() {
  // Auto-collect leftover gold, wipe the field, pause, open the shop
  for (const g of golds) gold += g.value;
  golds = [];
  enemies = [];
  bossBullets = [];
  explosions = [];
  freezeZones = [];
  hazards = [];
  player.slowTimer = 0;
  coins = [];
  player.swing.active = false;
  player.storm.active = false;
  isPaused = true;
  updateHUD();
  openShop();
}

/* ============================================================
   Intermission shop
   ============================================================ */
function openShop() {
  saveWave(currentWave + 1); // resume from the next wave on a later visit
  shopModal.hidden = false;
  updateShopUI();
}

function updateShopUI() {
  shopGoldEl.textContent = gold;
  potionBtn.disabled = gold < 30;
  // Explain why the potion is locked so it never feels broken
  potionDesc.textContent =
    gold < 30 ? "골드가 부족합니다 (30 G 필요)" : "현재 체력을 최대치의 50% 즉시 회복";
  upgradeBtns.forEach((b) => (b.disabled = gold < Number(b.dataset.cost)));
}

// Hanwha Life energy potion: instantly heal 50% of max HP
function buyPotion() {
  if (gold < 30) return;
  gold -= 30;
  player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.5);
  writeSave();
  updateShopUI();
  updateHUD();
}

// Wellness upgrade: raises ONLY the metric's training bonus (lifeData untouched)
function buyUpgrade(type) {
  if (gold < 150) return;
  gold -= 150;

  const metric = TYPE_TO_METRIC[type];
  trainingBonus[metric] = Math.min(7, trainingBonus[metric] + 1);

  applySpecs(); // live update of player stats (Max HP, damage, magnet, speed)
  writeSave(); // reflected to localStorage immediately -> report page syncs
  updateShopUI();
  updateHUD();
}

/* ============================================================
   Wave progression / game over / return
   ============================================================ */
// Set up whatever wave currentWave points at (boss or normal) and start it
function setupWave() {
  shopModal.hidden = true;
  isPaused = false;
  spawnCd = 0;
  lastTime = 0; // avoid a huge dt on the first frame
  enemies = [];
  bossBullets = [];
  explosions = [];
  freezeZones = [];
  hazards = [];
  player.slowTimer = 0;
  coins = [];
  player.swing.active = false;
  player.storm.active = false;
  bomberCd = 0;
  goldAtWaveStart = gold; // back up gold at the start of the wave

  if (isBossWave(currentWave)) {
    startBoss(currentWave);
  } else {
    bossActive = false;
    boss = null;
    bossHud.style.display = "none";
    waveTimer = 30;
  }
  updateHUD();
}

function startNextWave() {
  currentWave += 1;
  setupWave();
}

// Persist progress so the player can resume from this wave next time
function saveWave(n) {
  try {
    localStorage.setItem("savedWave", String(n));
  } catch (e) {
    /* ignore */
  }
}

function triggerGameOver() {
  gameOver = true;
  gold = goldAtWaveStart; // penalty: forfeit gold earned this wave
  writeSave();
  goWaveEl.textContent = currentWave;
  updateHUD();
  gameoverModal.hidden = false;
}

/* ============================================================
   Pause menu (ESC) — pause and offer a direct exit to the report
   ============================================================ */
function togglePause() {
  if (gameOver) return; // nothing to pause
  if (!shopModal.hidden) return; // the intermission shop already pauses the game
  if (pauseModal.hidden) {
    isPaused = true;
    pauseModal.hidden = false;
  } else {
    resumeGame();
  }
}

function resumeGame() {
  pauseModal.hidden = true;
  isPaused = false;
  lastTime = 0; // avoid a huge dt jump on the first frame after resuming
}

// Successful exit (wave cleared / final ending): keep the gold
function returnToReport() {
  writeSave();
  window.location.href = "index.html";
}

// Mid-wave exit (ESC) or death: forfeit gold earned in the current wave
function abandonToReport() {
  gold = goldAtWaveStart;
  writeSave();
  window.location.href = "index.html";
}

/* ============================================================
   Boss waves (10 / 20 / 30)
   ============================================================ */
function isBossWave(w) {
  return w === 10 || w === 20 || w === 30;
}

const BOSS_DEFS = {
  10: { name: "금융감독원 불시 정기감사", hp: 500, dmg: 15, speed: 45, pattern: "none", gold: 120, color: "#ff5252" },
  20: { name: "시스템 대규모 마이그레이션 장애", hp: 1500, dmg: 25, speed: 60, pattern: "ring", gold: 250, color: "#b25cff" },
  30: { name: "임원 대면 결제 서류 반려 마왕", hp: 4000, dmg: 40, speed: 72, pattern: "burst", gold: 500, color: "#ff2e2e" },
};

function startBoss(wave) {
  const d = BOSS_DEFS[wave];
  bossActive = true;
  boss = {
    name: d.name,
    wave,
    x: W / 2, y: 90, r: 40,
    hp: d.hp, maxHp: d.hp,
    speed: d.speed, contactDmg: d.dmg,
    gold: d.gold, color: d.color,
    sprite: BOSS_SPRITES[wave], colorMap: BOSS_MAPS[wave],
    enraged: false,
    // per-boss pattern timers
    folderCd: 2.2, freezeCd: 3, // wave 10
    glitchCd: 3, // wave 20
    stampCd: 2.5, rainCd: 2, mobCd: 1.2, // wave 30
  };
  enemies = [];
  bossBullets = [];
  explosions = [];
  freezeZones = [];
  hazards = [];
  bossNameEl.textContent = d.name;
  bossHud.style.display = "block";
  updateBossHud();
}

/* ============================================================
   Boss gimmick patterns (per wave)
   ============================================================ */
function knockbackPlayer(fromX, fromY, dist) {
  const dx = player.x - fromX, dy = player.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  player.x = Math.max(player.r, Math.min(W - player.r, player.x + (dx / d) * dist));
  player.y = Math.max(player.r, Math.min(H - player.r, player.y + (dy / d) * dist));
}

function dmgScaleNow() {
  return 1 + (currentWave - 1) * 0.1; // matches enemy damage scaling
}

function updateBossPattern(dt) {
  if (boss.wave === 10) {
    // 8-direction folder spray
    boss.folderCd -= dt;
    if (boss.folderCd <= 0) { fireFolderSpray(); boss.folderCd = 2.2; }
    // asset-freeze field dropped on the player's position
    boss.freezeCd -= dt;
    if (boss.freezeCd <= 0) { freezeZones.push({ x: player.x, y: player.y, r: 72, life: 4 }); boss.freezeCd = 5; }
  } else if (boss.wave === 20) {
    // teleport + error shards + dashing bug minions every 5s
    boss.glitchCd -= dt;
    if (boss.glitchCd <= 0) { migrationGlitch(); boss.glitchCd = 5; }
  } else if (boss.wave === 30) {
    // enrage below 30% HP: red, halved cooldowns, endless mobs
    if (!boss.enraged && boss.hp <= boss.maxHp * 0.3) boss.enraged = true;
    const cd = boss.enraged ? 0.5 : 1;

    boss.stampCd -= dt;
    if (boss.stampCd <= 0) { aimRejectStamp(); boss.stampCd = 3 * cd; }
    boss.rainCd -= dt;
    if (boss.rainCd <= 0) { documentRain(); boss.rainCd = 2.5 * cd; }
    if (boss.enraged) {
      boss.mobCd -= dt;
      if (boss.mobCd <= 0) { spawnEnemy(); boss.mobCd = 1.2; } // infinite overtime swarm
    }
  }
}

// Wave 10 — 8-way folder projectiles
function fireFolderSpray() {
  const speed = 175;
  const dmg = Math.round(boss.contactDmg * 0.4);
  for (let i = 0; i < 8; i++) {
    const ang = ((Math.PI * 2) / 8) * i;
    bossBullets.push({
      x: boss.x, y: boss.y,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      r: 8, dmg, life: 4, color: "#e8d48a",
    });
  }
}

// Wave 20 — teleport, error-code shard spread, and 3 dashing bug minions
function migrationGlitch() {
  boss.x = 90 + Math.random() * (W - 180);
  boss.y = 70 + Math.random() * (H * 0.45);

  const base = Math.atan2(player.y - boss.y, player.x - boss.x);
  const dmg = Math.round(boss.contactDmg * 0.4);
  for (const off of [-0.3, -0.15, 0, 0.15, 0.3]) {
    const ang = base + off;
    bossBullets.push({
      x: boss.x, y: boss.y,
      vx: Math.cos(ang) * 220, vy: Math.sin(ang) * 220,
      r: 6, dmg, life: 4, color: "#4fe0ff",
    });
  }

  const dmgScale = dmgScaleNow();
  for (let j = 0; j < 3; j++) {
    enemies.push({
      type: "fast",
      x: boss.x + (Math.random() * 40 - 20),
      y: boss.y + (Math.random() * 40 - 20),
      r: 9,
      hp: 6, maxHp: 6,
      speed: 3.2 * 60, // fast dash
      contactDps: 6 * dmgScale,
      gold: 0,
      sprite: ENEMY_2_SPRITE, colorMap: ENEMY_2_MAP,
    });
  }
}

// Wave 30 — telegraphed giant REJECT stamp aimed at the player
function aimRejectStamp() {
  hazards.push({
    kind: "stamp",
    x: player.x, y: player.y,
    r: 64, t: 0.85,
    dmg: 40, // fixed 40 damage per spec
  });
}

// Wave 30 — documents raining from the sky
function documentRain() {
  const dmg = Math.round(boss.contactDmg * 0.3);
  const count = boss.enraged ? 9 : 6;
  for (let k = 0; k < count; k++) {
    bossBullets.push({
      x: Math.random() * W, y: -10,
      vx: 0, vy: 165,
      r: 7, dmg, life: 6, color: "#eef1f6",
    });
  }
}

function updateBossHud() {
  if (!boss) return;
  bossHpFill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + "%";
}

function defeatBoss() {
  if (!boss) return;
  gold += boss.gold;
  const wasFinal = currentWave >= 30;
  bossActive = false;
  boss = null;
  bossBullets = [];
  bossHud.style.display = "none";
  updateHUD();

  if (wasFinal) {
    triggerEnding(); // 30웨이브 클리어 -> Future Me 2056 엔딩
  } else {
    isPaused = true;
    openShop();
  }
}

/* ============================================================
   Future Me 2056 ending card
   ============================================================ */
const FUTURE_TEXT = {
  physical: {
    A: "90세에도 마라톤을 완주하는 무쇠 체력의 시니어",
    B: "또래보다 10년은 젊게 사는 활력 넘치는 시니어",
    C: "동네 뒷산을 가볍게 오르내리는 건강한 노년",
    D: "가끔 무릎이 시큰하지만 그럭저럭 버티는 노후",
    F: "병원이 단골이 되어버린, 건강이 아쉬운 노년",
  },
  financial: {
    A: "한화생명 VIP 연금 소득으로 여유로운 황혼기를 즐기는 자산가",
    B: "차곡차곡 모은 연금으로 부족함 없는 안정적인 노후",
    C: "알뜰하게 아끼며 소소한 행복을 누리는 은퇴 생활",
    D: "연금만으로는 빠듯해 가계부를 놓지 못하는 노년",
    F: "노후 자금이 빠듯해 재정 걱정이 끊이지 않는 황혼기",
  },
  inspirational: {
    A: "은퇴 후 로망이던 동네 아늑한 골목 카페의 에스프레소 장인 사장님",
    B: "취미를 살려 작은 공방을 운영하는 손재주 좋은 은퇴 장인",
    C: "동호회 활동으로 매일이 바쁜 열정적인 시니어",
    D: "이것저것 기웃거리며 아직 나만의 일을 찾는 중인 노년",
    F: "무료한 하루 속에서 새 도전을 망설이는 노년",
  },
  mental: {
    A: "근심 걱정 없이 세계 휴양지를 도는 디지털 노마드 힐링 노인",
    B: "마음의 여유를 잃지 않는, 동네 인기 만점 멘토 어르신",
    C: "소소한 일상에 감사하며 평온하게 지내는 노년",
    D: "가끔 마음이 무거워도 가족과 의지하며 버티는 노후",
    F: "번아웃의 그림자가 노년까지 남은, 쉼이 필요한 인생",
  },
};

const METRIC_LABELS = { physical: "신체", financial: "재무", inspirational: "자기개발", mental: "정신" };

function generateFutureSelf() {
  const g = computeGrades(state);
  const who = state.name || "당신";
  // S/SS/SSS share the top-tier (A) narrative line
  const tk = (letter) => (GRADE_SCORE[letter] >= 4 ? "A" : letter);

  futureMeText.textContent =
    `2056년의 ${who} 님은,\n` +
    `${FUTURE_TEXT.physical[tk(g.physical)]}이자,\n` +
    `${FUTURE_TEXT.financial[tk(g.financial)]}.\n` +
    `${FUTURE_TEXT.inspirational[tk(g.inspirational)]}이며,\n` +
    `${FUTURE_TEXT.mental[tk(g.mental)]}입니다.`;

  endingName.textContent = state.name || "홍길동";

  endingGrades.innerHTML = "";
  ["physical", "financial", "inspirational", "mental"].forEach((k) => {
    const cell = document.createElement("div");
    cell.className = "ending-grade";
    cell.innerHTML = `<span class="eg-metric">${METRIC_LABELS[k]}</span><span class="eg-mark">${g[k]}</span>`;
    endingGrades.appendChild(cell);
  });
}

function triggerEnding() {
  gameOver = true; // freeze the game permanently
  endingScene = true; // play the cinematic retirement scene on the canvas
  saveWave(1); // ending seen -> next adventure restarts from wave 1
  writeSave();
  generateFutureSelf(); // prepare the Future Me 2056 card content

  // Hide the in-game HUD during the cinematic
  const hudEl = document.querySelector(".hud");
  const hintEl = document.querySelector(".controls-hint");
  if (hudEl) hudEl.style.display = "none";
  if (hintEl) hintEl.style.display = "none";

  // Let the cinematic play, then pop the Future Me 2056 card
  setTimeout(() => {
    endingModal.hidden = false;
  }, 3500);
}

// Capture the ending card as a PNG via html2canvas
async function downloadEnding() {
  if (typeof html2canvas === "undefined") {
    alert("이미지 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.");
    return;
  }
  const original = btnDownloadEnding.textContent;
  btnDownloadEnding.disabled = true;
  btnDownloadEnding.textContent = "이미지 생성 중...";
  try {
    const out = await html2canvas(endingCard, { scale: 2, backgroundColor: null, useCORS: true, logging: false });
    const link = document.createElement("a");
    link.download = "future-me-ending.png";
    link.href = out.toDataURL("image/png");
    link.click();
  } catch (e) {
    alert("이미지 저장 중 문제가 발생했습니다. 다시 시도해주세요.");
  } finally {
    btnDownloadEnding.disabled = false;
    btnDownloadEnding.textContent = original;
  }
}

/* ============================================================
   HUD
   ============================================================ */
function updateHUD() {
  hudWave.textContent = currentWave;
  hudGold.textContent = gold;
  hudTimer.textContent = bossActive ? "BOSS" : Math.max(0, waveTimer);
  hudTimer.classList.toggle("urgent", !bossActive && waveTimer <= 5 && !isPaused && !gameOver);

  const pct = Math.max(0, (player.hp / player.maxHp) * 100);
  hudHpFill.style.width = pct + "%";
  hudHpText.textContent = `${Math.max(0, Math.round(player.hp))} / ${player.maxHp}`;

  statDmg.textContent = player.damage;
  statMagnet.textContent = player.magnet;
  statSpeed.textContent = player.speed;
}

/* ============================================================
   DOM references
   ============================================================ */
const hudWave = document.getElementById("hud-wave");
const hudTimer = document.getElementById("hud-timer");
const hudGold = document.getElementById("hud-gold");
const hudHpFill = document.getElementById("hud-hp-fill");
const hudHpText = document.getElementById("hud-hp-text");
const statDmg = document.getElementById("stat-dmg");
const statMagnet = document.getElementById("stat-magnet");
const statSpeed = document.getElementById("stat-speed");

const shopModal = document.getElementById("shop-modal");
const shopGoldEl = document.getElementById("shop-gold");
const potionBtn = document.getElementById("buy-potion");
const potionDesc = potionBtn.querySelector(".potion-desc");
const upgradeBtns = Array.from(document.querySelectorAll(".upgrade-btn"));
const btnNextWave = document.getElementById("btn-next-wave");
const btnReturn = document.getElementById("btn-return");

const gameoverModal = document.getElementById("gameover-modal");
const goWaveEl = document.getElementById("go-wave");
const btnReturnGo = document.getElementById("btn-return-go");

const pauseModal = document.getElementById("pause-modal");
const btnResume = document.getElementById("btn-resume");
const btnReturnPause = document.getElementById("btn-return-pause");

const bossHud = document.getElementById("boss-hud");
const bossNameEl = document.getElementById("boss-name");
const bossHpFill = document.getElementById("boss-hp-fill");

const endingModal = document.getElementById("ending-modal");
const endingCard = document.getElementById("ending-card");
const futureMeText = document.getElementById("future-me-text");
const endingName = document.getElementById("ending-name");
const endingGrades = document.getElementById("ending-grades");
const btnDownloadEnding = document.getElementById("btn-download-ending");
const btnReturnEnding = document.getElementById("btn-return-ending");

/* ============================================================
   Boot
   ============================================================ */
function init() {
  loadSave(); // sets state (lifeData), gold, and trainingBonus
  applySpecs();

  // Resume from the last cleared wave (reset if the ending was already seen)
  currentWave = Number(localStorage.getItem("savedWave")) || 1;
  if (currentWave > 30) currentWave = 1;

  potionBtn.addEventListener("click", buyPotion);
  upgradeBtns.forEach((b) => b.addEventListener("click", () => buyUpgrade(b.dataset.upgrade)));
  btnNextWave.addEventListener("click", startNextWave);
  btnReturn.addEventListener("click", returnToReport); // shop: wave cleared, keep gold
  btnReturnGo.addEventListener("click", abandonToReport); // game over: forfeit this wave
  btnResume.addEventListener("click", resumeGame);
  btnReturnPause.addEventListener("click", abandonToReport); // ESC exit: forfeit this wave
  btnDownloadEnding.addEventListener("click", downloadEnding);
  btnReturnEnding.addEventListener("click", returnToReport); // final clear: keep gold

  updateShopUI();
  startTimer();
  setupWave(); // set up the starting / resumed wave (boss or normal)
  requestAnimationFrame(loop);
}

init();
