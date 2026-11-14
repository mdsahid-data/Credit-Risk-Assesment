// Same-origin when served by FastAPI (static mount); falls back to local server when opened as a file.
const API_URL = location.protocol === "file:" ? "http://127.0.0.1:8000/predict" : "/predict";

const $ = (s) => document.querySelector(s);
const form = $("#form");
const els = {
  arc: $("#arc"), tick: $("#tick"), pct: $("#pct"), verdict: $("#verdict"), message: $("#message"),
  stats: $("#stats"), sThreshold: $("#s-threshold"), sMargin: $("#s-margin"), sLpi: $("#s-lpi"),
  history: $("#history"), list: $("#history-list"), submit: $("#submit"), lpi: form.loan_percent_income,
};

const NUMERIC_INT = ["person_age", "cb_person_cred_hist_length"];
const NUMERIC_FLOAT = ["person_income", "person_emp_length", "loan_amnt", "loan_int_rate"];
const PRESETS = {
  safe: { person_age: 34, person_income: 92000, person_home_ownership: "MORTGAGE", person_emp_length: 9,
          loan_intent: "HOMEIMPROVEMENT", loan_grade: "A", loan_amnt: 8000, loan_int_rate: 7.4,
          cb_person_default_on_file: "N", cb_person_cred_hist_length: 12 },
  risky: { person_age: 23, person_income: 28000, person_home_ownership: "RENT", person_emp_length: 1,
           loan_intent: "DEBTCONSOLIDATION", loan_grade: "E", loan_amnt: 15000, loan_int_rate: 17.8,
           cb_person_default_on_file: "Y", cb_person_cred_hist_length: 2 },
};
const history = [];
const fmtPct = (x, d = 1) => (x * 100).toFixed(d) + "%";

function loanShare() {
  const inc = parseFloat(form.person_income.value), amt = parseFloat(form.loan_amnt.value);
  return inc > 0 && amt >= 0 ? amt / inc : null;
}
function updateShare() {
  const s = loanShare();
  els.lpi.value = s === null ? "Calculated from amount and income" : fmtPct(s);
}
form.addEventListener("input", (e) => { e.target.classList.remove("invalid"); updateShare(); });

document.querySelectorAll("[data-preset]").forEach((b) =>
  b.addEventListener("click", () => {
    const key = b.dataset.preset;
    if (key === "clear") { form.reset(); resetResult(); }
    else for (const [k, v] of Object.entries(PRESETS[key])) form.elements[k].value = v;
    form.querySelectorAll(".invalid").forEach((n) => n.classList.remove("invalid"));
    updateShare();
  })
);

function buildPayload() {
  const bad = [];
  const payload = {};
  for (const el of form.elements) {
    if (!el.name || el.name === "loan_percent_income") continue;
    const raw = el.value.trim();
    if (raw === "" || (el.type === "number" && Number.isNaN(Number(raw)))) { bad.push(el); continue; }
    if (el.type === "number" && el.min !== "" && Number(raw) < Number(el.min)) { bad.push(el); continue; }
    if (el.type === "number" && el.max !== "" && Number(raw) > Number(el.max)) { bad.push(el); continue; }
    payload[el.name] = NUMERIC_INT.includes(el.name) ? parseInt(raw, 10)
      : NUMERIC_FLOAT.includes(el.name) ? parseFloat(raw) : raw;
  }
  bad.forEach((el) => el.classList.add("invalid"));
  if (bad.length) { bad[0].focus(); return null; }
  payload.loan_percent_income = Math.round(loanShare() * 100) / 100;
  return payload;
}

function setVerdict(cls, text) {
  els.verdict.className = "verdict " + cls;
  els.verdict.textContent = text;
}
function setMessage(text, isError = false) {
  els.message.textContent = text;
  els.message.classList.toggle("error", isError);
}

function resetResult() {
  els.arc.style.strokeDasharray = "0 100";
  els.arc.setAttribute("class", "arc");
  els.tick.style.opacity = 0;
  els.pct.textContent = "\u2013";
  setVerdict("idle", "Waiting for an application");
  setMessage("Fill in the form and select Assess risk. Your result appears here.");
  els.stats.hidden = true;
}

function countUp(target) {
  const start = performance.now(), dur = 1100;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { els.pct.textContent = fmtPct(target); return; }
  (function frame(now) {
    const t = Math.min((now - start) / dur, 1), eased = 1 - Math.pow(1 - t, 3);
    els.pct.textContent = fmtPct(target * eased);
    if (t < 1) requestAnimationFrame(frame);
  })(start);
}

function render(res, payload) {
  const p = res.default_probability, t = res.threshold, high = res.default_prediction === 1;
  els.arc.setAttribute("class", "arc " + (high ? "high" : "low"));
  els.arc.style.strokeDasharray = `${Math.max(p, 0.004) * 100} 100`;
  els.tick.style.opacity = 1;
  els.tick.setAttribute("transform", `rotate(${-90 + t * 180} 110 110)`);
  countUp(p);

  setVerdict(high ? "high" : "low", high ? "High risk" : "Low risk");
  setMessage(high
    ? "The estimated chance of default is above the model's cutoff. This application would be flagged for review."
    : "The estimated chance of default is below the model's cutoff. This application looks safe to proceed.");

  const diff = p - t;
  els.sThreshold.textContent = fmtPct(t);
  els.sMargin.textContent = (diff >= 0 ? "+" : "\u2212") + (Math.abs(diff) * 100).toFixed(1) + " pts";
  els.sLpi.textContent = fmtPct(payload.loan_percent_income, 0);
  els.stats.hidden = false;

  history.unshift({ amt: payload.loan_amnt, p, high });
  history.length = Math.min(history.length, 5);
  els.list.innerHTML = history.map((h) =>
    `<li><span>$${h.amt.toLocaleString()} loan</span><b class="${h.high ? "high" : "low"}">${fmtPct(h.p)} \u00b7 ${h.high ? "High" : "Low"}</b></li>`
  ).join("");
  els.history.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = buildPayload();
  if (!payload) { setMessage("Some fields are missing or out of range. Check the highlighted fields.", true); return; }

  els.submit.disabled = true;
  els.submit.textContent = "Assessing\u2026";
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(r.status === 422 ? "The API rejected one of the values." : `The API returned status ${r.status}.`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    render(data, payload);
  } catch (err) {
    const offline = err instanceof TypeError;
    setVerdict("idle", "No result");
    setMessage(offline ? "Can't reach the API. Check that the FastAPI server is running and CORS is enabled." : err.message, true);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = "Assess risk";
  }
});
