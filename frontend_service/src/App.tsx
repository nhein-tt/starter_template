import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";

function MultiModalApp() {
  const { toast } = useToast();
  const modalUrl = import.meta.env.VITE_MODAL_URL;

  // State for microphone selection
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // State for audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  // Processing states
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Result states
  const [transcript, setTranscript] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [similarityScore, setSimilarityScore] = useState<number | null>(null);
  const [imageDescription, setImageDescription] = useState<string>("");
  const [descriptionAudio, setDescriptionAudio] = useState<string>("");

  // Handle requesting microphone permissions
  const handleRequestMicPermissions = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter((d) => d.kind === "audioinput");
      setAudioDevices(microphones);

      if (microphones.length > 0) {
        setSelectedDeviceId(microphones[0].deviceId);
      } else {
        toast({
          title: "No Microphones",
          description: "No microphone devices were found.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Permission Error",
        description:
          err.name === "NotAllowedError"
            ? "Microphone permission was denied."
            : `Error: ${err.message}`,
        variant: "destructive",
      });
      console.error("Error requesting mic permission:", err);
    }
  };

  // Handle recording start
  const handleStartRecording = async () => {
    try {
      if (!selectedDeviceId) {
        toast({
          title: "No Microphone",
          description: "Please select a microphone first.",
          variant: "destructive",
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
          title: "Browser Not Supported",
          description: "Your browser doesn't support WebM with Opus codec.",
          variant: "destructive",
        });
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const newRecorder = new MediaRecorder(stream, { mimeType });

      // Clear previous recording data
      setAudioChunks([]);
      setRecordedBlob(null);

      let chunks: Blob[] = [];
      newRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      newRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        setRecordedBlob(blob);
        setAudioChunks(chunks);
        stream.getTracks().forEach((track) => track.stop());
      };

      newRecorder.start(1000);
      setRecorder(newRecorder);
      setIsRecording(true);

      toast({
        title: "Recording Started",
        description: "Speak your prompt clearly into the microphone.",
      });
    } catch (err: any) {
      console.error("Error starting recording:", err);
      toast({
        title: "Recording Error",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // Handle recording stop
  const handleStopRecording = () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      setIsRecording(false);
      toast({
        title: "Recording Complete",
        description: "You can now process your recording.",
      });
    }
  };

  // Process the full flow
  const handleProcessFlow = async () => {
    if (!recordedBlob) {
      toast({
        title: "No Recording",
        description: "Please record some audio first.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);

    try {
      // Step 1: Transcribe audio
      setCurrentStep("transcribing");
      setProgress(20);

      const formData = new FormData();
      formData.append("file", recordedBlob, "recording.webm");

      const transcriptResponse = await fetch(`${modalUrl}/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!transcriptResponse.ok) {
        const error = await transcriptResponse.json();
        throw new Error(error.detail || "Failed to transcribe audio");
      }

      const transcriptData = await transcriptResponse.json();
      setTranscript(transcriptData.transcript);
      setProgress(40);

      // Step 2: Generate image
      setCurrentStep("generating");
      const imageResponse = await fetch(`${modalUrl}/generate_image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: transcriptData.transcript }),
      });

      if (!imageResponse.ok) {
        const error = await imageResponse.json();
        throw new Error(error.detail || "Failed to generate image");
      }

      const imageData = await imageResponse.json();
      setImageUrl(imageData.image_url);
      setProgress(60);

      // Step 3: Analyze image similarity
      setCurrentStep("analyzing");
      const analysisResponse = await fetch(
        `${modalUrl}/analyze_image_similarity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: transcriptData.transcript,
            image_url: imageData.image_url,
          }),
        },
      );

      if (!analysisResponse.ok) {
        const error = await analysisResponse.json();
        throw new Error(error.detail || "Failed to analyze image");
      }

      const analysisData = await analysisResponse.json();
      setSimilarityScore(analysisData.similarity_score);
      setImageDescription(analysisData.image_description);
      setProgress(80);

      // Step 4: Generate audio description
      setCurrentStep("speaking");
      if (analysisData.image_description) {
        const ttsResponse = await fetch(`${modalUrl}/text_to_speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: analysisData.image_description }),
        });

        if (!ttsResponse.ok) {
          const error = await ttsResponse.json();
          throw new Error(error.detail || "Failed to convert text to speech");
        }

        const ttsData = await ttsResponse.json();
        setDescriptionAudio(ttsData.audio);
      }

      setProgress(100);
      toast({
        title: "Processing Complete",
        description: "All steps have been completed successfully.",
      });
    } catch (error: any) {
      console.error("Processing error:", error);
      toast({
        title: "Processing Error",
        description: error.message || "An error occurred during processing",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setCurrentStep(null);
    }
  };

  const getStepDescription = () => {
    switch (currentStep) {
      case "transcribing":
        return "Transcribing your audio...";
      case "generating":
        return "Generating an image from your description...";
      case "analyzing":
        return "Analyzing the generated image...";
      case "speaking":
        return "Creating audio description...";
      default:
        return "";
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card className="mb-8">
        <CardContent className="pt-6">
          <h1 className="text-2xl font-bold mb-6">Multi-Modal AI Demo</h1>

          {/* Microphone Setup Section */}
          <div className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">Microphone Setup</h2>
            <Button
              variant="outline"
              onClick={handleRequestMicPermissions}
              className="w-full sm:w-auto"
            >
              Request Microphone Permissions
            </Button>
            <div className="mt-2">
              <label
                htmlFor="mic-select"
                className="block text-sm text-gray-600 mb-2"
              >
                Choose Microphone:
              </label>
              <select
                id="mic-select"
                className="w-full rounded-md border border-gray-300 shadow-sm p-2"
                value={selectedDeviceId ?? ""}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
              >
                <option value="">Select a microphone...</option>
                {audioDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label ||
                      `Microphone ${device.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Recording Controls */}
          <div className="space-y-4 mb-8">
            <h2 className="text-xl font-semibold">Record Your Prompt</h2>
            <div className="flex gap-2 flex-wrap">
              {!isRecording ? (
                <Button
                  onClick={handleStartRecording}
                  disabled={!selectedDeviceId || isProcessing}
                  className="w-full sm:w-auto"
                >
                  Start Recording
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  onClick={handleStopRecording}
                  className="w-full sm:w-auto"
                >
                  Stop Recording
                </Button>
              )}

              {recordedBlob && (
                <>
                  <div className="w-full">
                    <audio
                      controls
                      src={URL.createObjectURL(recordedBlob)}
                      className="w-full mt-2"
                    />
                  </div>
                  <Button
                    onClick={handleProcessFlow}
                    disabled={isRecording || isProcessing}
                    className="w-full sm:w-auto"
                  >
                    Process Recording
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Processing Progress */}
          {isProcessing && (
            <div className="space-y-2 mb-8">
              <div className="flex justify-between text-sm">
                <span>{getStepDescription()}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          )}

          {/* Results Display */}
          {transcript && (
            <div className="space-y-4 mb-8">
              <h2 className="text-xl font-semibold">Results</h2>

              <div className="space-y-2">
                <h3 className="font-semibold">Your Prompt:</h3>
                <p className="text-gray-700 bg-gray-50 p-4 rounded-lg">
                  {transcript}
                </p>
              </div>

              {imageUrl && (
                <div className="space-y-2">
                  <h3 className="font-semibold">Generated Image:</h3>
                  <img
                    src={imageUrl}
                    alt="AI Generated"
                    className="w-full max-w-2xl rounded-lg shadow-lg"
                  />
                  {similarityScore !== null &&
                    typeof similarityScore === "number" && (
                      <p className="text-sm text-gray-600">
                        Similarity to prompt: {similarityScore.toFixed(1)}%
                      </p>
                    )}
                </div>
              )}

              {imageDescription && (
                <div className="space-y-2">
                  <h3 className="font-semibold">AI Vision Analysis:</h3>
                  <p className="text-gray-700 bg-gray-50 p-4 rounded-lg">
                    {imageDescription}
                  </p>
                  {descriptionAudio && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2">Audio Description:</h4>
                      <audio
                        controls
                        src={`data:audio/mp3;base64,${descriptionAudio}`}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Toaster />
    </div>
  );
}

export default MultiModalApp;
// import React, { useState, useEffect } from "react";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Toaster } from "@/components/ui/toaster";
// import { useToast } from "@/hooks/use-toast";

// function MultiModalApp() {
//   const { toast } = useToast();
//   const modalUrl = import.meta.env.VITE_MODAL_URL;

//   // State for microphone selection
//   const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
//   const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

//   // State for audio recording
//   const [isRecording, setIsRecording] = useState(false);
//   const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
//   const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
//   const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

//   // State for the flow
//   const [transcript, setTranscript] = useState("");
//   const [imageUrl, setImageUrl] = useState("");
//   const [similarityScore, setSimilarityScore] = useState<number | null>(null);
//   const [imageDescription, setImageDescription] = useState<string>("");
//   const [descriptionAudio, setDescriptionAudio] = useState<string>("");

//   // Handle requesting microphone permissions
//   const handleRequestMicPermissions = async () => {
//     try {
//       // Request microphone access
//       await navigator.mediaDevices.getUserMedia({ audio: true });

//       // After user grants permission, enumerate devices
//       const devices = await navigator.mediaDevices.enumerateDevices();
//       const microphones = devices.filter((d) => d.kind === "audioinput");
//       setAudioDevices(microphones);

//       if (microphones.length > 0) {
//         setSelectedDeviceId(microphones[0].deviceId);
//       } else {
//         toast({ variant: "destructive", description: "No microphones found." });
//       }
//     } catch (err: any) {
//       if (err.name === "NotAllowedError") {
//         toast({
//           variant: "destructive",
//           description: "Microphone permission denied.",
//         });
//       } else {
//         toast({ variant: "destructive", description: err.message });
//       }
//       console.error("Error requesting mic permission:", err);
//     }
//   };

//   // Handle recording start
//   const handleStartRecording = async () => {
//     try {
//       if (!selectedDeviceId) {
//         toast({
//           variant: "destructive",
//           description: "No microphone selected.",
//         });
//         return;
//       }

//       const constraints = {
//         audio: {
//           deviceId: { exact: selectedDeviceId },
//         },
//       };

//       const mimeType = "audio/webm; codecs=opus";
//       if (!MediaRecorder.isTypeSupported(mimeType)) {
//         toast({
//           variant: "destructive",
//           description: "WebM with Opus is not supported in this browser.",
//         });
//         return;
//       }

//       const stream = await navigator.mediaDevices.getUserMedia(constraints);
//       const newRecorder = new MediaRecorder(stream, { mimeType });

//       // Clear previous recording data
//       setAudioChunks([]);
//       setRecordedBlob(null);

//       // Set up event handlers before starting recording
//       let chunks: Blob[] = [];

//       newRecorder.ondataavailable = (event) => {
//         if (event.data.size > 0) {
//           chunks.push(event.data);
//         }
//       };

//       newRecorder.onstop = () => {
//         const blob = new Blob(chunks, { type: mimeType });
//         setRecordedBlob(blob);
//         setAudioChunks(chunks);
//         stream.getTracks().forEach((track) => track.stop());
//       };

//       // Start recording
//       newRecorder.start(1000);
//       setRecorder(newRecorder);
//       setIsRecording(true);
//     } catch (err: any) {
//       console.error("Error starting recording:", err);
//       toast({ variant: "destructive", description: err.message });
//     }
//   };

//   // Handle recording stop
//   const handleStopRecording = () => {
//     if (recorder && recorder.state !== "inactive") {
//       recorder.stop();
//       setIsRecording(false);
//     }
//   };

//   // Process the full flow
//   const handleProcessFlow = async () => {
//     if (!recordedBlob) {
//       toast({ variant: "destructive", description: "No audio recorded yet." });
//       return;
//     }

//     try {
//       // Step 1: Transcribe audio
//       const formData = new FormData();
//       formData.append("file", recordedBlob, "recording.webm");

//       const transcriptResponse = await fetch(`${modalUrl}/transcribe`, {
//         method: "POST",
//         body: formData,
//       });
//       const transcriptData = await transcriptResponse.json();
//       if (transcriptData.error) throw new Error(transcriptData.error);
//       setTranscript(transcriptData.transcript);

//       // Only proceed with image generation if we have a transcript
//       const imageResponse = await fetch(`${modalUrl}/generate_image`, {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ prompt: transcriptData.transcript }),
//       });
//       const imageData = await imageResponse.json();
//       if (imageData.error) throw new Error(imageData.error);
//       setImageUrl(imageData.image_url);

//       // Only proceed with analysis if we have both transcript and image
//       const analysisResponse = await fetch(
//         `${modalUrl}/analyze_image_similarity`,
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             prompt: transcriptData.transcript,
//             image_url: imageData.image_url,
//           }),
//         },
//       );
//       const analysisData = await analysisResponse.json();
//       if (analysisData.error) throw new Error(analysisData.error);

//       setSimilarityScore(analysisData.similarity_score);
//       setImageDescription(analysisData.image_description);

//       // Only proceed with TTS if we have a description
//       if (analysisData.image_description) {
//         const ttsResponse = await fetch(`${modalUrl}/text_to_speech`, {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({ text: analysisData.image_description }),
//         });
//         const ttsData = await ttsResponse.json();
//         if (ttsData.error) throw new Error(ttsData.error);
//         setDescriptionAudio(ttsData.audio);
//       }
//     } catch (error: any) {
//       console.error("Processing error:", error);
//       toast({
//         variant: "destructive",
//         description: error.message || "An error occurred during processing",
//       });
//     }
//   };

//   return (
//     <div className="container mx-auto p-4 space-y-6">
//       <h1 className="text-2xl font-bold">Multi-Modal Flow Demo</h1>

//       {/* Microphone Permissions and Selection */}
//       <div className="space-y-2">
//         <h2 className="font-semibold">Microphone Setup</h2>
//         <Button variant="outline" onClick={handleRequestMicPermissions}>
//           Request Microphone Permissions
//         </Button>
//         <div className="mt-2">
//           <label htmlFor="mic-select" className="block text-sm text-gray-600">
//             Choose Microphone:
//           </label>
//           <select
//             id="mic-select"
//             className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
//             value={selectedDeviceId ?? ""}
//             onChange={(e) => setSelectedDeviceId(e.target.value)}
//           >
//             {audioDevices.map((device) => (
//               <option key={device.deviceId} value={device.deviceId}>
//                 {device.label || `Microphone ${device.deviceId}`}
//               </option>
//             ))}
//           </select>
//         </div>
//       </div>

//       {/* Recording Controls */}
//       <div className="space-y-2">
//         <h2 className="font-semibold">Record Your Prompt</h2>
//         {!isRecording ? (
//           <Button onClick={handleStartRecording} disabled={!selectedDeviceId}>
//             Start Recording
//           </Button>
//         ) : (
//           <Button variant="destructive" onClick={handleStopRecording}>
//             Stop Recording
//           </Button>
//         )}

//         {recordedBlob && (
//           <>
//             <div className="mt-2">
//               <audio controls src={URL.createObjectURL(recordedBlob)} />
//             </div>
//             <Button onClick={handleProcessFlow} disabled={isRecording}>
//               Process Recording
//             </Button>
//           </>
//         )}
//       </div>

//       {/* Results Display */}
//       {transcript && (
//         <div className="space-y-2">
//           <h3 className="font-semibold">Transcript:</h3>
//           <p className="text-gray-700">{transcript}</p>
//         </div>
//       )}

//       {imageUrl && (
//         <div className="space-y-2">
//           <h3 className="font-semibold">Generated Image:</h3>
//           <img
//             src={imageUrl}
//             alt="Generated"
//             className="max-w-sm rounded-lg shadow-lg"
//           />
//           {similarityScore !== null && (
//             <p className="text-sm text-gray-600">
//               Similarity to prompt: {similarityScore.toFixed(2)}%
//             </p>
//           )}
//           {imageDescription && (
//             <div className="mt-2">
//               <h4 className="font-medium">AI Vision Analysis:</h4>
//               <p className="text-gray-700">{imageDescription}</p>
//               {descriptionAudio && (
//                 <audio
//                   controls
//                   src={`data:audio/mp3;base64,${descriptionAudio}`}
//                   className="mt-2"
//                 />
//               )}
//             </div>
//           )}
//         </div>
//       )}

//       <Toaster />
//     </div>
//   );
// }

// export default MultiModalApp;

// // import React, { useState, useEffect } from "react";
// // import { Button } from "@/components/ui/button";
// // import { Input } from "@/components/ui/input";
// // import { Toaster } from "@/components/ui/toaster";
// // import { useToast } from "@/hooks/use-toast";

// // function MultiModalApp() {
// //   const { toast } = useToast();
// //   const modalUrl = import.meta.env.VITE_MODAL_URL;

// //   // State for microphone selection
// //   const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
// //   const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

// //   // State for audio recording
// //   const [isRecording, setIsRecording] = useState(false);
// //   const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
// //   const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
// //   const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

// //   // State for the flow
// //   const [transcript, setTranscript] = useState("");
// //   const [imageUrl, setImageUrl] = useState("");
// //   const [similarityScore, setSimilarityScore] = useState<number | null>(null);
// //   const [imageDescription, setImageDescription] = useState<string>("");
// //   const [descriptionAudio, setDescriptionAudio] = useState<string>("");

// //   // Handle requesting microphone permissions
// //   const handleRequestMicPermissions = async () => {
// //     try {
// //       // Request microphone access
// //       await navigator.mediaDevices.getUserMedia({ audio: true });

// //       // After user grants permission, enumerate devices
// //       const devices = await navigator.mediaDevices.enumerateDevices();
// //       const microphones = devices.filter((d) => d.kind === "audioinput");
// //       setAudioDevices(microphones);

// //       if (microphones.length > 0) {
// //         setSelectedDeviceId(microphones[0].deviceId);
// //       } else {
// //         toast({ variant: "destructive", description: "No microphones found." });
// //       }
// //     } catch (err: any) {
// //       if (err.name === "NotAllowedError") {
// //         toast({
// //           variant: "destructive",
// //           description: "Microphone permission denied.",
// //         });
// //       } else {
// //         toast({ variant: "destructive", description: err.message });
// //       }
// //       console.error("Error requesting mic permission:", err);
// //     }
// //   };

// //   // Handle recording start
// //   const handleStartRecording = async () => {
// //     try {
// //       if (!selectedDeviceId) {
// //         toast({
// //           variant: "destructive",
// //           description: "No microphone selected.",
// //         });
// //         return;
// //       }

// //       const constraints = {
// //         audio: {
// //           deviceId: { exact: selectedDeviceId },
// //         },
// //       };

// //       const mimeType = "audio/webm; codecs=opus";
// //       if (!MediaRecorder.isTypeSupported(mimeType)) {
// //         toast({
// //           variant: "destructive",
// //           description: "WebM with Opus is not supported in this browser.",
// //         });
// //         return;
// //       }

// //       const stream = await navigator.mediaDevices.getUserMedia(constraints);
// //       const newRecorder = new MediaRecorder(stream, { mimeType });

// //       // Clear previous recording data
// //       setAudioChunks([]);
// //       setRecordedBlob(null);

// //       // Set up event handlers before starting recording
// //       let chunks: Blob[] = [];

// //       newRecorder.ondataavailable = (event) => {
// //         if (event.data.size > 0) {
// //           chunks.push(event.data);
// //         }
// //       };

// //       newRecorder.onstop = () => {
// //         const blob = new Blob(chunks, { type: mimeType });
// //         setRecordedBlob(blob);
// //         setAudioChunks(chunks);
// //         stream.getTracks().forEach((track) => track.stop());
// //       };

// //       // Start recording
// //       newRecorder.start(1000);
// //       setRecorder(newRecorder);
// //       setIsRecording(true);
// //     } catch (err: any) {
// //       console.error("Error starting recording:", err);
// //       toast({ variant: "destructive", description: err.message });
// //     }
// //   };

// //   // Handle recording stop
// //   const handleStopRecording = () => {
// //     if (recorder && recorder.state !== "inactive") {
// //       recorder.stop();
// //       setIsRecording(false);
// //     }
// //   };

// //   // Process the full flow
// //   const handleProcessFlow = async () => {
// //     if (!recordedBlob) {
// //       toast({ variant: "destructive", description: "No audio recorded yet." });
// //       return;
// //     }

// //     try {
// //       // Step 1: Transcribe audio
// //       const formData = new FormData();
// //       formData.append("file", recordedBlob, "recording.webm");

// //       const transcriptResponse = await fetch(`${modalUrl}/transcribe`, {
// //         method: "POST",
// //         body: formData,
// //       });
// //       const transcriptData = await transcriptResponse.json();
// //       if (transcriptData.error) throw new Error(transcriptData.error);
// //       setTranscript(transcriptData.transcript);

// //       // Step 2: Generate image from transcript
// //       const imageResponse = await fetch(`${modalUrl}/generate_image`, {
// //         method: "POST",
// //         headers: { "Content-Type": "application/json" },
// //         body: JSON.stringify({ prompt: transcriptData.transcript }),
// //       });
// //       const imageData = await imageResponse.json();
// //       if (imageData.error) throw new Error(imageData.error);
// //       setImageUrl(imageData.image_url);

// //       // Step 3: Analyze image similarity and get description
// //       const analysisResponse = await fetch(
// //         `${modalUrl}/analyze_image_similarity`,
// //         {
// //           method: "POST",
// //           headers: { "Content-Type": "application/json" },
// //           body: JSON.stringify({
// //             prompt: transcriptData.transcript,
// //             image_url: imageData.image_url,
// //           }),
// //         },
// //       );
// //       const analysisData = await analysisResponse.json();
// //       if (analysisData.error) throw new Error(analysisData.error);

// //       setSimilarityScore(analysisData.similarity_score);
// //       setImageDescription(analysisData.image_description);

// //       // Step 4: Convert description to speech
// //       const ttsResponse = await fetch(`${modalUrl}/text_to_speech`, {
// //         method: "POST",
// //         headers: { "Content-Type": "application/json" },
// //         body: JSON.stringify({ text: analysisData.image_description }),
// //       });
// //       const ttsData = await ttsResponse.json();
// //       if (ttsData.error) throw new Error(ttsData.error);
// //       setDescriptionAudio(ttsData.audio);
// //     } catch (error: any) {
// //       toast({ variant: "destructive", description: error.message });
// //     }
// //   };

// //   return (
// //     <div className="container mx-auto p-4 space-y-6">
// //       <h1 className="text-2xl font-bold">Multi-Modal Flow Demo</h1>

// //       {/* Microphone Permissions and Selection */}
// //       <div className="space-y-2">
// //         <h2 className="font-semibold">Microphone Setup</h2>
// //         <Button variant="outline" onClick={handleRequestMicPermissions}>
// //           Request Microphone Permissions
// //         </Button>
// //         <div className="mt-2">
// //           <label htmlFor="mic-select" className="block text-sm text-gray-600">
// //             Choose Microphone:
// //           </label>
// //           <select
// //             id="mic-select"
// //             className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
// //             value={selectedDeviceId ?? ""}
// //             onChange={(e) => setSelectedDeviceId(e.target.value)}
// //           >
// //             {audioDevices.map((device) => (
// //               <option key={device.deviceId} value={device.deviceId}>
// //                 {device.label || `Microphone ${device.deviceId}`}
// //               </option>
// //             ))}
// //           </select>
// //         </div>
// //       </div>

// //       {/* Recording Controls */}
// //       <div className="space-y-2">
// //         <h2 className="font-semibold">Record Your Prompt</h2>
// //         {!isRecording ? (
// //           <Button onClick={handleStartRecording} disabled={!selectedDeviceId}>
// //             Start Recording
// //           </Button>
// //         ) : (
// //           <Button variant="destructive" onClick={handleStopRecording}>
// //             Stop Recording
// //           </Button>
// //         )}

// //         {recordedBlob && (
// //           <>
// //             <div className="mt-2">
// //               <audio controls src={URL.createObjectURL(recordedBlob)} />
// //             </div>
// //             <Button onClick={handleProcessFlow} disabled={isRecording}>
// //               Process Recording
// //             </Button>
// //           </>
// //         )}
// //       </div>

// //       {/* Results Display */}
// //       {transcript && (
// //         <div className="space-y-2">
// //           <h3 className="font-semibold">Transcript:</h3>
// //           <p className="text-gray-700">{transcript}</p>
// //         </div>
// //       )}

// //       {imageUrl && (
// //         <div className="space-y-2">
// //           <h3 className="font-semibold">Generated Image:</h3>
// //           <img
// //             src={imageUrl}
// //             alt="Generated"
// //             className="max-w-sm rounded-lg shadow-lg"
// //           />
// //           {similarityScore !== null && (
// //             <p className="text-sm text-gray-600">
// //               Similarity to prompt: {similarityScore.toFixed(2)}%
// //             </p>
// //           )}
// //           {imageDescription && (
// //             <div className="mt-2">
// //               <h4 className="font-medium">AI Vision Analysis:</h4>
// //               <p className="text-gray-700">{imageDescription}</p>
// //               {descriptionAudio && (
// //                 <audio
// //                   controls
// //                   src={`data:audio/mp3;base64,${descriptionAudio}`}
// //                   className="mt-2"
// //                 />
// //               )}
// //             </div>
// //           )}
// //         </div>
// //       )}

// //       <Toaster />
// //     </div>
// //   );
// // }

// // export default MultiModalApp;
// // // import React, { useState, useEffect } from "react";
// // // import { Button } from "@/components/ui/button";
// // // import { Input } from "@/components/ui/input";
// // // import { Toaster } from "@/components/ui/toaster";
// // // import { useToast } from "@/hooks/use-toast";

// // // function MultiModalApp() {
// // //   const { toast } = useToast();
// // //   const modalUrl = import.meta.env.VITE_MODAL_URL;

// // //   // State for microphone selection
// // //   const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
// // //   const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

// // //   // State for audio recording
// // //   const [isRecording, setIsRecording] = useState(false);
// // //   const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
// // //   const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
// // //   const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

// // //   // State for the flow
// // //   const [transcript, setTranscript] = useState("");
// // //   const [imageUrl, setImageUrl] = useState("");
// // //   const [similarityScore, setSimilarityScore] = useState<number | null>(null);
// // //   const [imageDescription, setImageDescription] = useState<string>("");
// // //   const [descriptionAudio, setDescriptionAudio] = useState<string>("");

// // //   // Handle requesting microphone permissions
// // //   const handleRequestMicPermissions = async () => {
// // //     try {
// // //       // Request microphone access
// // //       await navigator.mediaDevices.getUserMedia({ audio: true });

// // //       // After user grants permission, enumerate devices
// // //       const devices = await navigator.mediaDevices.enumerateDevices();
// // //       const microphones = devices.filter((d) => d.kind === "audioinput");
// // //       setAudioDevices(microphones);

// // //       if (microphones.length > 0) {
// // //         setSelectedDeviceId(microphones[0].deviceId);
// // //       } else {
// // //         toast({ variant: "destructive", description: "No microphones found." });
// // //       }
// // //     } catch (err: any) {
// // //       if (err.name === "NotAllowedError") {
// // //         toast({
// // //           variant: "destructive",
// // //           description: "Microphone permission denied.",
// // //         });
// // //       } else {
// // //         toast({ variant: "destructive", description: err.message });
// // //       }
// // //       console.error("Error requesting mic permission:", err);
// // //     }
// // //   };

// // //   // Handle recording start
// // //   const handleStartRecording = async () => {
// // //     try {
// // //       if (!selectedDeviceId) {
// // //         toast({
// // //           variant: "destructive",
// // //           description: "No microphone selected.",
// // //         });
// // //         return;
// // //       }

// // //       const constraints = {
// // //         audio: {
// // //           deviceId: { exact: selectedDeviceId },
// // //         },
// // //       };

// // //       const mimeType = "audio/webm; codecs=opus";
// // //       if (!MediaRecorder.isTypeSupported(mimeType)) {
// // //         toast({
// // //           variant: "destructive",
// // //           description: "WebM with Opus is not supported in this browser.",
// // //         });
// // //         return;
// // //       }

// // //       const stream = await navigator.mediaDevices.getUserMedia(constraints);
// // //       const newRecorder = new MediaRecorder(stream, { mimeType });
// // //       setAudioChunks([]);

// // //       newRecorder.ondataavailable = (event) => {
// // //         if (event.data.size > 0) {
// // //           setAudioChunks((prev) => [...prev, event.data]);
// // //         }
// // //       };

// // //       newRecorder.onstop = () => {
// // //         const blob = new Blob(audioChunks, { type: mimeType });
// // //         setRecordedBlob(blob);
// // //         stream.getTracks().forEach((track) => track.stop());
// // //       };

// // //       newRecorder.start(1000);
// // //       setRecorder(newRecorder);
// // //       setIsRecording(true);
// // //     } catch (err: any) {
// // //       console.error("Error starting recording:", err);
// // //       toast({ variant: "destructive", description: err.message });
// // //     }
// // //   };

// // //   // Handle recording stop
// // //   const handleStopRecording = () => {
// // //     if (recorder && recorder.state !== "inactive") {
// // //       recorder.stop();
// // //       setIsRecording(false);
// // //     }
// // //   };

// // //   // Process the full flow
// // //   const handleProcessFlow = async () => {
// // //     if (!recordedBlob) {
// // //       toast({ variant: "destructive", description: "No audio recorded yet." });
// // //       return;
// // //     }

// // //     try {
// // //       // Step 1: Transcribe audio
// // //       const formData = new FormData();
// // //       formData.append("file", recordedBlob, "recording.webm");

// // //       const transcriptResponse = await fetch(`${modalUrl}/transcribe`, {
// // //         method: "POST",
// // //         body: formData,
// // //       });
// // //       const transcriptData = await transcriptResponse.json();
// // //       if (transcriptData.error) throw new Error(transcriptData.error);
// // //       setTranscript(transcriptData.transcript);

// // //       // Step 2: Generate image from transcript
// // //       const imageResponse = await fetch(`${modalUrl}/generate_image`, {
// // //         method: "POST",
// // //         headers: { "Content-Type": "application/json" },
// // //         body: JSON.stringify({ prompt: transcriptData.transcript }),
// // //       });
// // //       const imageData = await imageResponse.json();
// // //       if (imageData.error) throw new Error(imageData.error);
// // //       setImageUrl(imageData.image_url);

// // //       // Step 3: Analyze image similarity and get description
// // //       const analysisResponse = await fetch(
// // //         `${modalUrl}/analyze_image_similarity`,
// // //         {
// // //           method: "POST",
// // //           headers: { "Content-Type": "application/json" },
// // //           body: JSON.stringify({
// // //             prompt: transcriptData.transcript,
// // //             image_url: imageData.image_url,
// // //           }),
// // //         },
// // //       );
// // //       const analysisData = await analysisResponse.json();
// // //       if (analysisData.error) throw new Error(analysisData.error);

// // //       setSimilarityScore(analysisData.similarity_score);
// // //       setImageDescription(analysisData.image_description);

// // //       // Step 4: Convert description to speech
// // //       const ttsResponse = await fetch(`${modalUrl}/text_to_speech`, {
// // //         method: "POST",
// // //         headers: { "Content-Type": "application/json" },
// // //         body: JSON.stringify({ text: analysisData.image_description }),
// // //       });
// // //       const ttsData = await ttsResponse.json();
// // //       if (ttsData.error) throw new Error(ttsData.error);
// // //       setDescriptionAudio(ttsData.audio);
// // //     } catch (error: any) {
// // //       toast({ variant: "destructive", description: error.message });
// // //     }
// // //   };

// // //   return (
// // //     <div className="container mx-auto p-4 space-y-6">
// // //       <h1 className="text-2xl font-bold">Multi-Modal Flow Demo</h1>

// // //       {/* Microphone Permissions and Selection */}
// // //       <div className="space-y-2">
// // //         <h2 className="font-semibold">Microphone Setup</h2>
// // //         <Button variant="outline" onClick={handleRequestMicPermissions}>
// // //           Request Microphone Permissions
// // //         </Button>
// // //         <div className="mt-2">
// // //           <label htmlFor="mic-select" className="block text-sm text-gray-600">
// // //             Choose Microphone:
// // //           </label>
// // //           <select
// // //             id="mic-select"
// // //             className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
// // //             value={selectedDeviceId ?? ""}
// // //             onChange={(e) => setSelectedDeviceId(e.target.value)}
// // //           >
// // //             {audioDevices.map((device) => (
// // //               <option key={device.deviceId} value={device.deviceId}>
// // //                 {device.label || `Microphone ${device.deviceId}`}
// // //               </option>
// // //             ))}
// // //           </select>
// // //         </div>
// // //       </div>

// // //       {/* Recording Controls */}
// // //       <div className="space-y-2">
// // //         <h2 className="font-semibold">Record Your Prompt</h2>
// // //         {!isRecording ? (
// // //           <Button onClick={handleStartRecording} disabled={!selectedDeviceId}>
// // //             Start Recording
// // //           </Button>
// // //         ) : (
// // //           <Button variant="destructive" onClick={handleStopRecording}>
// // //             Stop Recording
// // //           </Button>
// // //         )}

// // //         {recordedBlob && (
// // //           <>
// // //             <div className="mt-2">
// // //               <audio controls src={URL.createObjectURL(recordedBlob)} />
// // //             </div>
// // //             <Button onClick={handleProcessFlow} disabled={isRecording}>
// // //               Process Recording
// // //             </Button>
// // //           </>
// // //         )}
// // //       </div>

// // //       {/* Results Display */}
// // //       {transcript && (
// // //         <div className="space-y-2">
// // //           <h3 className="font-semibold">Transcript:</h3>
// // //           <p className="text-gray-700">{transcript}</p>
// // //         </div>
// // //       )}

// // //       {imageUrl && (
// // //         <div className="space-y-2">
// // //           <h3 className="font-semibold">Generated Image:</h3>
// // //           <img
// // //             src={imageUrl}
// // //             alt="Generated"
// // //             className="max-w-sm rounded-lg shadow-lg"
// // //           />
// // //           {similarityScore !== null && (
// // //             <p className="text-sm text-gray-600">
// // //               Similarity to prompt: {similarityScore.toFixed(2)}%
// // //             </p>
// // //           )}
// // //           {imageDescription && (
// // //             <div className="mt-2">
// // //               <h4 className="font-medium">AI Vision Analysis:</h4>
// // //               <p className="text-gray-700">{imageDescription}</p>
// // //               {descriptionAudio && (
// // //                 <audio
// // //                   controls
// // //                   src={`data:audio/mp3;base64,${descriptionAudio}`}
// // //                   className="mt-2"
// // //                 />
// // //               )}
// // //             </div>
// // //           )}
// // //         </div>
// // //       )}

// // //       <Toaster />
// // //     </div>
// // //   );
// // // }

// // // export default MultiModalApp;
// // // // import React, { useState, useEffect } from "react";
// // // // import { Button } from "@/components/ui/button";
// // // // import { Input } from "@/components/ui/input";
// // // // import { Toaster } from "@/components/ui/toaster";
// // // // import { useToast } from "@/hooks/use-toast";

// // // // function MultiModalApp() {
// // // //   const { toast } = useToast();
// // // //   const modalUrl = import.meta.env.VITE_MODAL_URL;

// // // //   // State for microphone selection
// // // //   const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
// // // //   const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

// // // //   // State for audio recording
// // // //   const [isRecording, setIsRecording] = useState(false);
// // // //   const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
// // // //   const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
// // // //   const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

// // // //   // State for the flow
// // // //   const [transcript, setTranscript] = useState("");
// // // //   const [imageUrl, setImageUrl] = useState("");
// // // //   const [audioDescription, setAudioDescription] = useState<string>("");
// // // //   const [descriptionAudio, setDescriptionAudio] = useState<string>("");

// // // //   // Handle recording start
// // // //   const handleStartRecording = async () => {
// // // //     try {
// // // //       const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
// // // //       const mimeType = "audio/webm; codecs=opus";

// // // //       if (!MediaRecorder.isTypeSupported(mimeType)) {
// // // //         toast({
// // // //           variant: "destructive",
// // // //           description: "WebM with Opus is not supported in this browser.",
// // // //         });
// // // //         return;
// // // //       }

// // // //       const newRecorder = new MediaRecorder(stream, { mimeType });
// // // //       setAudioChunks([]);

// // // //       newRecorder.ondataavailable = (event) => {
// // // //         if (event.data.size > 0) {
// // // //           setAudioChunks((prev) => [...prev, event.data]);
// // // //         }
// // // //       };

// // // //       newRecorder.onstop = () => {
// // // //         const blob = new Blob(audioChunks, { type: mimeType });
// // // //         setRecordedBlob(blob);
// // // //         stream.getTracks().forEach((track) => track.stop());
// // // //       };

// // // //       newRecorder.start(1000);
// // // //       setRecorder(newRecorder);
// // // //       setIsRecording(true);
// // // //     } catch (err: any) {
// // // //       console.error("Error starting recording:", err);
// // // //       toast({ variant: "destructive", description: err.message });
// // // //     }
// // // //   };

// // // //   // Handle recording stop
// // // //   const handleStopRecording = () => {
// // // //     if (recorder && recorder.state !== "inactive") {
// // // //       recorder.stop();
// // // //       setIsRecording(false);
// // // //     }
// // // //   };

// // // //   // State for analysis results
// // // //   const [similarityScore, setSimilarityScore] = useState<number | null>(null);
// // // //   const [imageDescription, setImageDescription] = useState<string>("");

// // // //   // Process the full flow
// // // //   const handleProcessFlow = async () => {
// // // //     if (!recordedBlob) {
// // // //       toast({ variant: "destructive", description: "No audio recorded yet." });
// // // //       return;
// // // //     }

// // // //     try {
// // // //       // Step 1: Transcribe audio
// // // //       const formData = new FormData();
// // // //       formData.append("file", recordedBlob, "recording.webm");

// // // //       const transcriptResponse = await fetch(`${modalUrl}/transcribe`, {
// // // //         method: "POST",
// // // //         body: formData,
// // // //       });
// // // //       const transcriptData = await transcriptResponse.json();
// // // //       if (transcriptData.error) throw new Error(transcriptData.error);
// // // //       setTranscript(transcriptData.transcript);

// // // //       // Step 2: Generate image from transcript
// // // //       const imageResponse = await fetch(`${modalUrl}/generate_image`, {
// // // //         method: "POST",
// // // //         headers: { "Content-Type": "application/json" },
// // // //         body: JSON.stringify({ prompt: transcriptData.transcript }),
// // // //       });
// // // //       const imageData = await imageResponse.json();
// // // //       if (imageData.error) throw new Error(imageData.error);
// // // //       setImageUrl(imageData.image_url);

// // // //       // Step 3: Analyze image similarity and get description
// // // //       const analysisResponse = await fetch(
// // // //         `${modalUrl}/analyze_image_similarity`,
// // // //         {
// // // //           method: "POST",
// // // //           headers: { "Content-Type": "application/json" },
// // // //           body: JSON.stringify({
// // // //             prompt: transcriptData.transcript,
// // // //             image_url: imageData.image_url,
// // // //           }),
// // // //         },
// // // //       );
// // // //       const analysisData = await analysisResponse.json();
// // // //       if (analysisData.error) throw new Error(analysisData.error);

// // // //       setSimilarityScore(analysisData.similarity_score);
// // // //       setImageDescription(analysisData.image_description);

// // // //       // Step 4: Generate audio description of the image
// // // //       const description = `This image, generated from the prompt "${transcriptData.transcript}", shows...`; // You might want to use GPT-4-Vision here
// // // //       setAudioDescription(description);

// // // //       // Step 4: Convert description to speech
// // // //       const ttsResponse = await fetch(`${modalUrl}/text_to_speech`, {
// // // //         method: "POST",
// // // //         headers: { "Content-Type": "application/json" },
// // // //         body: JSON.stringify({ text: description }),
// // // //       });
// // // //       const ttsData = await ttsResponse.json();
// // // //       if (ttsData.error) throw new Error(ttsData.error);
// // // //       setDescriptionAudio(ttsData.audio);
// // // //     } catch (error: any) {
// // // //       toast({ variant: "destructive", description: error.message });
// // // //     }
// // // //   };

// // // //   return (
// // // //     <div className="container mx-auto p-4 space-y-6">
// // // //       <h1 className="text-2xl font-bold">Multi-Modal Flow Demo</h1>

// // // //       {/* Recording Controls */}
// // // //       <div className="space-y-2">
// // // //         <h2 className="font-semibold">Record Your Prompt</h2>
// // // //         {!isRecording ? (
// // // //           <Button onClick={handleStartRecording}>Start Recording</Button>
// // // //         ) : (
// // // //           <Button variant="destructive" onClick={handleStopRecording}>
// // // //             Stop Recording
// // // //           </Button>
// // // //         )}

// // // //         {recordedBlob && (
// // // //           <>
// // // //             <div className="mt-2">
// // // //               <audio controls src={URL.createObjectURL(recordedBlob)} />
// // // //             </div>
// // // //             <Button onClick={handleProcessFlow} disabled={isRecording}>
// // // //               Process Recording
// // // //             </Button>
// // // //           </>
// // // //         )}
// // // //       </div>

// // // //       {/* Results Display */}
// // // //       {transcript && (
// // // //         <div className="space-y-2">
// // // //           <h3 className="font-semibold">Transcript:</h3>
// // // //           <p className="text-gray-700">{transcript}</p>
// // // //         </div>
// // // //       )}

// // // //       {imageUrl && (
// // // //         <div className="space-y-2">
// // // //           <h3 className="font-semibold">Generated Image:</h3>
// // // //           <img
// // // //             src={imageUrl}
// // // //             alt="Generated"
// // // //             className="max-w-sm rounded-lg shadow-lg"
// // // //           />
// // // //           {similarityScore !== null && (
// // // //             <p className="text-sm text-gray-600">
// // // //               Similarity to prompt: {similarityScore.toFixed(2)}%
// // // //             </p>
// // // //           )}
// // // //           {imageDescription && (
// // // //             <div className="mt-2">
// // // //               <h4 className="font-medium">AI Vision Analysis:</h4>
// // // //               <p className="text-gray-700">{imageDescription}</p>
// // // //             </div>
// // // //           )}
// // // //         </div>
// // // //       )}

// // // //       {audioDescription && (
// // // //         <div className="space-y-2">
// // // //           <h3 className="font-semibold">Image Description:</h3>
// // // //           <p className="text-gray-700">{audioDescription}</p>
// // // //           {descriptionAudio && (
// // // //             <audio controls src={`data:audio/mp3;base64,${descriptionAudio}`} />
// // // //           )}
// // // //         </div>
// // // //       )}

// // // //       <Toaster />
// // // //     </div>
// // // //   );
// // // // }

// // // // export default MultiModalApp;
// // // // // import React, { useState, useEffect } from "react";
// // // // // import { Button } from "@/components/ui/button";
// // // // // import { Input } from "@/components/ui/input";
// // // // // import { Toaster } from "@/components/ui/toaster";
// // // // // import { useToast } from "@/hooks/use-toast";

// // // // // function App() {
// // // // //   const { toast } = useToast();
// // // // //   const modalUrl = import.meta.env.VITE_MODAL_URL;

// // // // //   const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
// // // // //   const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

// // // // //   // For file-based audio
// // // // //   const [selectedFile, setSelectedFile] = useState<File | null>(null);
// // // // //   const [transcript, setTranscript] = useState("");

// // // // //   // For image generation
// // // // //   const [imagePrompt, setImagePrompt] = useState("");
// // // // //   const [imageUrl, setImageUrl] = useState("");

// // // // //   // For microphone recording
// // // // //   const [isRecording, setIsRecording] = useState(false);
// // // // //   const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
// // // // //   const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
// // // // //   const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

// // // // //   const handleStartRecording = async () => {
// // // // //     try {
// // // // //       if (!selectedDeviceId) {
// // // // //         toast({
// // // // //           variant: "destructive",
// // // // //           description: "No microphone selected.",
// // // // //         });
// // // // //         return;
// // // // //       }

// // // // //       const constraints = {
// // // // //         audio: {
// // // // //           deviceId: { exact: selectedDeviceId },
// // // // //         },
// // // // //       };

// // // // //       const mimeType = "audio/webm; codecs=opus";
// // // // //       if (!MediaRecorder.isTypeSupported(mimeType)) {
// // // // //         toast({
// // // // //           variant: "destructive",
// // // // //           description: "WebM with Opus is not supported in this browser.",
// // // // //         });
// // // // //         return;
// // // // //       }

// // // // //       const stream = await navigator.mediaDevices.getUserMedia(constraints);
// // // // //       const newRecorder = new MediaRecorder(stream, { mimeType });

// // // // //       // Reset chunks when starting new recording
// // // // //       setAudioChunks([]);

// // // // //       // Request data every second instead of waiting for stop
// // // // //       newRecorder.ondataavailable = (event) => {
// // // // //         if (event.data.size > 0) {
// // // // //           setAudioChunks((prev) => [...prev, event.data]);
// // // // //         }
// // // // //       };

// // // // //       newRecorder.onstop = () => {
// // // // //         // Create blob from accumulated chunks
// // // // //         const blob = new Blob(audioChunks, { type: mimeType });
// // // // //         setRecordedBlob(blob);

// // // // //         // Stop all tracks in the stream
// // // // //         stream.getTracks().forEach((track) => track.stop());
// // // // //       };

// // // // //       // Request data more frequently
// // // // //       newRecorder.start(1000); // Get data every second
// // // // //       setRecorder(newRecorder);
// // // // //       setIsRecording(true);
// // // // //     } catch (err: any) {
// // // // //       console.error("Error starting recording:", err);
// // // // //       toast({ variant: "destructive", description: err.message });
// // // // //     }
// // // // //   };

// // // // //   const handleStopRecording = () => {
// // // // //     if (recorder && recorder.state !== "inactive") {
// // // // //       recorder.stop();
// // // // //       setIsRecording(false);
// // // // //     }
// // // // //   };

// // // // //   // Add a useEffect to create the final blob when chunks are updated
// // // // //   useEffect(() => {
// // // // //     if (!isRecording && audioChunks.length > 0) {
// // // // //       const mimeType = "audio/webm; codecs=opus";
// // // // //       const blob = new Blob(audioChunks, { type: mimeType });
// // // // //       setRecordedBlob(blob);
// // // // //     }
// // // // //   }, [isRecording, audioChunks]);
// // // // //   /**
// // // // //    * 1. A separate button to request microphone permissions
// // // // //    */
// // // // //   const handleRequestMicPermissions = async () => {
// // // // //     try {
// // // // //       // Request microphone access
// // // // //       await navigator.mediaDevices.getUserMedia({ audio: true });

// // // // //       // After user grants (or denies) permission, enumerate devices
// // // // //       const devices = await navigator.mediaDevices.enumerateDevices();
// // // // //       const microphones = devices.filter((d) => d.kind === "audioinput");
// // // // //       setAudioDevices(microphones);

// // // // //       if (microphones.length > 0) {
// // // // //         setSelectedDeviceId(microphones[0].deviceId);
// // // // //       } else {
// // // // //         toast({ variant: "destructive", description: "No microphones found." });
// // // // //       }
// // // // //     } catch (err: any) {
// // // // //       // Handle errors, e.g. user denies permission
// // // // //       if (err.name === "NotAllowedError") {
// // // // //         toast({
// // // // //           variant: "destructive",
// // // // //           description: "Microphone permission denied.",
// // // // //         });
// // // // //       } else {
// // // // //         toast({ variant: "destructive", description: err.message });
// // // // //       }
// // // // //       console.error("Error requesting mic permission:", err);
// // // // //     }
// // // // //   };

// // // // //   /**
// // // // //    * 2. Handle audio file transcription
// // // // //    */
// // // // //   const handleTranscribeFile = async () => {
// // // // //     if (!selectedFile) return;
// // // // //     try {
// // // // //       const formData = new FormData();
// // // // //       formData.append("file", selectedFile);

// // // // //       const response = await fetch(`${modalUrl}/transcribe`, {
// // // // //         method: "POST",
// // // // //         body: formData,
// // // // //       });
// // // // //       const data = await response.json();
// // // // //       if (data.error) throw new Error(data.error);
// // // // //       setTranscript(data.transcript);
// // // // //     } catch (error: any) {
// // // // //       toast({ variant: "destructive", description: error.message });
// // // // //     }
// // // // //   };

// // // // //   /**
// // // // //    * 3. Start recording using the selected microphone
// // // // //    */

// // // // //   /**
// // // // //    * 5. Transcribe the recorded audio
// // // // //    */
// // // // //   const handleTranscribeRecording = async () => {
// // // // //     if (!recordedBlob) {
// // // // //       toast({ variant: "destructive", description: "No audio recorded yet." });
// // // // //       return;
// // // // //     }

// // // // //     if (recordedBlob.size === 0) {
// // // // //       toast({
// // // // //         variant: "destructive",
// // // // //         description: "Recorded audio is empty.",
// // // // //       });
// // // // //       return;
// // // // //     }

// // // // //     try {
// // // // //       const formData = new FormData();
// // // // //       formData.append("file", recordedBlob, "recording.webm");

// // // // //       const response = await fetch(`${modalUrl}/transcribe`, {
// // // // //         method: "POST",
// // // // //         body: formData,
// // // // //       });
// // // // //       const data = await response.json();
// // // // //       if (data.error) throw new Error(data.error);
// // // // //       setTranscript(data.transcript);
// // // // //     } catch (error: any) {
// // // // //       toast({ variant: "destructive", description: error.message });
// // // // //     }
// // // // //   };

// // // // //   /**
// // // // //    * 6. Generate Image
// // // // //    */
// // // // //   const handleGenerateImage = async () => {
// // // // //     try {
// // // // //       const response = await fetch(`${modalUrl}/generate_image`, {
// // // // //         method: "POST",
// // // // //         headers: { "Content-Type": "application/json" },
// // // // //         body: JSON.stringify({ prompt: imagePrompt }),
// // // // //       });
// // // // //       const data = await response.json();
// // // // //       if (data.error) throw new Error(data.error);
// // // // //       setImageUrl(data.image_url);
// // // // //     } catch (error: any) {
// // // // //       toast({ variant: "destructive", description: error.message });
// // // // //     }
// // // // //   };

// // // // //   return (
// // // // //     <div className="container mx-auto p-4 space-y-6">
// // // // //       <h1 className="text-2xl font-bold">Week 2 - Multi-Modal Bot Demo</h1>

// // // // //       {/* ---- Request Microphone Permissions Button ---- */}
// // // // //       <div className="space-y-2">
// // // // //         <Button variant="outline" onClick={handleRequestMicPermissions}>
// // // // //           Request Microphone Permissions
// // // // //         </Button>
// // // // //         <p className="text-sm text-gray-600">
// // // // //           After granting permission, select your microphone below.
// // // // //         </p>
// // // // //       </div>

// // // // //       {/* ---- Microphone Selection ---- */}
// // // // //       <div className="space-y-2">
// // // // //         <h2 className="font-semibold">Choose Microphone</h2>
// // // // //         <select
// // // // //           value={selectedDeviceId ?? ""}
// // // // //           onChange={(e) => setSelectedDeviceId(e.target.value)}
// // // // //         >
// // // // //           {audioDevices.map((device) => (
// // // // //             <option key={device.deviceId} value={device.deviceId}>
// // // // //               {device.label || `Mic ${device.deviceId}`}
// // // // //             </option>
// // // // //           ))}
// // // // //         </select>
// // // // //       </div>

// // // // //       {/* ---- Audio from File ---- */}
// // // // //       <div className="space-y-2">
// // // // //         <h2 className="font-semibold">Upload Audio File</h2>
// // // // //         <Input
// // // // //           type="file"
// // // // //           accept="audio/*"
// // // // //           onChange={(e) => {
// // // // //             if (e.target.files && e.target.files[0]) {
// // // // //               setSelectedFile(e.target.files[0]);
// // // // //             }
// // // // //           }}
// // // // //         />
// // // // //         <Button onClick={handleTranscribeFile}>Transcribe Audio File</Button>
// // // // //       </div>

// // // // //       {/* ---- Microphone Recording ---- */}
// // // // //       <div className="space-y-2">
// // // // //         <h2 className="font-semibold">Record from Microphone</h2>
// // // // //         {!isRecording ? (
// // // // //           <Button onClick={handleStartRecording}>Start Recording</Button>
// // // // //         ) : (
// // // // //           <Button variant="destructive" onClick={handleStopRecording}>
// // // // //             Stop Recording
// // // // //           </Button>
// // // // //         )}

// // // // //         <Button onClick={handleTranscribeRecording} disabled={isRecording}>
// // // // //           Transcribe Recording
// // // // //         </Button>

// // // // //         {/* Optional: playback of the recorded audio */}
// // // // //         {recordedBlob && recordedBlob.size > 0 && (
// // // // //           <div className="mt-2">
// // // // //             <audio controls src={URL.createObjectURL(recordedBlob)} />
// // // // //           </div>
// // // // //         )}
// // // // //       </div>

// // // // //       {/* ---- Display Transcript ---- */}
// // // // //       {transcript && (
// // // // //         <div>
// // // // //           <h3 className="font-semibold mt-4">Transcript:</h3>
// // // // //           <p>{transcript}</p>
// // // // //         </div>
// // // // //       )}

// // // // //       {/* ---- Image Generation ---- */}
// // // // //       <div className="space-y-2">
// // // // //         <h2 className="font-semibold">Image Generation</h2>
// // // // //         <Input
// // // // //           placeholder="Enter image prompt"
// // // // //           value={imagePrompt}
// // // // //           onChange={(e) => setImagePrompt(e.target.value)}
// // // // //         />
// // // // //         <Button onClick={handleGenerateImage}>Generate Image</Button>
// // // // //         {imageUrl && (
// // // // //           <img src={imageUrl} alt="Generated" className="max-w-sm mt-2" />
// // // // //         )}
// // // // //       </div>

// // // // //       <Toaster />
// // // // //     </div>
// // // // //   );
// // // // // }

// // // // // export default App;
