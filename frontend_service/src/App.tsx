// src/App.tsx
import React from "react";
import GoogleCalendarQuickstart from "@/components/GoogleCalendarQuickstart";
import AgentChat from "@/components/AgentChat";
import { Toaster } from "@/components/ui/toaster";

function App() {
  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Google Calendar Integration */}
      <GoogleCalendarQuickstart />

      {/* Virtual Executive Assistant Chat Interface */}
      <AgentChat />

      <Toaster />
    </div>
  );
}

export default App;
