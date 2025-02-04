import sqlite3
from typing_extensions import Union

from modal import asgi_app

from .common import DB_PATH, VOLUME_DIR, app, fastapi_app, volume
from .agent import process_agent_message

import os
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from datetime import datetime

class TokenData(BaseModel):
    access_token: str

class AgentRequest(BaseModel):
    message: str

class AgentResponse(BaseModel):
    response: str

@app.function(
    volumes={VOLUME_DIR: volume},
)
def init_db():
    """Initialize the SQLite database with a simple table."""
    volume.reload()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create a simple table
    cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS google_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                token_expiry TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_threads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
    conn.commit()
    conn.close()
    volume.commit()


@app.function(
    volumes={VOLUME_DIR: volume},
)
@asgi_app()
def fastapi_entrypoint():
    # Initialize database on startup
    init_db.remote()
    return fastapi_app

@fastapi_app.post("/agent/chat", response_model=AgentResponse)
async def agent_chat(request: AgentRequest):
    try:
        result = process_agent_message(request.message)
        return {"response": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@fastapi_app.post("/auth/google/token")
def receive_token(token_data: TokenData):
    try:
        # Create credentials using the provided access token.
        creds = Credentials(
                    token_data.access_token,
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=os.environ["GOOGLE_CLIENT_ID"],
                    client_secret=os.environ["GOOGLE_CLIENT_SECRET"]
                )
        # Build the Google Calendar service client.
        service = build("calendar", "v3", credentials=creds)
        # For testing, get a single upcoming event.
        now = datetime.utcnow().isoformat() + "Z"
        events_result = service.events().list(
            calendarId="primary",
            timeMin=now,
            maxResults=1,
            singleEvents=True,
            orderBy="startTime"
        ).execute()
        events = events_result.get("items", [])

        # Extract additional token details if available.
        refresh_token = creds.refresh_token if creds.refresh_token else ""
        token_expiry = creds.expiry.isoformat() if creds.expiry else ""
        # For simplicity, remove any previously stored token and insert the new one.
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM google_tokens")
        cursor.execute(
            "INSERT INTO google_tokens (access_token, refresh_token, token_expiry) VALUES (?, ?, ?)",
            (token_data.access_token, refresh_token, token_expiry)
        )
        conn.commit()
        conn.close()
        volume.commit()


        # Return the token info along with the test events.
        return {
            "access_token": token_data.access_token,
            "refresh_token": refresh_token,
            "token_expiry": token_expiry,
            "test_events": events
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@fastapi_app.get("/")
def read_root():
    return {"message": "Hello World"}
