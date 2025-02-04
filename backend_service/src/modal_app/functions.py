# src/modal_app/functions.py
import os
import sqlite3
import datetime
import base64
from email.mime.text import MIMEText
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from .common import DB_PATH

def get_google_credentials() -> Credentials:
    """
    Retrieve the stored Google tokens from SQLite and return a Credentials object.
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT access_token, refresh_token, token_expiry FROM google_tokens ORDER BY updated_at DESC LIMIT 1"
    )
    row = cursor.fetchone()
    conn.close()
    if row:
        access_token, refresh_token, token_expiry = row
        return Credentials(
            access_token,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.getenv("GOOGLE_CLIENT_ID"),
            client_secret=os.getenv("GOOGLE_CLIENT_SECRET")
        )
    else:
        raise Exception("No stored Google credentials found.")

def schedule_meeting(
    meeting_title: str,
    start_time: str,
    end_time: str,
    attendees: list = [],
    location: str = "",
):
    """
    Schedule a meeting in Google Calendar using stored credentials.
    The start_time and end_time should be ISO 8601 formatted strings.
    """
    # Retrieve stored credentials.
    creds = get_google_credentials()
    # Build the Calendar service.
    service = build("calendar", "v3", credentials=creds)

    # Construct the event payload.
    event = {
        "summary": meeting_title,
        "location": location or "TBD",
        "description": "Scheduled by your virtual EA",
        "start": {
            "dateTime": start_time,
            "timeZone": "UTC",
        },
        "end": {
            "dateTime": end_time,
            "timeZone": "UTC",
        },
        "attendees": [{"email": email} for email in attendees] if attendees else [],
        "reminders": {"useDefault": True},
    }
    created_event = service.events().insert(calendarId="primary", body=event).execute()
    return created_event

def send_email(recipient: str, subject: str, body: str):
    """
    Send an email using the Gmail API.
    This implementation builds a MIME message, encodes it in base64, and
    calls the Gmail API to send the email.
    """
    creds = get_google_credentials()
    service = build("gmail", "v1", credentials=creds)
    message = MIMEText(body)
    message["to"] = recipient
    message["subject"] = subject
    raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
    sent_message = service.users().messages().send(userId="me", body={"raw": raw_message}).execute()
    return sent_message

def run_function(name: str, args: dict):
    if name == "schedule_meeting":
        return schedule_meeting(
            meeting_title=args["meeting_title"],
            start_time=args["start_time"],
            end_time=args["end_time"],
            attendees=args.get("attendees"),
            location=args.get("location"),
        )
    if name == "send_email":
        return send_email(
            recipient=args["recipient"],
            subject=args["subject"],
            body=args["body"]
        )
    return None

functions = [
    {
        "name": "schedule_meeting",
        "description": "Schedule a meeting in Google Calendar.",
        "parameters": {
            "type": "object",
            "properties": {
                "meeting_title": {"type": "string", "description": "Title of the meeting"},
                "start_time": {"type": "string", "description": "Start time in ISO 8601 format"},
                "end_time": {"type": "string", "description": "End time in ISO 8601 format"},
                "attendees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of attendee email addresses",
                },
                "location": {"type": "string", "description": "Optional meeting location"},
            },
            "required": ["meeting_title", "start_time", "end_time"],
        },
    },
    {
        "name": "send_email",
        "description": "Send an email via Gmail API.",
        "parameters": {
            "type": "object",
            "properties": {
                "recipient": {"type": "string", "description": "Recipient email address"},
                "subject": {"type": "string", "description": "Email subject"},
                "body": {"type": "string", "description": "Email body content"},
            },
            "required": ["recipient", "subject", "body"],
        },
    },
]
