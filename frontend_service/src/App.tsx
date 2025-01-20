import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";

function App() {
  const { toast } = useToast();
  const modalUrl = import.meta.env.VITE_MODAL_URL;

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // For file-based audio
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");

  // For image generation
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  // For microphone recording
  const [isRecording, setIsRecording] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const handleStartRecording = async () => {
    try {
      if (!selectedDeviceId) {
        toast({
          variant: "destructive",
          description: "No microphone selected.",
        });
        return;
      }

      const constraints = {
        audio: {
          deviceId: { exact: selectedDeviceId },
        },
      };

      const mimeType = "audio/webm; codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        toast({
          variant: "destructive",
          description: "WebM with Opus is not supported in this browser.",
        });
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const newRecorder = new MediaRecorder(stream, { mimeType });

      // Reset chunks when starting new recording
      setAudioChunks([]);

      // Request data every second instead of waiting for stop
      newRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setAudioChunks((prev) => [...prev, event.data]);
        }
      };

      newRecorder.onstop = () => {
        // Create blob from accumulated chunks
        const blob = new Blob(audioChunks, { type: mimeType });
        setRecordedBlob(blob);

        // Stop all tracks in the stream
        stream.getTracks().forEach((track) => track.stop());
      };

      // Request data more frequently
      newRecorder.start(1000); // Get data every second
      setRecorder(newRecorder);
      setIsRecording(true);
    } catch (err: any) {
      console.error("Error starting recording:", err);
      toast({ variant: "destructive", description: err.message });
    }
  };

  const handleStopRecording = () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      setIsRecording(false);
    }
  };

  // Add a useEffect to create the final blob when chunks are updated
  useEffect(() => {
    if (!isRecording && audioChunks.length > 0) {
      const mimeType = "audio/webm; codecs=opus";
      const blob = new Blob(audioChunks, { type: mimeType });
      setRecordedBlob(blob);
    }
  }, [isRecording, audioChunks]);
  /**
   * 1. A separate button to request microphone permissions
   */
  const handleRequestMicPermissions = async () => {
    try {
      // Request microphone access
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // After user grants (or denies) permission, enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter((d) => d.kind === "audioinput");
      setAudioDevices(microphones);

      if (microphones.length > 0) {
        setSelectedDeviceId(microphones[0].deviceId);
      } else {
        toast({ variant: "destructive", description: "No microphones found." });
      }
    } catch (err: any) {
      // Handle errors, e.g. user denies permission
      if (err.name === "NotAllowedError") {
        toast({
          variant: "destructive",
          description: "Microphone permission denied.",
        });
      } else {
        toast({ variant: "destructive", description: err.message });
      }
      console.error("Error requesting mic permission:", err);
    }
  };

  /**
   * 2. Handle audio file transcription
   */
  const handleTranscribeFile = async () => {
    if (!selectedFile) return;
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(`${modalUrl}/transcribe`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setTranscript(data.transcript);
    } catch (error: any) {
      toast({ variant: "destructive", description: error.message });
    }
  };

  /**
   * 3. Start recording using the selected microphone
   */

  /**
   * 5. Transcribe the recorded audio
   */
  const handleTranscribeRecording = async () => {
    if (!recordedBlob) {
      toast({ variant: "destructive", description: "No audio recorded yet." });
      return;
    }

    if (recordedBlob.size === 0) {
      toast({
        variant: "destructive",
        description: "Recorded audio is empty.",
      });
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", recordedBlob, "recording.webm");

      const response = await fetch(`${modalUrl}/transcribe`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setTranscript(data.transcript);
    } catch (error: any) {
      toast({ variant: "destructive", description: error.message });
    }
  };

  /**
   * 6. Generate Image
   */
  const handleGenerateImage = async () => {
    try {
      const response = await fetch(`${modalUrl}/generate_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt }),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setImageUrl(data.image_url);
    } catch (error: any) {
      toast({ variant: "destructive", description: error.message });
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Week 2 - Multi-Modal Bot Demo</h1>

      {/* ---- Request Microphone Permissions Button ---- */}
      <div className="space-y-2">
        <Button variant="outline" onClick={handleRequestMicPermissions}>
          Request Microphone Permissions
        </Button>
        <p className="text-sm text-gray-600">
          After granting permission, select your microphone below.
        </p>
      </div>

      {/* ---- Microphone Selection ---- */}
      <div className="space-y-2">
        <h2 className="font-semibold">Choose Microphone</h2>
        <select
          value={selectedDeviceId ?? ""}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
        >
          {audioDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Mic ${device.deviceId}`}
            </option>
          ))}
        </select>
      </div>

      {/* ---- Audio from File ---- */}
      <div className="space-y-2">
        <h2 className="font-semibold">Upload Audio File</h2>
        <Input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              setSelectedFile(e.target.files[0]);
            }
          }}
        />
        <Button onClick={handleTranscribeFile}>Transcribe Audio File</Button>
      </div>

      {/* ---- Microphone Recording ---- */}
      <div className="space-y-2">
        <h2 className="font-semibold">Record from Microphone</h2>
        {!isRecording ? (
          <Button onClick={handleStartRecording}>Start Recording</Button>
        ) : (
          <Button variant="destructive" onClick={handleStopRecording}>
            Stop Recording
          </Button>
        )}

        <Button onClick={handleTranscribeRecording} disabled={isRecording}>
          Transcribe Recording
        </Button>

        {/* Optional: playback of the recorded audio */}
        {recordedBlob && recordedBlob.size > 0 && (
          <div className="mt-2">
            <audio controls src={URL.createObjectURL(recordedBlob)} />
          </div>
        )}
      </div>

      {/* ---- Display Transcript ---- */}
      {transcript && (
        <div>
          <h3 className="font-semibold mt-4">Transcript:</h3>
          <p>{transcript}</p>
        </div>
      )}

      {/* ---- Image Generation ---- */}
      <div className="space-y-2">
        <h2 className="font-semibold">Image Generation</h2>
        <Input
          placeholder="Enter image prompt"
          value={imagePrompt}
          onChange={(e) => setImagePrompt(e.target.value)}
        />
        <Button onClick={handleGenerateImage}>Generate Image</Button>
        {imageUrl && (
          <img src={imageUrl} alt="Generated" className="max-w-sm mt-2" />
        )}
      </div>

      <Toaster />
    </div>
  );
}

export default App;
