/* ============================================================
   LIFEPLUS 인생 성적표 - app.js
   Reads lifestyle inputs and grades the 4 LIFEPLUS wellness
   metrics (Physical, Financial, Inspirational, Mental) in real
   time, builds a dynamic title + overall comment, previews the
   uploaded profile photo, and bridges data to the 2D game via
   localStorage.
   ============================================================ */

/* ---- Cache DOM references ---- */
const els = {
  // inputs
  name: document.getElementById("input-name"),
  status: document.getElementById("input-status"),
  sleep: document.getElementById("input-sleep"),
  savings: document.getElementById("input-savings"),
  work: document.getElementById("input-work"),
  exercise: document.getElementById("input-exercise"),
  photo: document.getElementById("input-photo"),
  btnGame: document.getElementById("btn-game"),
  btnDownload: document.getElementById("btn-download"),
  btnReset: document.getElementById("btn-reset"),
  reportCard: document.getElementById("report-card"),
  // slider value labels + training bonus indicators
  valueSleep: document.getElementById("value-sleep"),
  valueWork: document.getElementById("value-work"),
  bonusSleep: document.getElementById("bonus-sleep"),
  bonusWork: document.getElementById("bonus-work"),
  // report card text outputs
  reportDate: document.getElementById("report-date"),
  reportName: document.getElementById("report-name"),
  reportStatus: document.getElementById("report-status"),
  reportTitle: document.getElementById("report-title"),
  reportOverall: document.getElementById("report-overall"),
  // profile photo
  profileImg: document.getElementById("profile-img"),
  profilePlaceholder: document.getElementById("profile-placeholder"),
  // grade marks
  grade: {
    physical: document.getElementById("grade-physical"),
    financial: document.getElementById("grade-financial"),
    inspirational: document.getElementById("grade-inspirational"),
    mental: document.getElementById("grade-mental"),
  },
  // grade comments
  comment: {
    physical: document.getElementById("comment-physical"),
    financial: document.getElementById("comment-financial"),
    inspirational: document.getElementById("comment-inspirational"),
    mental: document.getElementById("comment-mental"),
  },
  // grade rows (for the colored left accent via [data-grade])
  row: {
    physical: document.querySelector('.grade-row[data-metric="physical"]'),
    financial: document.querySelector('.grade-row[data-metric="financial"]'),
    inspirational: document.querySelector('.grade-row[data-metric="inspirational"]'),
    mental: document.querySelector('.grade-row[data-metric="mental"]'),
  },
};

/* ---- Grade <-> score helpers ---- */
const GRADE_SCORE = { F: 0, D: 1, C: 2, B: 3, A: 4, S: 5, SS: 6, SSS: 7 };
const SCORE_LETTER = ["F", "D", "C", "B", "A", "S", "SS", "SSS"];
const scoreOf = (grade) => GRADE_SCORE[grade];

// Gold earned in the 2D game; carried across pages via localStorage
let gold = 0;

// SSS promotion earned in the game's gold shop (carried via localStorage)
const trainingBonus = { physical: 0, financial: 0, inspirational: 0, mental: 0 };

// Effective grade = base score + training bonus (can climb up to SSS)
function promote(metric, base) {
  return SCORE_LETTER[Math.min(7, GRADE_SCORE[base] + trainingBonus[metric])];
}

/* ============================================================
   LIFEPLUS wellness grading algorithms (PRD 2.1)
   ============================================================ */

// Physical: sleep quality + weekly exercise
function gradePhysical(sleep, exercise) {
  if (sleep <= 3) return "F"; // severe sleep deprivation
  if (sleep >= 7 && sleep <= 8 && exercise >= 3) return "A";
  if (sleep >= 6 && sleep <= 9 && exercise >= 2) return "B";
  if (sleep >= 5 && sleep <= 10 && exercise >= 1) return "C";
  if (sleep <= 4 || exercise === 0) return "D";
  return "C";
}

// Financial: monthly savings (man-won)
function gradeFinancial(savings) {
  if (savings >= 150) return "A";
  if (savings >= 80) return "B";
  if (savings >= 40) return "C";
  if (savings >= 10) return "D";
  return "F";
}

// Inspirational: weekly work hours (passion band vs burnout / inactivity)
function gradeInspirational(work) {
  if (work < 10 || work > 80) return "F"; // inactivity or burnout
  if (work >= 40 && work <= 52) return "A";
  if ((work >= 30 && work < 40) || (work > 52 && work <= 60)) return "B";
  if ((work >= 20 && work < 30) || (work > 60 && work <= 70)) return "C";
  return "D"; // 10~19 or 71~80
}

// Mental: work-life balance from sleep(+), work(-), exercise(+)
function gradeMental(sleep, work, exercise) {
  if (work > 60 && sleep < 5) return "F"; // burnout zone
  if (sleep >= 6 && work <= 45 && exercise >= 1) return "A";
  if (sleep >= 6 && work <= 50 && exercise >= 1) return "B";
  if (work > 60 || sleep < 5) return "D";
  if (sleep >= 5 && work <= 55) return "C";
  return "C";
}

