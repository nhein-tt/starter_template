// src/components/AgentChat.tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface ChatMessage {
  role: string;
  text: string;
}

const AgentChat: React.FC = () => {
  const [message, setMessage] = useState("");
  const [chatResponse, setChatResponse] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const { toast } = useToast();
  const modalUrl = import.meta.env.VITE_MODAL_URL as string;

  const fetchChatHistory = async () => {
    try {
      const response = await fetch(`${modalUrl}/agent/history`);
      if (!response.ok) {
        throw new Error("Failed to fetch chat history.");
      }
      const data = await response.json();
      setChatHistory(data.messages);
    } catch (err: any) {
      console.error("Error fetching chat history:", err);
      toast({
        variant: "destructive",
        description: "Failed to fetch chat history",
      });
    }
  };

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
  const handleResetThread = async () => {
    try {
      const response = await fetch(`${modalUrl}/agent/thread`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to reset the agent thread.");
      }
      const data = await response.json();
      toast({
        description: data.message || "Agent thread reset successfully.",
      });
      // Optionally, clear the chat response after resetting
      setChatResponse("");
    } catch (err: any) {
      console.error("Error resetting agent thread:", err);
      toast({
        variant: "destructive",
        description: "Failed to reset agent thread",
      });
    }
  };

  return (
    <>
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
          <div className="p-4 mb-2 border rounded">
            <h3 className="font-bold mb-2">Agent Response:</h3>
            <p>{chatResponse}</p>
          </div>
        )}
        <Button
          onClick={handleResetThread}
          variant="destructive"
          className="px-4 py-2 bg-red-600 text-white rounded"
        >
          Reset Agent Thread
        </Button>
      </div>
      <div>
        <h3 className="text-lg font-bold mb-2">Chat History</h3>
        {chatHistory.length > 0 ? (
          <ul className="list-disc pl-6">
            {chatHistory.map((msg, index) => (
              <li key={index}>
                <span className="font-semibold">{msg.role}: </span>
                <span>{msg.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No chat history available.</p>
        )}
        <div className="mt-2">
          <Button onClick={fetchChatHistory} variant="outline">
            Refresh Chat History
          </Button>
        </div>
      </div>
    </>
  );
};

export default AgentChat;
