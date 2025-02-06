// src/App.tsx
import React from "react";
import EADashboard from "@/components/EADashboard";
import { Toaster } from "@/components/ui/toaster";

function App() {
  return (
    <div className="container mx-auto p-4 space-y-6">
      <EADashboard />
      <Toaster />
    </div>
  );
}

export default App;
