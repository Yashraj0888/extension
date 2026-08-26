// Optional durable backup via the File System Access API.
import { showDialog } from "../ui-modal.js";
// Meetings are written as small JSON files in a user-chosen folder so they
// survive extension reinstall (local chrome.storage is wiped on uninstall).

const IDB_NAME = "amn_fs_v1";
const IDB_STORE = "handles";
const HANDLE_KEY = "backupDir";
const PREF_KEY = "backupMode"; // "folder" | "local" | unset

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function syncGet(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}
function syncSet(items) {
  return new Promise((resolve) => chrome.storage.sync.set(items, resolve));
}

export async function getBackupMode() {
  const data = await syncGet([PREF_KEY]);
  return data[PREF_KEY] || null;
}

export async function setBackupMode(mode) {
  await syncSet({ [PREF_KEY]: mode });
}

export async function hasCompletedBackupConsent() {
  const mode = await getBackupMode();
  return mode === "folder" || mode === "local";
}

export function isFolderBackupSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

async function queryPermission(handle, mode = "readwrite") {
  if (!handle) return false;
  try {
    return (await handle.queryPermission({ mode })) === "granted";
  } catch (_) {
    return false;
  }
}

/** Only call when the user explicitly reconnects folder access in Settings. */
async function requestPermissionInteractive(handle, mode = "readwrite") {
  if (!handle) return false;
  if (await queryPermission(handle, mode)) return true;
  try {
    return (await handle.requestPermission({ mode })) === "granted";
  } catch (_) {
    return false;
  }
}

export async function getBackupHandle() {
  try {
    return await idbGet(HANDLE_KEY);
  } catch (_) {
    return null;
  }
}

export async function clearBackupHandle() {
  await idbDel(HANDLE_KEY);
}

export async function hasBackupFolderAccess() {
  const mode = await getBackupMode();
  if (mode !== "folder") return false;
  const handle = await getBackupHandle();
  return queryPermission(handle, "readwrite");
}

/**
 * Returns a writable folder handle only when permission is already granted.
 * Never triggers Chrome's native "Allow this site to edit files?" dialog.
 */
async function getWritableHandleSilent() {
  const mode = await getBackupMode();
  if (mode !== "folder") return null;
  const handle = await getBackupHandle();
  if (!handle) return null;
  if (!(await queryPermission(handle, "readwrite"))) return null;
  return handle;
}

