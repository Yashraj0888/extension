// Google Calendar — OAuth and API calls run in the app page (no background worker).

import { getSettings } from "./settings.js";
import { authorizeCalendarWithClientId, clearCalendarToken } from "./calendar-oauth.js";

const CACHE_KEY = "calendar_upcoming_cache";
const CACHE_TTL_MS = 5 * 60 * 1000;

function isSameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function getExtensionId() {
  try {
    return chrome.runtime?.id || "";
  } catch (_) {
    return "";
  }
}

export function getOAuthRedirectUrl() {
  try {
    const fromApi = chrome.identity?.getRedirectURL?.();
    if (fromApi) return fromApi;
  } catch (_) {}
  const id = getExtensionId();
  return id ? `https://${id}.chromiumapp.org/` : "";
}

export async function refreshOAuthInfoFromBackground() {
  return { redirectUrl: getOAuthRedirectUrl(), extensionId: getExtensionId() };
}

async function getStoredToken() {
  const result = await new Promise((r) => chrome.storage.local.get(["google_calendar_token"], r));
  const pack = result.google_calendar_token;
  if (!pack?.accessToken) return null;
  if (pack.expiresAt && Date.now() >= pack.expiresAt - 60000) return null;
  return pack.accessToken;
}

async function fetchCalendarEvents(token) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 7);

  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?" +
    new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "20",
    }).toString();

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Calendar API error (${res.status})${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
  const data = await res.json();
  return (data.items || []).map((ev) => ({
    id: ev.id,
    title: ev.summary || "Untitled event",
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    hangoutLink: ev.hangoutLink || ev.htmlLink || "",
    source: "calendar",
  }));
}

export function openGoogleCalendar() {
  chrome.tabs.create({ url: "https://calendar.google.com/calendar/u/0/r/day" });
}

export async function connectGoogleCalendar() {
  const settings = await getSettings();
  const clientId = settings.googleOAuthClientId?.trim();
  if (!clientId) {
    throw new Error("Add your Google OAuth Client ID in Settings → Google Calendar first.");
  }

  if (typeof chrome.identity?.launchWebAuthFlow !== "function") {
    throw new Error(
      "This tab is out of date. Close it, reload the extension at chrome://extensions, then open the app from the extension icon and try Connect again."
    );
  }

  await authorizeCalendarWithClientId(clientId);

  const token = await getStoredToken();
  if (!token) throw new Error("Sign-in completed but no token was saved. Try again.");

  const events = await fetchCalendarEvents(token);
  await chrome.storage.local.set({
    [CACHE_KEY]: { events, fetchedAt: Date.now(), connected: true },
  });
  return events;
}

export async function disconnectGoogleCalendar() {
  await clearCalendarToken();
}

export async function getUpcomingCalendarEvents({ refresh = false } = {}) {
  const cached = await new Promise((r) => chrome.storage.local.get([CACHE_KEY], r));
  const pack = cached[CACHE_KEY];
  if (!refresh && pack?.events && Date.now() - (pack.fetchedAt || 0) < CACHE_TTL_MS) {
    return pack.events;
  }

  const token = await getStoredToken();
  if (!token) return pack?.events || [];

  try {
    const events = await fetchCalendarEvents(token);
    await chrome.storage.local.set({
      [CACHE_KEY]: { events, fetchedAt: Date.now(), connected: true },
    });
    return events;
  } catch (_) {
    return pack?.events || [];
  }
}

export async function getTodaysCalendarEvents() {
  const events = await getUpcomingCalendarEvents();
  const today = new Date();
  return events.filter((ev) => ev.start && isSameDay(ev.start, today));
}

export async function getUpcoming24hCalendarEvents() {
  const events = await getUpcomingCalendarEvents();
  const now = Date.now();
  const in24h = now + 24 * 60 * 60 * 1000;
  return events.filter((ev) => {
    if (!ev.start) return false;
    const t = new Date(ev.start).getTime();
    return t >= now && t <= in24h;
  });
}

export async function isCalendarConnected() {
  const token = await getStoredToken();
  if (token) return true;
  const cached = await new Promise((r) => chrome.storage.local.get([CACHE_KEY], r));
  return !!cached[CACHE_KEY]?.connected;
}

export function formatEventTime(startIso) {
  if (!startIso) return "";
  try {
    const d = new Date(startIso);
    if (String(startIso).length === 10) return "All day";
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

export function minutesUntil(startIso) {
  if (!startIso) return null;
  const ms = new Date(startIso).getTime() - Date.now();
  if (ms < 0) return null;
  return Math.round(ms / 60000);
}

export default {
  openGoogleCalendar,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getUpcomingCalendarEvents,
  getTodaysCalendarEvents,
  getUpcoming24hCalendarEvents,
  isCalendarConnected,
  getOAuthRedirectUrl,
  getExtensionId,
  refreshOAuthInfoFromBackground,
  formatEventTime,
  minutesUntil,
};
