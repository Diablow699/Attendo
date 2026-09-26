// Pending enrollment command for the single central scanner.
// Two modes:
//  - fullName set, existingStudentDbId null -> CREATE a new student row
//    (the original manual "Add Student" flow)
//  - existingStudentDbId set -> UPDATE that student's fingerprint_id
//    (the new "Register" flow for students imported from Excel)
let pendingCommand = null;
const results = new Map();

// Set when a subject/schedule changes on the website, so the device picks
// up the new schedule on its next poll instead of waiting for its normal
// 15-minute automatic refresh.
let scheduleRefreshRequested = false;

export function requestScheduleRefresh() {
  scheduleRefreshRequested = true;
}

export function consumeScheduleRefreshRequest() {
  const requested = scheduleRefreshRequested;
  scheduleRefreshRequested = false;
  return requested;
}

export function queueEnrollment({ requestId, slot, subjectId, fullName, existingStudentDbId }) {
  pendingCommand = { requestId, slot, subjectId, fullName, existingStudentDbId };
  results.set(requestId, { status: "waiting" });
}

export function getPendingCommand() {
  return pendingCommand;
}

export function clearPendingCommand() {
  pendingCommand = null;
}

export function setResult(requestId, result) {
  results.set(requestId, result);
}

export function getResult(requestId) {
  return results.get(requestId);
}
