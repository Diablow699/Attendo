const API_URL = "http://localhost:4000/api";
const DEV_DEVICE_KEY = "ESP32-MAIN-01";

function authHeaders() {
  const token = localStorage.getItem("attendo_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

export function register(fullName, email, password) {
  return fetch(`${API_URL}/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, email, password }),
  }).then(handle);
}

export function login(email, password) {
  return fetch(`${API_URL}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(handle);
}

export function getSubjects() {
  return fetch(`${API_URL}/subjects`, { headers: authHeaders() }).then(handle);
}

export function createSubject(data) {
  return fetch(`${API_URL}/subjects`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  }).then(handle);
}

export function deleteSubject(id) {
  return fetch(`${API_URL}/subjects/${id}`, { method: "DELETE", headers: authHeaders() }).then(handle);
}

export function getSubjectDetail(id) {
  return fetch(`${API_URL}/subjects/${id}/detail`, { headers: authHeaders() }).then(handle);
}

export function getAllStudents() {
  return fetch(`${API_URL}/students`, { headers: authHeaders() }).then(handle);
}

export function removeStudentFromSubject(subjectId, studentId) {
  return fetch(`${API_URL}/subjects/${subjectId}/students/${studentId}`, {
    method: "DELETE", headers: authHeaders(),
  }).then(handle);
}

// Manual single-student flow (creates a brand-new student on success).
export function enrollStart(subjectId, data) {
  return fetch(`${API_URL}/subjects/${subjectId}/enroll-start`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  }).then(handle);
}

// "Register" button flow -- links a fingerprint to an already-imported student.
export function registerStart(studentId) {
  return fetch(`${API_URL}/students/${studentId}/register-start`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
  }).then(handle);
}

export function getEnrollStatus(requestId) {
  return fetch(`${API_URL}/enroll-status/${requestId}`, { headers: authHeaders() }).then(handle);
}

export function bulkImportStudents(subjectId, students) {
  return fetch(`${API_URL}/subjects/${subjectId}/students/bulk-import`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ students }),
  }).then(handle);
}

export function scanAttendance(fingerprintId) {
  return fetch(`${API_URL}/attendance/scan`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Device-Key": DEV_DEVICE_KEY },
    body: JSON.stringify({ fingerprintId }),
  }).then(handle);
}
