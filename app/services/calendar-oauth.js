// Google Calendar OAuth — must run in the extension service worker (background).

const TOKEN_KEY = "google_calendar_token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

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

async function storeToken(accessToken, expiresInSec) {
  const expiresAt = expiresInSec
    ? Date.now() + Number(expiresInSec) * 1000
    : Date.now() + 3600 * 1000;
  await chrome.storage.local.set({ [TOKEN_KEY]: { accessToken, expiresAt } });
}

export async function clearCalendarToken() {
  await chrome.storage.local.remove([TOKEN_KEY, "calendar_upcoming_cache"]);
}

export async function authorizeCalendarWithClientId(clientId) {
  if (!clientId?.trim()) {
    throw new Error("Add your Google OAuth Client ID in Settings → Google Calendar first.");
  }

  const identity = chrome.identity;
  if (typeof identity?.launchWebAuthFlow !== "function") {
    throw new Error(
      "This tab is out of date. Close it, reload the extension at chrome://extensions, then open the app from the extension icon."
    );
  }

  const redirectUri = getOAuthRedirectUrl();
  if (!redirectUri) {
    throw new Error("Could not determine extension redirect URI. Reload the extension and try again.");
  }

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: clientId.trim(),
      response_type: "token",
      redirect_uri: redirectUri,
      scope: CALENDAR_SCOPE,
      prompt: "consent",
      include_granted_scopes: "true",
    }).toString();

  const responseUrl = await new Promise((resolve, reject) => {
    identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Sign-in cancelled"));
        return;
      }
      if (!response) {
        reject(new Error("Sign-in cancelled"));
        return;
      }
      resolve(response);
    });
  });

  const fragment = responseUrl.includes("#") ? responseUrl.split("#")[1] : "";
  const query = responseUrl.includes("?") ? responseUrl.split("?")[1].split("#")[0] : "";
  const params = new URLSearchParams(fragment || query);
  const token = params.get("access_token");
  const expiresIn = params.get("expires_in");
  if (!token) {
    const err = params.get("error_description") || params.get("error") || "No access token returned";
    throw new Error(err);
  }

  await storeToken(token, expiresIn);
  return token;
}

export async function getStoredCalendarToken() {
  const result = await chrome.storage.local.get([TOKEN_KEY]);
  const pack = result[TOKEN_KEY];
  if (!pack?.accessToken) return null;
  if (pack.expiresAt && Date.now() >= pack.expiresAt - 60000) return null;
  return pack.accessToken;
}
