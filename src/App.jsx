import { useState, useEffect, useRef } from "react";
import { Fingerprint, Plus, X, Check, Clock, Users, ChevronRight, LogOut, Calendar, AlertCircle, Trash2, Upload, FileSpreadsheet, Download} from "lucide-react";
import * as XLSX from "xlsx";
import * as api from "./api.js";

const C = {
  ink: "#161A22",
  ink2: "#232936",
  paper: "#F6F7F9",
  steel: "#8C93A3",
  steelLight: "#C7CCD6",
  teal: "#12A594",
  tealDark: "#0C7A6D",
  tealPale: "#E4F5F2",
  amber: "#E3A008",
  amberPale: "#FBF0D9",
  coral: "#E15554",
  coralPale: "#FBE5E4",
  line: "#E2E5EA",
};

const FONTS_LINK = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function RidgeMark({ size = 22, color = C.teal }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <path d="M20 6 C11 6 5 13 5 22 C5 27 7 31 10 34" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.35"/>
      <path d="M20 10 C13.5 10 9 15.5 9 22 C9 26 10.6 29 13 31.5" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.55"/>
      <path d="M20 14 C16 14 13 17.5 13 22 C13 25 14.3 27 16 28.8" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.8"/>
      <path d="M20 18 C18.5 18 17 19.5 17 22 C17 23.5 17.7 24.6 18.5 25.5" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function RidgeField() {
  const N = 9;
  const duration = 4.5; // total time for one full out-and-back cycle
  const arcs = [];
  for (let i = 0; i < N; i++) {
    const r = 20 + i * 14;
    const delay = (i / N) * (duration / 2); // stagger the wave outward
    arcs.push(
      <circle
        key={i}
        cx="0"
        cy="0"
        r={r}
        fill="none"
        stroke={C.teal}
        strokeWidth="2"
        style={{
          opacity: 0.05,
          animation: `ridgeGlow ${duration}s ease-in-out ${delay}s infinite alternate`,
        }}
      />
    );
  }
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 50%, ${C.teal}1F 0%, ${C.teal}0D 45%, ${C.teal}05 100%)`,
          animation: `bgGlow ${duration}s ease-in-out infinite alternate`,
        }}
      />
      <svg width="100%" height="100%" viewBox="-260 -260 520 520" style={{ position: "absolute", inset: 0 }} preserveAspectRatio="xMidYMid slice">
        <g transform="scale(1,0.86) rotate(6)">{arcs}</g>
        <style>{`
          @keyframes ridgeGlow {
            0% { opacity: 0.05; stroke: #FFFFFF; stroke-width: 2; }
            100% { opacity: 0.55; stroke: ${C.teal}; stroke-width: 2.5; }
          }
          @keyframes bgGlow {
            0% { opacity: 0.4; }
            100% { opacity: 1; }
          }
        `}</style>
      </svg>
    </>
  );
}

function ScanTarget({ state, onScan, size = 128 }) {
  const ringColor = state === "success" ? C.teal : state === "scanning" ? C.amber : C.steelLight;
  return (
    <button
      onClick={onScan}
      disabled={state !== "idle"}
      style={{
        width: size, height: size, borderRadius: "50%",
        border: `2px solid ${ringColor}`,
        background: state === "success" ? C.tealPale : "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: state === "idle" ? "pointer" : "default",
        position: "relative", flexShrink: 0,
      }}
    >
      {state === "scanning" && (
        <>
          <span style={pulseRing()} />
          <span style={{ ...pulseRing(), animationDelay: "0.5s" }} />
        </>
      )}
      {state === "success" ? (
        <Check size={44} color={C.teal} strokeWidth={2.5} />
      ) : (
        <Fingerprint size={44} color={state === "scanning" ? C.amber : C.steel} strokeWidth={1.6} />
      )}
    </button>
  );
}

function pulseRing() {
  return {
    position: "absolute", inset: 0, borderRadius: "50%",
    border: `2px solid ${C.amber}`, opacity: 0,
    animation: "pulseRing 1.6s ease-out infinite",
  };
}

function Badge({ children, tone = "steel" }) {
  const map = {
    steel: [C.paper, C.steel],
    teal: [C.tealPale, C.tealDark],
    amber: [C.amberPale, "#8A5D06"],
    coral: [C.coralPale, "#A33A39"],
  };
  const [bg, fg] = map[tone];
  return (
    <span style={{ background: bg, color: fg, fontSize: 12, fontWeight: 500, padding: "3px 9px", borderRadius: 100, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {children}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 500, color: C.steel, marginBottom: 6, fontFamily: "'IBM Plex Sans', sans-serif" }}>{label}</div>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14.5,
  border: `1px solid ${C.line}`, borderRadius: 8, fontFamily: "'IBM Plex Sans', sans-serif",
  outline: "none", background: "#fff", color: C.ink,
};

function PrimaryBtn({ children, onClick, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? C.steelLight : C.ink, color: "#fff", border: "none",
      borderRadius: 8, padding: "11px 18px", fontSize: 14, fontWeight: 500,
      cursor: disabled ? "default" : "pointer", fontFamily: "'IBM Plex Sans', sans-serif",
      display: "inline-flex", alignItems: "center", gap: 8, ...style,
    }}>{children}</button>
  );
}

function GhostBtn({ children, onClick, style }) {
  return (
    <button onClick={onClick} style={{
      background: "transparent", color: C.ink, border: `1px solid ${C.line}`,
      borderRadius: 8, padding: "11px 18px", fontSize: 14, fontWeight: 500,
      cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif",
      display: "inline-flex", alignItems: "center", gap: 8, ...style,
    }}>{children}</button>
  );
}

function ErrorNote({ message }) {
  if (!message) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: C.coralPale, color: "#8A2E2D", padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
      <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {message}
    </div>
  );
}

function StatusPill({ status }) {
  if (status === "present") return <Badge tone="teal">Present</Badge>;
  if (status === "late") return <Badge tone="amber">Late</Badge>;
  return <Badge tone="steel">No record</Badge>;
}
function AttendanceProgress({ attended, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((attended / total) * 100)) : 0;
  const color = pct >= 75 ? C.teal : pct >= 50 ? C.amber : C.coral;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: C.line, borderRadius: 100, overflow: "hidden", minWidth: 40 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 100 }} />
      </div>
      <span style={{ fontSize: 11.5, color: C.steel, fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>
        {attended}/{total}
      </span>
    </div>
  );
}
function formatTime(isoString) {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function timeToMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isLogin = mode === "login";

  async function submit() {
    setError("");
    if (!email || !password || (!isLogin && !fullName)) {
      setError("Please fill in all fields.");
      return;
    }
    setLoading(true);
    try {
      const data = isLogin ? await api.login(email, password) : await api.register(fullName, email, password);
      localStorage.setItem("attendo_token", data.token);
      onAuthed(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans', sans-serif", position: "relative", overflow: "hidden", padding: 20 }}>
      <RidgeField />
      <div style={{ background: "#fff", borderRadius: 16, width: 380, maxWidth: "100%", padding: "36px 32px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <RidgeMark />
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em" }}>Attendo</span>
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 600, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
          {isLogin ? "Log in" : "Create account"}
        </h1>
        <p style={{ color: C.steel, fontSize: 14, margin: "0 0 26px" }}>
          {isLogin ? "Access your attendance dashboard." : "Set up an account to manage subjects and rosters."}
        </p>
        {!isLogin && (
          <Field label="Full name">
            <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Maria Santos" />
          </Field>
        )}
        <Field label="Email">
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@school.edu" />
        </Field>
        <Field label="Password">
          <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        <ErrorNote message={error} />
        <PrimaryBtn onClick={submit} disabled={loading} style={{ width: "100%", justifyContent: "center", marginTop: 6, padding: "12px 18px" }}>
          {loading ? "Please wait…" : isLogin ? "Log in" : "Create account"}
        </PrimaryBtn>
        <p style={{ textAlign: "center", fontSize: 13.5, color: C.steel, marginTop: 20 }}>
          {isLogin ? "No account yet? " : "Already have an account? "}
          <span onClick={() => { setMode(isLogin ? "register" : "login"); setError(""); }} style={{ color: C.teal, fontWeight: 500, cursor: "pointer" }}>
            {isLogin ? "Register" : "Log in"}
          </span>
        </p>
      </div>
      <style>{`@keyframes pulseRing{0%{transform:scale(0.85);opacity:0.5}100%{transform:scale(1.5);opacity:0}}`}</style>
    </div>
  );
}

function AddSubjectModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [days, setDays] = useState([]);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("09:00");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function toggleDay(d) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function submit() {
    setError("");
    if (!name.trim()) return setError("Enter a subject name.");
    if (!section.trim()) return setError("Enter a section.");
    if (days.length === 0) return setError("Select at least one day.");
    if (timeToMin(end) <= timeToMin(start)) return setError("End time must be after start time.");
    setLoading(true);
    try {
      const created = await api.createSubject({ name: name.trim(), section: section.trim(), days, start, end });
      onCreated(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 24 }}>
        <ModalHeader title="Add subject" onClose={onClose} />
        <Field label="Subject name"><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Math 101" /></Field>
        <Field label="Section"><input style={inputStyle} value={section} onChange={(e) => setSection(e.target.value)} placeholder="BSIT-3A" /></Field>
        <Field label="Meeting days">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DAYS.slice(1).concat(DAYS[0]).map((d) => (
              <span key={d} onClick={() => toggleDay(d)} style={{
                padding: "7px 12px", borderRadius: 7, fontSize: 13, cursor: "pointer",
                border: `1px solid ${days.includes(d) ? C.teal : C.line}`,
                background: days.includes(d) ? C.tealPale : "#fff",
                color: days.includes(d) ? C.tealDark : C.ink, fontWeight: 500,
              }}>{d}</span>
            ))}
          </div>
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><Field label="Start time"><input type="time" style={inputStyle} value={start} onChange={(e) => setStart(e.target.value)} /></Field></div>
          <div style={{ flex: 1 }}><Field label="End time"><input type="time" style={inputStyle} value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
        </div>
        <ErrorNote message={error} />
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <PrimaryBtn onClick={submit} disabled={loading}>{loading ? "Saving…" : "Add subject"}</PrimaryBtn>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        </div>
      </div>
    </Overlay>
  );
}

// Reusable scan-and-wait UI, used by both the manual add flow and the
// Register-button flow. `onStart` kicks off enrollment (different endpoint
// depending on caller); everything else about the waiting/success UI is shared.
function ScanFlow({ title, subtitle, onStart, onDone, onClose }) {
  const [phase, setPhase] = useState("idle"); // idle | waiting | success | failed
  const [requestId, setRequestId] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (phase !== "waiting" || !requestId) return;
    let cancelled = false;
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;
      try {
        const status = await api.getEnrollStatus(requestId);
        if (cancelled) return;
        if (status.status === "success") {
          setResult(status.student);
          setPhase("success");
          clearInterval(interval);
          setTimeout(() => onDone(status.student), 800);
        } else if (status.status === "failed") {
          setError("The scanner reported the enrollment failed. Try again.");
          setPhase("failed");
          clearInterval(interval);
        } else if (attempts > 30) {
          setError("No response from the scanner. Make sure the ESP32 is powered on and connected.");
          setPhase("failed");
          clearInterval(interval);
        }
      } catch (e) {
        if (!cancelled) { setError(e.message); setPhase("failed"); clearInterval(interval); }
      }
    }, 1000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [phase, requestId]);

  async function start() {
    setError("");
    try {
      const res = await onStart();
      setRequestId(res.requestId);
      setPhase("waiting");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <ModalHeader title={title} onClose={onClose} />
      {subtitle}
      <div style={{ background: C.paper, borderRadius: 12, padding: "24px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginTop: 8, marginBottom: 20 }}>
        <ScanTarget state={phase === "success" ? "success" : phase === "waiting" ? "scanning" : "idle"} onScan={start} />
        <div style={{ textAlign: "center" }}>
          {phase === "idle" && <p style={{ fontSize: 13.5, color: C.ink, margin: 0, fontWeight: 500 }}>Tap to send this to the scanner</p>}
          {phase === "waiting" && <p style={{ fontSize: 13.5, color: "#8A5D06", margin: 0, fontWeight: 500 }}>Waiting for a finger on the scanner…</p>}
          {phase === "success" && (
            <div>
              <p style={{ fontSize: 13.5, color: C.tealDark, margin: "0 0 6px", fontWeight: 500 }}>Student saved</p>
              {result && (
                <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, background: "#fff", border: `1px solid ${C.line}`, padding: "4px 10px", borderRadius: 6 }}>ID {result.studentId}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, background: "#fff", border: `1px solid ${C.line}`, padding: "4px 10px", borderRadius: 6 }}>Slot #{result.fingerprintId}</span>
                </div>
              )}
            </div>
          )}
          {phase === "failed" && <p style={{ fontSize: 13.5, color: "#A33A39", margin: 0, fontWeight: 500 }}>Enrollment didn't complete.</p>}
        </div>
      </div>
      <ErrorNote message={error} />
      <div style={{ display: "flex", gap: 10 }}>
        {phase === "failed" && <PrimaryBtn onClick={() => { setPhase("idle"); setError(""); }}>Try again</PrimaryBtn>}
        <GhostBtn onClick={onClose}>{phase === "waiting" ? "Cancel" : "Close"}</GhostBtn>
      </div>
    </div>
  );
}

// "Add student" modal: Manual entry, or bulk Import Excel.
function AddStudentPanel({ subjectId, onClose, onAdded }) {
  const [mode, setMode] = useState("manual"); // manual | import
  const [fullName, setFullName] = useState("");
  const [showScan, setShowScan] = useState(false);

  const [file, setFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  function handleFile(e) {
    const f = e.target.files?.[0];
    setFile(f || null);
    setParseError("");
    setParsedRows([]);
    setImportResult(null);
    if (!f) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = XLSX.read(evt.target.result, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (!rows.length) { setParseError("The file has no rows."); return; }

        const keys = Object.keys(rows[0]);
        const nameKey = keys.find((k) => /name/i.test(k));
        const idKey = keys.find((k) => /id/i.test(k));
        if (!nameKey || !idKey) {
          setParseError('Could not find a "Name" and "Student ID" column. Check your headers.');
          return;
        }

        const mapped = rows
          .map((r) => ({ fullName: String(r[nameKey] || "").trim(), studentId: String(r[idKey] || "").trim() }))
          .filter((r) => r.fullName && r.studentId);

        if (!mapped.length) { setParseError("No valid rows found (need both a name and a student ID)."); return; }
        setParsedRows(mapped);
      } catch (err) {
        setParseError("Couldn't read that file. Make sure it's a valid .xlsx or .xls file.");
      }
    };
    reader.readAsArrayBuffer(f);
  }

  async function doImport() {
    setImporting(true);
    try {
      const res = await api.bulkImportStudents(subjectId, parsedRows);
      setImportResult(res);
    } catch (e) {
      setParseError(e.message);
    } finally {
      setImporting(false);
    }
  }

  if (showScan) {
    return (
      <Overlay onClose={onClose}>
        <ScanFlow
          title="Add student"
          subtitle={<Field label="Full name"><div style={{ ...inputStyle, background: C.paper, color: C.steel }}>{fullName}</div></Field>}
          onStart={() => api.enrollStart(subjectId, { fullName: fullName.trim() })}
          onDone={() => onAdded()}
          onClose={onClose}
        />
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: 24 }}>
        <ModalHeader title="Add student" onClose={onClose} />

        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          <span onClick={() => setMode("manual")} style={{
            flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: "pointer",
            background: mode === "manual" ? C.ink : C.paper, color: mode === "manual" ? "#fff" : C.steel,
          }}>Manual</span>
          <span onClick={() => setMode("import")} style={{
            flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: "pointer",
            background: mode === "import" ? C.ink : C.paper, color: mode === "import" ? "#fff" : C.steel,
          }}>Import Excel</span>
        </div>

        {mode === "manual" && (
          <>
            <Field label="Full name"><input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Juan Dela Cruz" /></Field>
            <PrimaryBtn onClick={() => setShowScan(true)} disabled={!fullName.trim()} style={{ width: "100%", justifyContent: "center" }}>
              Continue to scan
            </PrimaryBtn>
          </>
        )}

        {mode === "import" && !importResult && (
          <>
            <p style={{ fontSize: 13, color: C.steel, marginTop: 0, marginBottom: 14 }}>
              Upload a spreadsheet with a <strong>Name</strong> column and a <strong>Student ID</strong> column. Students are added to the roster right away, unregistered — each one gets a "Register" button to scan their fingerprint afterward.
            </p>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{ border: `1.5px dashed ${C.line}`, borderRadius: 10, padding: "28px 16px", textAlign: "center", cursor: "pointer", marginBottom: 16 }}
            >
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
              <Upload size={22} color={C.steel} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 13.5, fontWeight: 500, color: C.ink }}>{file ? file.name : "Click to choose a file"}</div>
              <div style={{ fontSize: 12, color: C.steel, marginTop: 2 }}>.xlsx or .xls</div>
            </div>

            <ErrorNote message={parseError} />

            {parsedRows.length > 0 && (
              <div style={{ background: C.paper, borderRadius: 10, padding: "12px 14px", marginBottom: 16, maxHeight: 160, overflowY: "auto" }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.steel, marginBottom: 8 }}>
                  <FileSpreadsheet size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                  {parsedRows.length} student{parsedRows.length !== 1 ? "s" : ""} found
                </div>
                {parsedRows.slice(0, 6).map((r, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: C.ink, padding: "3px 0" }}>{r.fullName} — {r.studentId}</div>
                ))}
                {parsedRows.length > 6 && <div style={{ fontSize: 12, color: C.steel }}>+{parsedRows.length - 6} more…</div>}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <PrimaryBtn onClick={doImport} disabled={!parsedRows.length || importing}>
                {importing ? "Importing…" : `Import ${parsedRows.length || ""} student${parsedRows.length === 1 ? "" : "s"}`}
              </PrimaryBtn>
              <GhostBtn onClick={onClose}>Cancel</GhostBtn>
            </div>
          </>
        )}

        {mode === "import" && importResult && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", background: C.tealPale, color: C.tealDark, padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
              <Check size={16} /> {importResult.created.length} student{importResult.created.length !== 1 ? "s" : ""} added to the roster.
            </div>
            {importResult.failed.length > 0 && (
              <div style={{ background: C.coralPale, color: "#8A2E2D", padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
                {importResult.failed.length} row{importResult.failed.length !== 1 ? "s" : ""} skipped:
                {importResult.failed.slice(0, 4).map((f, i) => (
                  <div key={i} style={{ marginTop: 4 }}>• {f.row.fullName || "(no name)"} — {f.reason}</div>
                ))}
              </div>
            )}
            <p style={{ fontSize: 13, color: C.steel, marginBottom: 16 }}>
              You'll see them on the roster with a <strong>Register</strong> button to scan each fingerprint whenever you're ready.
            </p>
            <PrimaryBtn onClick={() => onAdded()} style={{ width: "100%", justifyContent: "center" }}>Done</PrimaryBtn>
          </>
        )}
      </div>
    </Overlay>
  );
}

// Popped from the roster's "Register" button on an already-imported,
// unregistered student. Skips straight to scanning -- name is already known.
function RegisterPanel({ student, onClose, onDone }) {
  return (
    <Overlay onClose={onClose}>
      <ScanFlow
        title="Register fingerprint"
        subtitle={<Field label="Student"><div style={{ ...inputStyle, background: C.paper, color: C.steel }}>{student.fullName} — {student.studentId}</div></Field>}
        onStart={() => api.registerStart(student.id)}
        onDone={onDone}
        onClose={onClose}
      />
    </Overlay>
  );
}

function ModalHeader({ title, onClose }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
      <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h2>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.steel, padding: 4 }}><X size={20} /></button>
    </div>
  );
}

function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(22,26,34,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 420, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", fontFamily: "'IBM Plex Sans', sans-serif" }}>
        {children}
      </div>
    </div>
  );
}

function Header({ onLogout, subtitle }) {
  return (
    <div style={{ background: C.ink, color: "#fff", padding: "18px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <RidgeMark size={20} color={C.teal} />
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 16, letterSpacing: "-0.01em" }}>Attendo</div>
          {subtitle && <div style={{ fontSize: 12, color: C.steelLight }}>{subtitle}</div>}
        </div>
      </div>
      <button onClick={onLogout} style={{ background: "transparent", border: `1px solid ${C.ink2}`, color: C.steelLight, borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
        <LogOut size={14} /> Log out
      </button>
    </div>
  );
}

function SessionBanner({ subjects }) {
  const now = new Date();
  const day = DAYS[now.getDay()];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const active = subjects.find((s) => s.days.includes(day) && s.start && nowMin >= timeToMin(s.start) && nowMin <= timeToMin(s.end));
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 10,
      background: active ? C.tealPale : C.paper, border: `1px solid ${active ? "#BEE6DF" : C.line}`, marginBottom: 22,
    }}>
      <Clock size={16} color={active ? C.tealDark : C.steel} />
      <span style={{ fontSize: 13.5, color: active ? C.tealDark : C.steel, fontWeight: 500 }}>
        {active ? `Now in session — ${active.name} (${active.start}–${active.end})` : "No class currently in session on the scanner"}
      </span>
    </div>
  );
}

function ScanSimulator({ onRecorded }) {
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState("");
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => { api.getAllStudents().then(setStudents).catch(() => {}); }, []);

  async function simulateScan() {
    if (!selected) return;
    setScanning(true);
    setMessage(null);
    try {
      const result = await api.scanAttendance(Number(selected));
      setMessage({
        tone: result.status === "late" ? "amber" : "teal",
        text: `${result.student.fullName} — ${result.status === "late" ? "Late" : "Present"} — ${result.subject.name} — ${formatTime(result.scannedAt)}`,
      });
      onRecorded?.();
    } catch (e) {
      setMessage({ tone: "coral", text: e.message });
    } finally {
      setScanning(false);
    }
  }

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Fingerprint size={18} color={C.teal} />
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 15 }}>Scanner (simulated)</span>
        <span style={{ fontSize: 12, color: C.steel }}>— stands in for the ESP32 until it's connected</span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 220 }}>
          <option value="">Select a student to scan…</option>
          {students.map((s) => <option key={s.id} value={s.fingerprintId}>{s.fullName} — {s.studentId}</option>)}
        </select>
        <PrimaryBtn onClick={simulateScan} disabled={!selected || scanning}>{scanning ? "Scanning…" : "Simulate scan"}</PrimaryBtn>
      </div>
      {message && <div style={{ marginTop: 12 }}><Badge tone={message.tone}>{message.text}</Badge></div>}
    </div>
  );
}

function SubjectCard({ subject, onOpen, onDelete }) {
  return (
    <div onClick={onOpen} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "18px 18px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: C.steel, padding: 4 }}
        aria-label="Delete subject"
      >
        <Trash2 size={15} />
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: C.tealPale, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <RidgeMark size={18} />
        </div>
      </div>
      <div>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 16.5, marginBottom: 2 }}>{subject.name}</div>
        <div style={{ fontSize: 12.5, color: C.tealDark, fontWeight: 500, marginBottom: 4 }}>{subject.section}</div>
        <div style={{ fontSize: 12.5, color: C.steel }}>{subject.days.join(" · ")} &nbsp;·&nbsp; {subject.start}–{subject.end}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.steel, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
        <Users size={13} /> {subject.studentCount} enrolled
      </div>
    </div>
  );
}

function Dashboard({ onOpenSubject, onLogout }) {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);

  async function load() {
    setLoading(true);
    try { setSubjects(await api.getSubjects()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function handleDeleteSubject(subject) {
    if (window.confirm(`Delete "${subject.name}"? This removes its schedule, roster, and attendance history.`)) {
      api.deleteSubject(subject.id).then(load).catch((e) => alert(e.message));
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <Header onLogout={onLogout} />
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "32px 24px" }}>
        <SessionBanner subjects={subjects} />
        <ScanSimulator onRecorded={load} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 21, fontWeight: 600, margin: 0 }}>Subjects</h1>
          <PrimaryBtn onClick={() => setShowModal(true)}><Plus size={16} /> Add subject</PrimaryBtn>
        </div>

        {loading && <p style={{ color: C.steel, fontSize: 14 }}>Loading subjects…</p>}
        {error && <ErrorNote message={error} />}

        {!loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
            {subjects.map((s) => (
              <SubjectCard key={s.id} subject={s} onOpen={() => onOpenSubject(s.id)} onDelete={() => handleDeleteSubject(s)} />
            ))}
          </div>
        )}
        {!loading && subjects.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.steel }}>
            <p style={{ fontSize: 14 }}>No subjects yet. Add one to start building a roster.</p>
          </div>
        )}
      </div>
      {showModal && <AddSubjectModal onClose={() => setShowModal(false)} onCreated={() => { setShowModal(false); load(); }} />}
    </div>
  );
}

function SubjectDetail({ subjectId, onBack, onLogout }) {
  const [subject, setSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  const [registerTarget, setRegisterTarget] = useState(null); // the student row being registered

  async function load() {
    setLoading(true);
    try { setSubject(await api.getSubjectDetail(subjectId)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [subjectId]);

  function handleRemoveStudent(student) {
    if (window.confirm(`Remove ${student.fullName} from this subject?`)) {
      api.removeStudentFromSubject(subjectId, student.id).then(load).catch((e) => alert(e.message));
    }
  }
  function downloadRecords() {
  const rows = subject.students.map((st) => ({
    Name: st.fullName,
    "Student ID": st.studentId,
    "Sessions Attended": `${st.sessionsAttended}/${subject.totalSessions}`,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Attendance");
  XLSX.writeFile(wb, `${subject.name.replace(/\s+/g, "_")}_attendance.xlsx`);
}

  if (loading) return <div style={{ padding: 40, fontFamily: "'IBM Plex Sans', sans-serif", color: C.steel }}>Loading…</div>;
  if (error || !subject) return <div style={{ padding: 40, fontFamily: "'IBM Plex Sans', sans-serif" }}><ErrorNote message={error || "Subject not found"} /></div>;

  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <Header onLogout={onLogout} subtitle={subject.name} />
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "32px 24px" }}>
        <span onClick={onBack} style={{ fontSize: 13, color: C.steel, cursor: "pointer", display: "inline-block", marginBottom: 14 }}>← All subjects</span>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 600, margin: "0 0 4px" }}>{subject.name}</h1>
            <div style={{ fontSize: 13.5, color: C.tealDark, fontWeight: 500, marginBottom: 6 }}>{subject.section}</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: C.steel }}>
              <Calendar size={14} /> {subject.days.join(" · ")} &nbsp;·&nbsp; {subject.start}–{subject.end}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
  <GhostBtn onClick={downloadRecords}><Download size={16} /> Download records</GhostBtn>
  <PrimaryBtn onClick={() => setShowPanel(true)}><Plus size={16} /> Add student</PrimaryBtn>
</div>
        </div>
        <style>{`
  .roster-wrap { overflow-x: auto; }
  .roster-header, .roster-row {
    display: grid;
    grid-template-columns: 1fr 120px 110px 130px 90px 90px 40px;
    align-items: center;
    min-width: 620px;
  }
  .roster-header { padding: 12px 18px; font-size: 12px; font-weight: 500; color: ${C.steel}; border-bottom: 1px solid ${C.line}; }
  .roster-row { padding: 14px 18px; font-size: 14px; border-bottom: 1px solid ${C.line}; }
  .cell-label { display: none; }

  @media (max-width: 700px) {
    .roster-wrap { overflow-x: visible; }
    .roster-header { display: none; }
    .roster-header, .roster-row { min-width: 0; }
    .roster-row {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: stretch;
      padding: 16px 18px;
    }
    .roster-row .cell {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cell-label {
      display: inline;
      font-size: 11px;
      font-weight: 500;
      color: ${C.steel};
    }
    .cell-name { font-size: 15.5px; font-weight: 600; }
    .cell-delete { justify-content: flex-end; }
  }
`}</style>
       <div className="roster-wrap" style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
  <div className="roster-header">
    <span>Name</span><span>Student ID</span><span>Fingerprint</span><span>Attendance</span><span>Today</span><span>Time</span><span></span>
  </div>
  {subject.students.map((st) => (
    <div key={st.id} className="roster-row">
      <span className="cell cell-name">{st.fullName}</span>

      <span className="cell" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}>
        <span className="cell-label">Student ID</span>{st.studentId}
      </span>

      <span className="cell">
        <span className="cell-label">Fingerprint</span>
        {st.fingerprintId === null ? (
          <span
            onClick={() => setRegisterTarget(st)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 500, color: C.tealDark, background: C.tealPale, padding: "4px 9px", borderRadius: 100, cursor: "pointer" }}
          >
            <Fingerprint size={12} /> Register
          </span>
        ) : (
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: C.steel }}>Slot #{st.fingerprintId}</span>
        )}
      </span>

      <span className="cell">
        <span className="cell-label">Attendance</span>
        <AttendanceProgress attended={st.sessionsAttended} total={subject.totalSessions} />
      </span>

      <span className="cell">
        <span className="cell-label">Today</span>
        {st.fingerprintId !== null ? <StatusPill status={st.todayStatus} /> : <Badge tone="steel">—</Badge>}
      </span>

      <span className="cell">
        <span className="cell-label">Time</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: C.steel }}>
          {st.fingerprintId !== null ? formatTime(st.todayScannedAt) : "—"}
        </span>
      </span>

      <span className="cell cell-delete">
        <button
          onClick={() => handleRemoveStudent(st)}
          style={{ background: "none", border: "none", cursor: "pointer", color: C.steel, padding: 4 }}
          aria-label="Remove student"
        >
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  ))}
  {subject.students.length === 0 && (
    <div style={{ padding: "40px 18px", textAlign: "center", color: C.steel, fontSize: 14 }}>No students enrolled yet.</div>
  )}
</div>
      </div>
      {showPanel && (
        <AddStudentPanel subjectId={subject.id} onClose={() => setShowPanel(false)} onAdded={() => { setShowPanel(false); load(); }} />
      )}
      {registerTarget && (
        <RegisterPanel
          student={registerTarget}
          onClose={() => setRegisterTarget(null)}
          onDone={() => { setRegisterTarget(null); load(); }}
        />
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("dashboard");
  const [activeId, setActiveId] = useState(null);
  const [checkedAuth, setCheckedAuth] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("attendo_token");
    if (token) setUser({ restored: true });
    setCheckedAuth(true);
  }, []);

  function logout() {
    localStorage.removeItem("attendo_token");
    setUser(null);
    setView("dashboard");
    setActiveId(null);
  }

  if (!checkedAuth) return null;

  if (!user) {
    return (
      <>
        <link rel="stylesheet" href={FONTS_LINK} />
        <AuthScreen onAuthed={setUser} />
      </>
    );
  }

  return (
    <>
      <link rel="stylesheet" href={FONTS_LINK} />
      {view === "subject" && activeId ? (
        <SubjectDetail subjectId={activeId} onBack={() => setView("dashboard")} onLogout={logout} />
      ) : (
        <Dashboard onOpenSubject={(id) => { setActiveId(id); setView("subject"); }} onLogout={logout} />
      )}
    </>
  );
}