/* ============================================================
   Feedback copy per metric & grade
   ============================================================ */
const COMMENTS = {
  physical: {
    A: "수면도 운동도 만점, 몸이 곧 자산!",
    B: "건강 우등생, 컨디션 양호합니다.",
    C: "나쁘진 않지만 한 끗이 아쉬워요.",
    D: "몸이 보내는 신호, 슬슬 챙길 때.",
    F: "지금은 무조건 쉬어야 할 때입니다.",
  },
  financial: {
    A: "탄탄한 저축, 든든한 미래!",
    B: "착실하게 자산이 쌓이는 중.",
    C: "모으곤 있지만 속도를 높여봐요.",
    D: "통장이 조금 아슬아슬합니다.",
    F: "재무 건전성 점검이 시급해요.",
  },
  inspirational: {
    A: "열정과 균형을 다 잡은 프로!",
    B: "성실하게 커리어를 쌓는 중.",
    C: "조금 더 몰입하면 한 단계 위로.",
    D: "일이 너무 적거나 너무 많아요.",
    F: "번아웃 또는 활동 부족 주의보.",
  },
  mental: {
    A: "워라밸의 정석, 마음도 여유롭게.",
    B: "전반적으로 안정적인 멘탈.",
    C: "한 가지가 마음을 흔들고 있어요.",
    D: "여러 신호가 겹쳐 지쳐 보여요.",
    F: "번아웃 경고, 마음 케어가 필요해요.",
  },
};

/* ============================================================
   Dynamic title from the 4 grade combination
   ============================================================ */
function buildTitle(metrics) {
  const { physical, financial, inspirational, mental } = metrics;
  const grades = [physical, financial, inspirational, mental];
  const avg = grades.reduce((sum, g) => sum + scoreOf(g), 0) / grades.length;

  // Character archetypes by notable combinations
  if (grades.every((g) => g === "F")) return "인생 리부트 권장 대상";
  if (physical === "F" && scoreOf(inspirational) >= 3) return "야근에 지친 영혼";
  if (scoreOf(physical) >= 3 && financial === "F") return "건강한 베짱이";
  if (financial === "A" && scoreOf(inspirational) <= 1) return "여유로운 자산가";
  if (mental === "F") return "번아웃 직전의 열정러";
  if (scoreOf(physical) >= 3 && scoreOf(financial) >= 3) return "갓생의 정석";

  // General tiers by average score
  if (avg >= 3.5) return "균형 잡힌 갓생 모범생";
  if (avg >= 2.5) return "성실한 보통의 삶";
  if (avg >= 1.5) return "분발이 필요한 자유인";
  return "인생 재정비 시즌";
}

/* ============================================================
   Overall comment by average grade
   ============================================================ */
function buildOverall(metrics) {
  const grades = Object.values(metrics);
  const avg = grades.reduce((sum, g) => sum + scoreOf(g), 0) / grades.length;

  if (avg >= 3.5) return "4대 웰니스가 고루 우수합니다. 지금의 균형을 유지해보세요!";
  if (avg >= 2.5) return "전반적으로 안정적이에요. 가장 낮은 지표 하나만 보완하면 완성형!";
  if (avg >= 1.5) return "지쳐 보이는 지표가 있어요. 약한 곳부터 천천히 챙겨봐요.";
  return "지금은 나를 돌볼 때입니다. 작은 습관 하나부터 다시 시작해봐요.";
}

/* ============================================================
   Render: read inputs -> compute -> paint the card
   ============================================================ */
function updateCard() {
  // Read raw values
  const raw = {
    name: els.name.value.trim() || "홍길동",
    status: els.status.value.trim() || "오늘도 갓생 산다!",
    sleep: Number(els.sleep.value),
    savings: Number(els.savings.value) || 0,
    work: Number(els.work.value),
    exercise: Number(els.exercise.value),
  };

  // Live slider labels + orange (+training) bonus indicators
  els.valueSleep.textContent = raw.sleep;
  els.valueWork.textContent = raw.work;
  els.bonusSleep.textContent = trainingBonus.physical > 0 ? `(+훈련 ${trainingBonus.physical})` : "";
  els.bonusWork.textContent = trainingBonus.inspirational > 0 ? `(+훈련 ${trainingBonus.inspirational})` : "";

  // Compute the 4 LIFEPLUS grades (with SSS promotion from game training)
  const metrics = {
    physical: promote("physical", gradePhysical(raw.sleep, raw.exercise)),
    financial: promote("financial", gradeFinancial(raw.savings)),
    inspirational: promote("inspirational", gradeInspirational(raw.work)),
    mental: promote("mental", gradeMental(raw.sleep, raw.work, raw.exercise)),
  };

  // Paint profile text
  els.reportName.textContent = raw.name;
  els.reportStatus.textContent = raw.status;
  els.reportTitle.textContent = buildTitle(metrics);

  // Paint grades, comments, per-grade colors, and (+training) badges
  ["physical", "financial", "inspirational", "mental"].forEach((key) => {
    const g = metrics[key];
    const b = trainingBonus[key];
    els.grade[key].className = "grade-mark grade-" + g.toLowerCase();
    // grade letter + dynamic (+training) badge on the right of the cell
    els.grade[key].innerHTML = b > 0 ? `${g}<span class="train-badge">+훈련 ${b}</span>` : g;
    els.comment[key].textContent = COMMENTS[key][g] || COMMENTS[key]["A"];
    els.row[key].setAttribute("data-grade", g);
  });

  // Overall comment
  els.reportOverall.textContent = buildOverall(metrics);
}

