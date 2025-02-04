// src/components/GoogleCalendarQuickstart.tsx
import React, { useEffect, useState } from "react";

// Get values from environment variables
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;
const DISCOVERY_DOC = import.meta.env
  .VITE_GOOGLE_DISCOVERY_DOC_CALENDAR as string;
// const SCOPES = [
//   "https://www.googleapis.com/auth/calendar",
//   "https://www.googleapis.com/auth/gmail.modify",
// ];
const SCOPES =
  "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify";

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

  // Load the gapi and google identity scripts once on mount.
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

    // Load google identity services script
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
      callback: "", // will be set on auth click
    });
    setTokenClient(client);
    setGisLoaded(true);
    maybeEnableButtons();
  };

  const maybeEnableButtons = () => {
    // You might choose to enable the authorize button only if both libraries are loaded.
    // (In this example, the button is always rendered; its click handler will do nothing until ready.)
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
      await fetch(`${import.meta.env.VITE_MODAL_URL}/auth/google/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: authCode }),
      });
      // This will show events if you uncomment it
      // setAuthorized(true);
      // await listUpcomingEvents();
    };

    // If no token is present, prompt for consent; otherwise, refresh silently.
    // if (!window.gapi.client.getToken()) {
    //   tokenClient.requestAccessToken({ prompt: "consent" });
    // } else {
    //   tokenClient.requestAccessToken({ prompt: "" });
    // }
    tokenClient.requestAccessToken({
      prompt: "consent",
      code_challenge_method: "S256",
    });
  };

  const handleSignoutClick = () => {
    const token = window.gapi.client.getToken();
    if (token !== null) {
      window.google.accounts.oauth2.revoke(token.access_token);
      window.gapi.client.setToken("");
      setAuthorized(false);
      setEvents([]);
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
    </div>
  );
};

export default GoogleCalendarQuickstart;
