// src/components/GoogleCalendarQuickstart.tsx
import React, { useEffect, useState } from "react";

// Get values from environment variables
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;
const DISCOVERY_DOC = import.meta.env
  .VITE_GOOGLE_DISCOVERY_DOC_CALENDAR as string;
const SCOPES = import.meta.env.VITE_GOOGLE_SCOPES as string;
// const SCOPES = [
//   "https://www.googleapis.com/auth/calendar",
//   "https://www.googleapis.com/auth/gmail.modify",
// ];
// const SCOPES =
//   "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify";

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

const GoogleCalendarQuickstart: React.FC = () => {
  const [gapiLoaded, setGapiLoaded] = useState(false);
  const [gisLoaded, setGisLoaded] = useState(false);
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [googleTokens, setGoogleTokens] = useState<{
    access_token: string;
    refresh_token: string;
    token_expiry: string;
  } | null>(null);

  // Load gapi and Google Identity Services scripts
  useEffect(() => {
    // Load gapi script
    const gapiScript = document.createElement("script");
    gapiScript.src = "https://apis.google.com/js/api.js";
    gapiScript.async = true;
    gapiScript.defer = true;
    gapiScript.onload = () => {
      window.gapi.load("client", initializeGapiClient);
    };
    document.body.appendChild(gapiScript);

    // Load Google Identity Services script
    const gisScript = document.createElement("script");
    gisScript.src = "https://accounts.google.com/gsi/client";
    gisScript.async = true;
    gisScript.defer = true;
    gisScript.onload = gisLoadedCallback;
    document.body.appendChild(gisScript);
  }, []);

  const initializeGapiClient = async () => {
    try {
      await window.gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: [DISCOVERY_DOC],
      });
      setGapiLoaded(true);
      maybeEnableButtons();
    } catch (error) {
      console.error("Error initializing GAPI client:", error);
    }
  };

  const gisLoadedCallback = () => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: "", // callback will be set on auth click
    });
    setTokenClient(client);
    setGisLoaded(true);
    maybeEnableButtons();
  };

  const maybeEnableButtons = () => {
    if (gapiLoaded && gisLoaded) {
      console.log("Both GAPI and GIS libraries are loaded");
    }
  };

  const handleAuthClick = () => {
    if (!tokenClient) {
      console.error("Token client not ready");
      return;
    }
    tokenClient.callback = async (resp: any) => {
      if (resp.error) {
        console.error("Error during token callback:", resp);
        return;
      }
      // We now receive an authorization code from the response.
      const accessToken = resp.access_token;
      try {
        // Send the code to your backend so it can exchange it for tokens.
        const tokenResponse = await fetch(
          `${import.meta.env.VITE_MODAL_URL}/auth/google/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ access_token: accessToken }),
          },
        );
        const tokens = await tokenResponse.json();
        setGoogleTokens(tokens);
        setAuthorized(true);
        await listUpcomingEvents();
      } catch (err) {
        console.error("Error exchanging code:", err);
      }
    };
    tokenClient.requestAccessToken({ prompt: "consent" });
  };

  const handleSignoutClick = () => {
    const token = window.gapi.client.getToken();
    if (token !== null) {
      window.google.accounts.oauth2.revoke(token.access_token);
      window.gapi.client.setToken("");
      setAuthorized(false);
      setEvents([]);
      setGoogleTokens(null);
    }
  };

  const listUpcomingEvents = async () => {
    try {
      const response = await window.gapi.client.calendar.events.list({
        calendarId: "primary",
        timeMin: new Date().toISOString(),
        showDeleted: false,
        singleEvents: true,
        maxResults: 10,
        orderBy: "startTime",
      });
      const events = response.result.items;
      if (events && events.length > 0) {
        setEvents(events);
      } else {
        setEvents([]);
      }
    } catch (error) {
      console.error("Error listing events:", error);
    }
  };

  return (
    <div className="p-4 border rounded shadow my-4">
      <h2 className="text-xl font-bold mb-2">Google Calendar API Quickstart</h2>
      <div className="flex gap-2 mb-4">
        {!authorized && (
          <button
            onClick={handleAuthClick}
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Authorize
          </button>
        )}
        {authorized && (
          <button
            onClick={handleSignoutClick}
            className="px-4 py-2 bg-gray-600 text-white rounded"
          >
            Sign Out
          </button>
        )}
      </div>
      <div>
        {events.length > 0 ? (
          <ul className="list-disc pl-6">
            {events.map((event, index) => (
              <li key={index}>
                <strong>{event.summary}</strong> (
                {event.start.dateTime || event.start.date})
              </li>
            ))}
          </ul>
        ) : (
          <p>No events found.</p>
        )}
      </div>
      {googleTokens && (
        <div className="mt-4 p-4 border rounded">
          <h3 className="font-bold mb-2">Token Information (for testing)</h3>
          <p>
            <strong>Access Token:</strong> {googleTokens.access_token}
          </p>
          <p>
            <strong>Refresh Token:</strong> {googleTokens.refresh_token}
          </p>
          <p>
            <strong>Token Expiry:</strong> {googleTokens.token_expiry}
          </p>
        </div>
      )}
    </div>
  );
};

export default GoogleCalendarQuickstart;
