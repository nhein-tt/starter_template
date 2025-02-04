// src/components/AgentChat.tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const AgentChat: React.FC = () => {
  const [message, setMessage] = useState("");
  const [chatResponse, setChatResponse] = useState("");
  const { toast } = useToast();
  const modalUrl = import.meta.env.VITE_MODAL_URL as string;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      const response = await fetch(`${modalUrl}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) {
        throw new Error("Failed to get a response from the agent.");
      }
      const data = await response.json();
      setChatResponse(data.response);
      setMessage("");
    } catch (err: any) {
      console.error("Agent chat error:", err);
      toast({
        variant: "destructive",
        description: "Failed to get agent response",
      });
    }
  };

  return (
    <div className="p-4 border rounded shadow my-4">
      <h2 className="text-xl font-bold mb-2">
        Virtual Executive Assistant Chat
      </h2>
      <form onSubmit={handleSubmit} className="flex gap-2 mb-4">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your request here..."
          className="flex-1"
        />
        <Button type="submit">Send</Button>
      </form>
      {chatResponse && (
        <div className="p-4 border rounded">
          <h3 className="font-bold mb-2">Agent Response:</h3>
          <p>{chatResponse}</p>
        </div>
      )}
    </div>
  );
};

export default AgentChat;