export async function pickBackupFolder() {
  if (!isFolderBackupSupported()) {
    throw new Error("Folder access is not supported in this browser.");
  }
  const proceed = await showDialog({
    title: "Link backup folder",
    body:
      "Choose a folder where AfterMeet will save small JSON copies of each meeting. " +
      "Chrome will open its folder picker next. Your meetings stay in local storage either way.",
    actions: [
      { id: "cancel", label: "Cancel", secondary: true },
      { id: "continue", label: "Choose folder", primary: true },
    ],
  });
  if (proceed !== "continue") {
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  const handle = await window.showDirectoryPicker({
    id: "amn-meeting-backup",
    mode: "readwrite",
    startIn: "documents",
  });
  if (!(await queryPermission(handle, "readwrite"))) {
    throw new Error("Permission to write the backup folder was denied.");
  }
  await idbSet(HANDLE_KEY, handle);
  await setBackupMode("folder");
  return handle;
}

export async function reconnectBackupFolder() {
  const handle = await getBackupHandle();
  if (!handle) throw new Error("No backup folder is linked yet.");

  const proceed = await showDialog({
    title: "Reconnect folder access",
    body:
      "AfterMeet needs permission to write to your linked backup folder again. " +
      "Chrome will show a system permission prompt — choose Allow to resume automatic backups.",
    actions: [
      { id: "cancel", label: "Not now", secondary: true },
      { id: "continue", label: "Reconnect", primary: true },
    ],
  });
  if (proceed !== "continue") {
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  const ok = await requestPermissionInteractive(handle, "readwrite");
  if (!ok) throw new Error("Folder access was not granted.");
  return handle;
}

function meetingFileName(meeting) {
  const id = (meeting.id || "meeting").replace(/[^\w.-]+/g, "_");
  return `${id}.json`;
}

export async function writeMeetingFile(meeting) {
  if (!meeting?.id) return false;
  const dir = await getWritableHandleSilent();
  if (!dir) return false;
  try {
    const fileHandle = await dir.getFileHandle(meetingFileName(meeting), { create: true });
    const writable = await fileHandle.createWritable();
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      meeting,
    };
    await writable.write(JSON.stringify(payload));
    await writable.close();
    return true;
  } catch (err) {
    console.warn("[AI Note-Taker] Folder backup write failed:", err);
    return false;
  }
}

export async function removeMeetingFile(meetingId) {
  if (!meetingId) return false;
  const dir = await getWritableHandleSilent();
  if (!dir) return false;
  try {
    await dir.removeEntry(`${String(meetingId).replace(/[^\w.-]+/g, "_")}.json`);
    return true;
  } catch (_) {
    return false;
  }
}

export async function restoreMeetingsFromFolder(MeetingStore) {
  const dir = await getWritableHandleSilent();
  if (!dir || !MeetingStore) return { restored: 0 };
  let restored = 0;
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".json")) continue;
    try {
      const file = await handle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      const meeting = data.meeting || data;
      if (!meeting?.id) continue;
      const existing = await MeetingStore.getMeeting(meeting.id);
      if (existing) continue;
      await MeetingStore.saveMeeting(meeting);
      restored += 1;
    } catch (err) {
      console.warn("[AI Note-Taker] Skip backup file", name, err);
    }
  }
  return { restored };
}

/** Manual restore from Settings — may show Chrome permission once, after our modal. */
export async function restoreMeetingsFromFolderInteractive(MeetingStore) {
  const handle = await getBackupHandle();
  if (!handle) throw new Error("No backup folder is linked yet.");

  const proceed = await showDialog({
    title: "Restore from backup folder",
    body:
      "Import meetings from your linked backup folder into this browser. " +
      "Existing meetings with the same ID will be skipped.",
    actions: [
      { id: "cancel", label: "Cancel", secondary: true },
      { id: "continue", label: "Restore", primary: true },
    ],
  });
  if (proceed !== "continue") {
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  if (!(await queryPermission(handle, "readwrite"))) {
    const ok = await requestPermissionInteractive(handle, "readwrite");
    if (!ok) throw new Error("Folder access was not granted.");
  }

  return restoreMeetingsFromFolder(MeetingStore);
}

export async function syncAllMeetingsToFolder(MeetingStore) {
  const dir = await getWritableHandleSilent();
  if (!dir || !MeetingStore) return { written: 0 };
  const list = await MeetingStore.listMeetings();
  let written = 0;
  for (const meta of list) {
    const meeting = await MeetingStore.getMeeting(meta.id);
    if (!meeting) continue;
    if (await writeMeetingFile(meeting)) written += 1;
  }
  return { written };
}

/** After linking a folder, sync all meetings — uses permission from the picker. */
export async function syncAllMeetingsToFolderAfterLink(MeetingStore) {
  const mode = await getBackupMode();
  if (mode !== "folder") return { written: 0 };
  const handle = await getBackupHandle();
  if (!handle || !(await queryPermission(handle, "readwrite"))) return { written: 0 };
  const list = await MeetingStore.listMeetings();
  let written = 0;
  for (const meta of list) {
    const meeting = await MeetingStore.getMeeting(meta.id);
    if (!meeting) continue;
    try {
      const fileHandle = await handle.getFileHandle(meetingFileName(meeting), { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), meeting }));
      await writable.close();
      written += 1;
    } catch (err) {
      console.warn("[AI Note-Taker] Folder backup write failed:", err);
    }
  }
  return { written };
}