/* ============================================================
   localStorage bridge (report card <-> 2D game data sharing)
   ============================================================ */
const STORAGE_KEY = "lifeplus_save";

// Persist isolated lifeData (raw inputs) + gold + trainingBonus
function saveState() {
  const data = {
    lifeData: {
      name: els.name.value,
      status: els.status.value,
      sleep: Number(els.sleep.value),
      savings: Number(els.savings.value),
      work: Number(els.work.value),
      exercise: Number(els.exercise.value),
    },
    gold: gold,
    trainingBonus: trainingBonus,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    /* storage may be unavailable (private mode); ignore */
  }
}

// Restore isolated lifeData + gold + trainingBonus the game page may have updated
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.lifeData) {
      if (d.lifeData.name !== undefined) els.name.value = d.lifeData.name;
      if (d.lifeData.status !== undefined) els.status.value = d.lifeData.status;
      if (d.lifeData.sleep !== undefined) els.sleep.value = d.lifeData.sleep;
      if (d.lifeData.savings !== undefined) els.savings.value = d.lifeData.savings;
      if (d.lifeData.work !== undefined) els.work.value = d.lifeData.work;
      if (d.lifeData.exercise !== undefined) els.exercise.value = d.lifeData.exercise;
    }
    if (typeof d.gold === "number") gold = d.gold;
    if (d.trainingBonus) {
      for (const m of ["physical", "financial", "inspirational", "mental"]) {
        if (typeof d.trainingBonus[m] === "number") trainingBonus[m] = d.trainingBonus[m];
      }
    }
  } catch (e) {
    /* corrupted storage; ignore and use defaults */
  }
}

// Reset all progress: wipe savedWave/gold/trainingBonus and restore default inputs
function resetProgress() {
  if (!window.confirm("게임 진행(웨이브·골드·훈련 보너스)과 입력값을 모두 초기화할까요?")) return;

  gold = 0;
  ["physical", "financial", "inspirational", "mental"].forEach((m) => (trainingBonus[m] = 0));

  // Restore default report inputs
  els.name.value = "홍길동";
  els.status.value = "오늘도 갓생 산다!";
  els.sleep.value = 7;
  els.savings.value = 100;
  els.work.value = 45;
  els.exercise.value = 3;

  try {
    localStorage.removeItem(STORAGE_KEY); // clears lifeData, gold, trainingBonus
    localStorage.removeItem("savedWave"); // clears wave progress
  } catch (e) {
    /* ignore */
  }

  updateCard(); // live-restore the report card to its default state
}

// Save then jump to the 2D Survivors game
function startGame() {
  saveState();
  window.location.href = "game.html";
}

/* ============================================================
   Report-card image download (html2canvas)
   ============================================================ */
async function downloadCard() {
  if (typeof html2canvas === "undefined") {
    alert("이미지 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.");
    return;
  }
  const original = els.btnDownload.textContent;
  els.btnDownload.disabled = true;
  els.btnDownload.textContent = "이미지 생성 중...";
  try {
    const canvas = await html2canvas(els.reportCard, {
      scale: 2, // crisp, high-resolution capture
      backgroundColor: null, // keep the rounded corners transparent
      useCORS: true, // allow the uploaded profile photo to render
      logging: false,
    });
    const link = document.createElement("a");
    link.download = "life-report-card.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (e) {
    alert("이미지 저장 중 문제가 발생했습니다. 다시 시도해주세요.");
  } finally {
    els.btnDownload.disabled = false;
    els.btnDownload.textContent = original;
  }
}

/* ============================================================
   Profile photo preview (FileReader API)
   ============================================================ */
function handlePhoto(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    els.profileImg.src = e.target.result; // base64 data URI
    els.profileImg.style.display = "block";
    els.profilePlaceholder.style.display = "none";
  };
  reader.readAsDataURL(file);
}

/* ============================================================
   Publish date (today)
   ============================================================ */
function setReportDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  els.reportDate.textContent = `${y}. ${m}. ${d}`;
}

/* ============================================================
   Wire up events + first paint
   ============================================================ */
function init() {
  setReportDate();

  // Restore any data the game page saved (inputs + gold) before first paint
  loadState();

  // Re-render on any text/number/slider/select change
  [els.name, els.status, els.sleep, els.savings, els.work, els.exercise].forEach((el) => {
    el.addEventListener("input", updateCard);
    el.addEventListener("change", updateCard);
  });

  els.photo.addEventListener("change", handlePhoto);
  els.btnGame.addEventListener("click", startGame);
  els.btnDownload.addEventListener("click", downloadCard);
  els.btnReset.addEventListener("click", resetProgress);

  updateCard(); // initial paint with default values
}

document.addEventListener("DOMContentLoaded", init);
