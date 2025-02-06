import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, Mail, Send, Loader2, LogOut } from "lucide-react";
import Markdown from "react-markdown";

import { useToast } from "@/hooks/use-toast";

// Get values from environment variables for Google authentication
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;
const SCOPES = import.meta.env.VITE_GOOGLE_SCOPES as string;

// Add window type declarations for Google APIs
declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

interface ChatMessage {
  role: string;
  text: string;
}

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  token_expiry: string;
}

const ExecutiveAssistant = () => {
  // Chat state
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Google API state
  const [gapiLoaded, setGapiLoaded] = useState(false);
  const [gisLoaded, setGisLoaded] = useState(false);
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [authorized, setAuthorized] = useState(false);
  const [googleTokens, setGoogleTokens] = useState<GoogleTokens | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("chat");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const modalUrl = import.meta.env.VITE_MODAL_URL as string;

  // Load Google API scripts on component mount
  useEffect(() => {
    // Load the Google API Client Library
    const gapiScript = document.createElement("script");
    gapiScript.src = "https://apis.google.com/js/api.js";
    gapiScript.async = true;
    gapiScript.defer = true;
    gapiScript.onload = () => {
      window.gapi.load("client", initializeGapiClient);
    };
    document.body.appendChild(gapiScript);

    // Load the Google Identity Services Library
    const gisScript = document.createElement("script");
    gisScript.src = "https://accounts.google.com/gsi/client";
    gisScript.async = true;
    gisScript.defer = true;
    gisScript.onload = gisLoadedCallback;
    document.body.appendChild(gisScript);

    // Cleanup function to remove scripts
    return () => {
      document.body.removeChild(gapiScript);
      document.body.removeChild(gisScript);
    };
  }, []);

  // Initialize GAPI client
  const initializeGapiClient = async () => {
    try {
      await window.gapi.client.init({
        apiKey: API_KEY,
      });
      setGapiLoaded(true);
      maybeEnableButtons();
    } catch (error) {
      console.error("Error initializing GAPI client:", error);
      toast({
        variant: "destructive",
        description: "Failed to initialize Google Calendar",
      });
    }
  };

  // Initialize Google Identity Services
  const gisLoadedCallback = () => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: "", // Will be set in handleAuthClick
    });
    setTokenClient(client);
    setGisLoaded(true);
    maybeEnableButtons();
  };

  const maybeEnableButtons = () => {
    if (gapiLoaded && gisLoaded) {
      console.log("Google APIs initialized successfully");
    }
  };

  // Handle Google Calendar authentication
  const handleAuthClick = () => {
    if (!tokenClient) {
      toast({
        variant: "destructive",
        description: "Google authentication not ready",
      });
      return;
    }

    tokenClient.callback = async (resp: any) => {
      if (resp.error) {
        toast({
          variant: "destructive",
          description: "Google authentication failed",
        });
        return;
      }

      try {
        const tokenResponse = await fetch(`${modalUrl}/auth/google/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: resp.access_token }),
        });
        const tokens = await tokenResponse.json();
        setGoogleTokens(tokens);
        setAuthorized(true);
        // await listUpcomingEvents();

        toast({
          description: "Successfully connected to Google Calendar",
        });
      } catch (err) {
        console.error("Error exchanging token:", err);
        toast({
          variant: "destructive",
          description: "Failed to connect to Google Calendar",
        });
      }
    };

    tokenClient.requestAccessToken({ prompt: "consent" });
  };

  // Handle Google Calendar sign out
  const handleSignoutClick = () => {
    const token = window.gapi.client.getToken();
    if (token !== null) {
      window.google.accounts.oauth2.revoke(token.access_token);
      window.gapi.client.setToken("");
      setAuthorized(false);
      setEvents([]);
      setGoogleTokens(null);
      toast({
        description: "Disconnected from Google Calendar",
      });
    }
  };

  // Fetch upcoming calendar events
  // const listUpcomingEvents = async () => {
  //   try {
  //     const response = await window.gapi.client.calendar.events.list({
  //       calendarId: "primary",
  //       timeMin: new Date().toISOString(),
  //       showDeleted: false,
  //       singleEvents: true,
  //       maxResults: 10,
  //       orderBy: "startTime",
  //     });
  //     const events = response.result.items;
  //     setEvents(events?.length > 0 ? events : []);
  //   } catch (error) {
  //     console.error("Error listing events:", error);
  //     toast({
  //       variant: "destructive",
  //       description: "Failed to fetch calendar events",
  //     });
  //   }
  // };

  // Chat functionality
  useEffect(() => {
    fetchChatHistory();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchChatHistory = async () => {
    try {
      const response = await fetch(`${modalUrl}/agent/history`);
      if (!response.ok) throw new Error("Failed to fetch chat history");
      const data = await response.json();
      setChatHistory(data.messages);
    } catch (err) {
      toast({
        variant: "destructive",
        description: "Failed to fetch chat history",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!message.trim()) return;

    setIsLoading(true);
    try {
      const userMessage = { role: "user", text: message };
      setChatHistory((prev) => [...prev, userMessage]);

      const response = await fetch(`${modalUrl}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) throw new Error("Failed to get agent response");

      const data = await response.json();
      const assistantMessage = { role: "assistant", text: data.response };
      setChatHistory((prev) => [...prev, assistantMessage]);

      setMessage("");
    } catch (err) {
      toast({
        variant: "destructive",
        description: "Failed to get agent response",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetThread = async () => {
    try {
      const response = await fetch(`${modalUrl}/agent/thread`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to reset thread");

      setChatHistory([]);
      toast({
        description: "Chat thread reset successfully",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        description: "Failed to reset chat thread",
      });
    }
  };

  // Message bubble component
  const MessageBubble = ({ message }: { message: ChatMessage }) => {
    const isUser = message.role === "user";
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
        <div
          className={`max-w-3/4 p-3 prose rounded-lg ${
            isUser
              ? "bg-blue-600 text-white rounded-br-none"
              : "bg-gray-100 text-gray-900 rounded-bl-none"
          }`}
        >
          <Markdown>{message.text}</Markdown>
        </div>
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <Tabs defaultValue="chat" className="w-full" onValueChange={setActiveTab}>
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Executive Assistant</h1>
          <div className="flex gap-2">
            {!authorized ? (
              <Button
                onClick={handleAuthClick}
                className="flex items-center gap-2"
                disabled={!gapiLoaded || !gisLoaded}
              >
                <Calendar className="w-4 h-4" />
                Connect Google
              </Button>
            ) : (
              <Button
                onClick={handleSignoutClick}
                variant="outline"
                className="flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </Button>
            )}
            <TabsList>
              <TabsTrigger value="chat" className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Chat
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="chat" className="mt-0">
          <Card>
            <CardContent className="p-6">
              <ScrollArea className="h-[600px] pr-4">
                {chatHistory.map((msg, idx) => (
                  <MessageBubble key={idx} message={msg} />
                ))}
                <div ref={messagesEndRef} />
              </ScrollArea>

              <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask your assistant anything..."
                  className="flex-1"
                  disabled={isLoading}
                />
                <Button
                  type="submit"
                  disabled={isLoading || !message.trim()}
                  className="flex items-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Thinking...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send
                    </>
                  )}
                </Button>
              </form>

              <div className="flex justify-end mt-4">
                <Button
                  onClick={handleResetThread}
                  variant="outline"
                  className="text-sm"
                >
                  Reset Thread
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ExecutiveAssistant;
