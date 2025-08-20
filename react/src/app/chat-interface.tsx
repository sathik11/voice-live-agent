"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { AudioHandler } from "@/lib/audio";
import { ProactiveEventManager } from "@/lib/proactive-event-manager";
import { Power, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  AvatarConfigVideoParams,
  Voice,
  EOUDetection,
  isFunctionCallItem,
  Modality,
  RTClient,
  RTInputAudioItem,
  RTResponse,
  TurnDetection,
} from "rt-client";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import "./index.css";
import {
  clearChatSvg,
  offSvg,
  recordingSvg,
  robotSvg,
  settingsSvg,
} from "./svg";

interface Message {
  type: "user" | "assistant" | "status" | "error";
  content: string;
}

interface ToolDeclaration {
  type: "function";
  name: string;
  parameters: object | null;
  description: string;
}

interface PredefinedScenario {
  name: string;
  instructions?: string;
  pro_active?: boolean;
  voice?: {
    custom_voice: boolean;
    deployment_id?: string;
    voice_name: string;
    temperature?: number;
  };
  avatar?: {
    enabled: boolean;
    customized: boolean;
    avatar_name: string;
  };
}

// Define predefined tool templates
const predefinedTools = [
  {
    id: "search",
    label: "Search",
    tool: {
      type: "function",
      name: "search",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      description:
        "Search the knowledge base. The knowledge base is in English, translate to and from English if " +
        "needed. Results are formatted as a source name first in square brackets, followed by the text " +
        "content, and a line with '-----' at the end of each result.",
    } as ToolDeclaration,
    enabled: true,
  },
  {
    id: "time",
    label: "Time Lookup",
    tool: {
      type: "function",
      name: "get_time",
      parameters: null,
      description: "Get the current time.",
    } as ToolDeclaration,
    enabled: true,
  },
  {
    id: "weather",
    label: "Weather Checking",
    tool: {
      type: "function",
      name: "get_weather",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "Location to check the weather for",
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "Unit of temperature",
          },
        },
        required: ["location", "unit"],
        additionalProperties: false,
      },
      description:
        "Get the current weather. The location is a string, and the unit is either 'celsius' or 'fahrenheit'.",
    } as ToolDeclaration,
    enabled: false,
  },
  {
    id: "calculator",
    label: "Calculator",
    tool: {
      type: "function",
      name: "calculate",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Mathematical expression to calculate",
          },
        },
        required: ["expression"],
        additionalProperties: false,
      },
      description: "Perform a calculation. The expression is a string.",
    } as ToolDeclaration,
    enabled: false,
  },
];

// Helper to map message type to class names.
const getMessageClassNames = (type: Message["type"]): string => {
  switch (type) {
    case "user":
      return "bg-blue-100 ml-auto max-w-[80%]";
    case "assistant":
      return "bg-gray-100 mr-auto max-w-[80%]";
    case "status":
      return "bg-yellow-200 mx-auto max-w-[80%]";
    default:
      return "bg-red-100 mx-auto max-w-[80%]";
  }
};

let peerConnection: RTCPeerConnection;

const defaultAvatar = "Lisa-casual-sitting";

// New state for the readme content
const readme = `
    1. **Configure your Azure AI Services resource**
        - Obtain your endpoint and API key from the \`Keys and Endpoint\` tab in your Azure AI Services resource.
        - The endpoint can be the regional endpoint (e.g., \`https://<region>.api.cognitive.microsoft.com/\`) or a custom domain endpoint (e.g., \`https://<custom-domain>.cognitiveservices.azure.com/\`).
        - The resource must be in the \`eastus2\` or \`swedencentral\` region. Other regions are not supported.

    2. **(Optional) Set the Agent**
        - Set the project name and agent ID to connect to a specific agent.
        - Entra ID auth is required for agent mode, use \`az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv\` to get the token.

    2. **Select noise suppression or echo cancellation**
        - Enable noise suppression and/or echo cancellation to improve audio quality.

    3. **Select the Turn Detection**
        - Choose the desired turn detection method. The default is \`Server VAD\`, which uses server-side voice activity detection.
        - The \`Azure Semantic VAD\` option is also available for better performance.

    4. **Select the Voice**
       - Choose the desired voice from the list.
       - If using a custom voice, select the "Use Custom Voice" option and enter the Voice Deployment ID and the custom voice name.

    5. **Start conversation**
        - Click on the "Connect" button to start the conversation.
        - Click on the mic button to start recording audio. Click again to stop recording.
`;

// Define the list of available languages.
const availableLanguages = [
  { id: "auto", name: "Auto Detect" },
  { id: "en-US", name: "English (United States)" },
  { id: "zh-CN", name: "Chinese (China)" },
  { id: "de-DE", name: "German (Germany)" },
  { id: "en-GB", name: "English (United Kingdom)" },
  { id: "en-IN", name: "English (India)" },
  { id: "es-ES", name: "Spanish (Spain)" },
  { id: "es-MX", name: "Spanish (Mexico)" },
  { id: "fr-FR", name: "French (France)" },
  { id: "hi-IN", name: "Hindi (India)" },
  { id: "it-IT", name: "Italian (Italy)" },
  { id: "ja-JP", name: "Japanese (Japan)" },
  { id: "ko-KR", name: "Korean (South Korea)" },
  { id: "pt-BR", name: "Portuguese (Brazil)" },
];

// Define the list of available turn detection.
const availableTurnDetection = [
  { id: "server_vad", name: "Server VAD", disable: false },
  {
    id: "azure_semantic_vad",
    name: "Azure Semantic VAD",
    disabled: false,
  },
  // { id: "none", name: "None", disable: true },
];

const availableEouDetection = [
  { id: "none", name: "Disabled", disabled: false },
  { id: "semantic_detection_v1", name: "Semantic Detection", disabled: false },
];

// Define the updated list of available voices.
const availableVoices = [
  // openai voices:  "alloy" | "ash" | "ballad" | "coral" | "echo" | "sage" | "shimmer" | "verse"
  {
    id: "en-us-ava:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Ava (HD)",
  },
  {
    id: "en-us-steffan:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Steffan (HD)",
  },
  {
    id: "en-us-andrew:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Andrew (HD)",
  },
  {
    id: "zh-cn-xiaochen:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Xiaochen (HD)",
  },
  {
    id: "en-us-emma:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Emma (HD)",
  },
  {
    id: "en-us-emma2:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Emma (HD 2)",
  },
  {
    id: "en-us-andrew2:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Andrew (HD 2)",
  },
  {
    id: "de-DE-Seraphina:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Seraphina (HD)",
  },
  {
    id: "en-us-aria:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Aria (HD)",
  },
  {
    id: "en-us-davis:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Davis (HD)",
  },
  {
    id: "en-us-jenny:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Jenny (HD)",
  },
  {
    id: "ja-jp-masaru:DragonHDLatestNeural",
    name: "DragonHDLatestNeural, Masaru (HD)",
  },
  { id: "en-US-AvaMultilingualNeural", name: "Ava Multilingual" },
  {
    id: "en-US-AlloyTurboMultilingualNeural",
    name: "Alloy Turbo Multilingual",
  },
  { id: "en-US-AndrewNeural", name: "Andrew" },
  { id: "en-US-AndrewMultilingualNeural", name: "Andrew Multilingual" },
  { id: "en-US-BrianMultilingualNeural", name: "Brian Multilingual" },
  { id: "en-US-EmmaMultilingualNeural", name: "Emma Multilingual" },
  {
    id: "en-US-NovaTurboMultilingualNeural",
    name: "Nova Turbo Multilingual",
  },
  { id: "zh-CN-XiaoxiaoMultilingualNeural", name: "Xiaoxiao Multilingual" },
  { id: "en-US-AvaNeural", name: "Ava" },
  { id: "en-US-JennyNeural", name: "Jenny" },
  { id: "zh-HK-HiuMaanNeural", name: "HiuMaan (Cantonese)" },
  { id: "mt-MT-JosephNeural", name: "Joseph (Maltese)" },
  { id: "zh-cn-xiaoxiao2:DragonHDFlashLatestNeural", name: "Xiaoxiao2 HDFlash" },
  { id: "zh-cn-yunyi:DragonHDFlashLatestNeural", name: "Yunyi HDFlash" },
  {
    id: "alloy",
    name: "Alloy (OpenAI)",
  },
  {
    id: "ash",
    name: "Ash (OpenAI)",
  },
  {
    id: "ballad",
    name: "Ballad (OpenAI)",
  },
  {
    id: "coral",
    name: "Coral (OpenAI)",
  },
  {
    id: "echo",
    name: "Echo (OpenAI)",
  },
  {
    id: "sage",
    name: "Sage (OpenAI)",
  },
  {
    id: "shimmer",
    name: "Shimmer (OpenAI)",
  },
  {
    id: "verse",
    name: "Verse (OpenAI)",
  },
];

const avatarNames = [
  "Harry-business",
  "Harry-casual",
  "Harry-youthful",
  "Jeff-business",
  "Jeff-formal",
  "Lisa-casual-sitting",
  "Lori-casual",
  "Lori-formal",
  "Lori-graceful",
  "Max-business",
  "Max-casual",
  "Max-formal",
  "Meg-business",
  "Meg-casual",
  "Meg-formal",
];

let intervalId: NodeJS.Timeout | null = null;

const ChatInterface = () => {
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [entraToken, setEntraToken] = useState("");
  const [model, setModel] = useState("gpt-4o-realtime-preview");
  const [searchEndpoint, setSearchEndpoint] = useState("");
  const [searchApiKey, setSearchApiKey] = useState("");
  const [searchIndex, setSearchIndex] = useState("");
  const [searchContentField, setSearchContentField] = useState("chunk");
  const [searchIdentifierField, setSearchIdentifierField] =
    useState("chunk_id");
  const [recognitionLanguage, setRecognitionLanguage] = useState("auto");
  const [useNS, setUseNS] = useState(false);
  const [useEC, setUseEC] = useState(false);
  const [turnDetectionType, setTurnDetectionType] = useState<TurnDetection>({
    type: "server_vad",
  });
  const [eouDetectionType, setEouDetectionType] = useState<string>("none");
  const [removeFillerWords, setRemoveFillerWords] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [enableProactive, setEnableProactive] = useState(false);
  const [temperature, setTemperature] = useState(0.9);
  const [voiceTemperature, setVoiceTemperature] = useState(0.9);
  const [useCNV, setUseCNV] = useState(false);
  const [voiceName, setVoiceName] = useState("en-US-AvaNeural");
  const [customVoiceName, setCustomVoiceName] = useState("");
  const [avatarName, setAvatarName] = useState(defaultAvatar);
  const [customAvatarName, setCustomAvatarName] = useState("");
  const [voiceDeploymentId, setVoiceDeploymentId] = useState("");
  const [tools, setTools] = useState<ToolDeclaration[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAvatar, setIsAvatar] = useState(false);
  const [isCustomAvatar, setIsCustomAvatar] = useState(false);
  const [isDevelop, setIsDevelop] = useState(false);
  const [enableSearch, setEnableSearch] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  // Add new state variables for predefined scenarios
  const [predefinedScenarios, setPredefinedScenarios] = useState<
    Record<string, PredefinedScenario>
  >({});
  const [selectedScenario, setSelectedScenario] = useState<string>("");
  const [isSettings, setIsSettings] = useState(false);

  // Add mode state and agent fields
  const [mode, setMode] = useState<"model" | "agent">("model");
  const [agentProjectName, setAgentProjectName] = useState("");
  const [agentId, setAgentId] = useState("");
  // const [agentAccessToken, setAgentAccessToken] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  const clientRef = useRef<RTClient | null>(null);
  const audioHandlerRef = useRef<AudioHandler | null>(null);
  const proactiveManagerRef = useRef<ProactiveEventManager | null>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const isUserSpeaking = useRef(false);
  const searchClientRef = useRef<SearchClient<object> | null>(null);
  const animationRef = useRef(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const isEnableAvatar = isAvatar && (avatarName || customAvatarName);

  // Fetch configuration from /config endpoint when component loads
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/config");
        if (response.status === 404) {
          setConfigLoaded(false);
          return;
        }

        const config = await response.json();
        if (config.endpoint) {
          setEndpoint(config.endpoint);
        }
        if (config.token) {
          setEntraToken(config.token);
        }
        if (config.pre_defined_scenarios) {
          setPredefinedScenarios(config.pre_defined_scenarios);
        }
        // Parse agent configs from /config
        if (config.agent && config.agent.project_name) {
          // setAgentAccessToken(config.agent.access_token);
          setAgentProjectName(config.agent.project_name);
          if (Array.isArray(config.agent.agents)) {
            setAgents(config.agent.agents);
            // If only one agent, auto-select it
            if (config.agent.agents.length === 1) {
              setAgentId(config.agent.agents[0].id);
            }
          }
        }
        setConfigLoaded(true);
      } catch (error) {
        console.error("Failed to fetch config:", error);
        setConfigLoaded(true);
      }
    };

    fetchConfig();
  }, []);

  const handleConnect = async () => {
    if (!isConnected) {
      try {
        setIsConnecting(true);

        // Refresh the token before connecting
        if (configLoaded) {
          try {
            const response = await fetch("/config");
            if (response.ok) {
              const config = await response.json();
              if (config.endpoint) {
                setEndpoint(config.endpoint);
              }
              if (config.token) {
                setEntraToken(config.token);
              }
            }
          } catch (error) {
            console.error("Failed to refresh token:", error);
            // Continue with existing token if refresh fails
          }
        }

        // Use agent fields if in agent mode
        const clientAuth = entraToken
          ? {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            getToken: async (_: string) => ({
              token: entraToken,
              expiresOnTimestamp: Date.now() + 3600000,
            }),
          }
          : { key: apiKey };
        if (mode === "agent" && !agentId) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              type: "error",
              content: "Please input/select an agent.",
            },
          ]);
          return;
        }
        clientRef.current = new RTClient(
          new URL(endpoint),
          clientAuth,
          mode === "agent"
            ? {
              modelOrAgent: {
                agentId,
                projectName: agentProjectName,
                agentAccessToken: entraToken,
              },
              apiVersion: "2025-05-01-preview",
            }
            : {
              modelOrAgent: model,
              apiVersion: "2025-05-01-preview",
            }
        );
        console.log("Client created:", clientRef.current.connectAvatar);
        const modalities: Modality[] = ["text", "audio"];
        const turnDetection: TurnDetection = turnDetectionType;
        if (
          turnDetection &&
          eouDetectionType !== "none" &&
          isCascaded(mode, model)
        ) {
          turnDetection.end_of_utterance_detection = {
            model: eouDetectionType,
          } as EOUDetection;
        }
        if (turnDetection?.type === "azure_semantic_vad") {
          turnDetection.remove_filler_words = removeFillerWords;
        }
        const voice: Voice = useCNV
          ? {
            name: customVoiceName,
            endpoint_id: voiceDeploymentId,
            temperature: customVoiceName.toLowerCase().includes("dragonhd")
              ? voiceTemperature
              : undefined,
            type: "azure-custom",
          }
          : voiceName.includes("-")
            ? {
              name: voiceName,
              type: "azure-standard",
              temperature: voiceName.toLowerCase().includes("dragonhd")
                ? voiceTemperature
                : undefined,
            }
            : (voiceName as Voice);
        if (enableSearch) {
          searchClientRef.current = new SearchClient(
            searchEndpoint,
            searchIndex,
            new AzureKeyCredential(searchApiKey)
          );
        }
        const session = await clientRef.current.configure({
          instructions: instructions?.length > 0 ? instructions : undefined,
          input_audio_transcription: {
            model: model.includes("realtime-preview")
              ? "whisper-1"
              : "azure-fast-transcription",
            language:
              recognitionLanguage === "auto" ? undefined : recognitionLanguage,
          },
          turn_detection: turnDetection,
          voice: voice,
          avatar: getAvatarConfig(),
          tools,
          temperature,
          modalities,
          input_audio_noise_reduction: useNS
            ? {
              type: "azure_deep_noise_suppression",
            }
            : null,
          input_audio_echo_cancellation: useEC
            ? {
              type: "server_echo_cancellation",
            }
            : null,
        });
        if (session?.avatar) {
          await getLocalDescription(session.avatar?.ice_servers);
        }

        startResponseListener();
        // Start recording the session
        if (audioHandlerRef.current) {
          audioHandlerRef.current.startSessionRecording();
        }

        setIsConnected(true);
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "status",
            content:
              "Session started, click on the mic button to start conversation! debug id: " +
              session.id,
          },
        ]);

        setSessionId(session.id);

        if (enableProactive) {
          proactiveManagerRef.current = new ProactiveEventManager(
            whenGreeting,
            whenInactive,
            10000
          );
          proactiveManagerRef.current.start();
        }
      } catch (error) {
        console.error("Connection failed:", error);
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "error",
            content: "Error connecting to the server: " + error,
          },
        ]);
      } finally {
        setIsConnecting(false);
      }
    } else {
      clearVideo();
      await disconnect();
    }
  };

  const whenGreeting = async () => {
    if (clientRef.current) {
      try {
        await clientRef.current.generateResponse({ additional_instructions: " Welcome the user." });
      } catch (error) {
        console.error("Error generating greeting message:", error);
      }
    }
  };

  const whenInactive = async () => {
    if (clientRef.current) {
      try {
        await clientRef.current.sendItem({
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: "User hasn't response for a while, please say something to continue the conversation.",
            },
          ],
        });
        await clientRef.current.generateResponse();
      } catch (error) {
        console.error("Error sending no activity message:", error);
      }
    }
  };

  const getAvatarConfig = () => {
    if (!isAvatar) {
      return undefined;
    }

    const videoParams: AvatarConfigVideoParams = {
      codec: "h264",
      crop: {
        top_left: [560, 0],
        bottom_right: [1360, 1080],
      },
      // uncomment the following to set avatar background color or image.
      // background: {
      // color: "#00FF00FF",
      //   image_url: new URL("https://sample-videos.com/img/Sample-jpg-image-50kb.jpg")
      // }
    };

    if (isCustomAvatar && customAvatarName) {
      return {
        character: customAvatarName,
        customized: true,
        video: videoParams,
      };
    } else if (isAvatar && !isCustomAvatar) {
      return {
        character: avatarName.split("-")[0].toLowerCase(),
        style: avatarName.split("-").slice(1).join("-"),
        video: videoParams,
      };
    } else {
      return undefined;
    }
  };

  const disconnect = async () => {
    if (clientRef.current) {
      try {
        await clientRef.current.close();
        clientRef.current = null;
        peerConnection = null as unknown as RTCPeerConnection;
        setIsConnected(false);
        audioHandlerRef.current?.stopStreamingPlayback();
        proactiveManagerRef.current?.stop();
        isUserSpeaking.current = false;
        audioHandlerRef.current?.stopRecordAnimation();
        audioHandlerRef.current?.stopPlayChunkAnimation();
        if (isRecording) {
          audioHandlerRef.current?.stopRecording();
          setIsRecording(false);
        }

        // Stop recording and check if there's any recorded audio
        if (audioHandlerRef.current) {
          audioHandlerRef.current.stopSessionRecording();
          setHasRecording(audioHandlerRef.current.hasRecordedAudio());
        }
      } catch (error) {
        console.error("Disconnect failed:", error);
      }
    }
  };

  const handleResponse = async (response: RTResponse) => {
    for await (const item of response) {
      if (item.type === "message" && item.role === "assistant") {
        const message: Message = {
          type: item.role,
          content: "",
        };
        setMessages((prevMessages) => [...prevMessages, message]);
        for await (const content of item) {
          if (content.type === "text") {
            for await (const text of content.textChunks()) {
              message.content += text;
              setMessages((prevMessages) => {
                if (prevMessages[prevMessages.length - 1]?.content) {
                  prevMessages[prevMessages.length - 1].content =
                    message.content;
                }
                return [...prevMessages];
              });
            }
          } else if (content.type === "audio") {
            const textTask = async () => {
              for await (const text of content.transcriptChunks()) {
                message.content += text;
                setMessages((prevMessages) => {
                  if (prevMessages[prevMessages.length - 1]?.content) {
                    prevMessages[prevMessages.length - 1].content =
                      message.content;
                  }
                  return [...prevMessages];
                });
              }
            };
            const audioTask = async () => {
              audioHandlerRef.current?.stopStreamingPlayback(); // stop any previous playback
              audioHandlerRef.current?.startStreamingPlayback();
              for await (const audio of content.audioChunks()) {
                audioHandlerRef.current?.playChunk(audio, async () => {
                  proactiveManagerRef.current?.updateActivity("agent speaking");
                });
              }
            };
            await Promise.all([textTask(), audioTask()]);
          }
        }
      } else if (isFunctionCallItem(item)) {
        await item.waitForCompletion();
        console.log("Function call output:", item);
        if (item.functionName === "get_time") {
          const formattedTime = new Date().toLocaleString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZoneName: "short",
          });
          console.log("Current time:", formattedTime);
          await clientRef.current?.sendItem({
            type: "function_call_output",
            output: formattedTime,
            call_id: item.callId,
          });
          await clientRef.current?.generateResponse();
        } else if (item.functionName === "search") {
          const query = JSON.parse(item.arguments).query;
          console.log("Search query:", query);
          if (searchClientRef.current) {
            setMessages((prevMessages) => [
              ...prevMessages,
              {
                type: "status",
                content: `Searching [${query}]...`,
              },
            ]);
            const searchResults = await searchClientRef.current.search(query, {
              top: 5,
              queryType: "semantic",
              semanticSearchOptions: {
                configurationName: "default", // this is hardcoded for now.
              },
              select: [searchContentField, searchIdentifierField],
            });
            let resultText = "";
            for await (const result of searchResults.results) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const document = result.document as any;
              resultText += `[${document[searchIdentifierField]}]: ${document[searchContentField]}\n-----\n`;
            }
            console.log("Search results:", resultText);
            await clientRef.current?.sendItem({
              type: "function_call_output",
              output: resultText,
              call_id: item.callId,
            });
            await clientRef.current?.generateResponse();
          }
        }
      }
    }
    if (response.status === "failed") {
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          type: "error",
          content: "Response failed:" + JSON.stringify(response.statusDetails),
        },
      ]);
    }
  };

  const handleInputAudio = async (item: RTInputAudioItem) => {
    isUserSpeaking.current = true;
    audioHandlerRef.current?.stopStreamingPlayback();
    await item.waitForCompletion();
    isUserSpeaking.current = false;
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        type: "user",
        content: item.transcription || "",
      },
    ]);
  };

  const startResponseListener = async () => {
    if (!clientRef.current) return;

    try {
      for await (const serverEvent of clientRef.current.events()) {
        if (serverEvent.type === "response") {
          await handleResponse(serverEvent);
        } else if (serverEvent.type === "input_audio") {
          proactiveManagerRef.current?.updateActivity("user start to speak"); // user started to speak
          await handleInputAudio(serverEvent);
        }
      }
    } catch (error) {
      if (clientRef.current) {
        console.error("Response iteration error:", error);
      }
    }
  };

  const sendMessage = async () => {
    if (currentMessage.trim() && clientRef.current) {
      try {
        const temporaryStorageMessage = currentMessage;
        setCurrentMessage("");
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "user",
            content: temporaryStorageMessage,
          },
        ]);

        await clientRef.current.sendItem({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: temporaryStorageMessage }],
        });
        await clientRef.current.generateResponse();
      } catch (error) {
        console.error("Failed to send message:", error);
      }
    }
  };

  const toggleRecording = async () => {
    if (!isRecording && clientRef.current) {
      try {
        if (!audioHandlerRef.current) {
          audioHandlerRef.current = new AudioHandler();
          await audioHandlerRef.current.initialize();
        }
        await audioHandlerRef.current.startRecording(async (chunk) => {
          await clientRef.current?.sendAudio(chunk);
          if (isUserSpeaking.current) {
            proactiveManagerRef.current?.updateActivity("user speaking");
          }
        });
        setIsRecording(true);
      } catch (error) {
        console.error("Failed to start recording:", error);
      }
    } else if (audioHandlerRef.current) {
      try {
        audioHandlerRef.current.stopRecording();
        audioHandlerRef.current.stopRecordAnimation();
        if (turnDetectionType === null) {
          const inputAudio = await clientRef.current?.commitAudio();
          proactiveManagerRef.current?.updateActivity("user speaking");
          await handleInputAudio(inputAudio!);
          await clientRef.current?.generateResponse();
        }
        setIsRecording(false);
      } catch (error) {
        console.error("Failed to stop recording:", error);
      }
    }
  };

  const getLocalDescription = (ice_servers?: RTCIceServer[]) => {
    console.log("Received ICE servers" + JSON.stringify(ice_servers));

    peerConnection = new RTCPeerConnection({ iceServers: ice_servers });

    setupPeerConnection();

    peerConnection.onicegatheringstatechange = (): void => {
      if (peerConnection.iceGatheringState === "complete") {
      }
    };

    peerConnection.onicecandidate = (
      event: RTCPeerConnectionIceEvent
    ): void => {
      if (!event.candidate) {
      }
    };

    setRemoteDescription();
  };

  const setRemoteDescription = async () => {
    try {
      const sdp = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(sdp);

      // sleep 2 seconds to wait for ICE candidates to be gathered
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log(clientRef.current);

      const remoteDescription = await clientRef.current?.connectAvatar(
        peerConnection.localDescription as RTCSessionDescription
      );
      await peerConnection.setRemoteDescription(
        remoteDescription as RTCSessionDescriptionInit
      );
    } catch (error) {
      console.error("Connection failed:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          type: "error",
          content: "Error establishing avatar connection: " + error,
        },
      ]);
    }
  };

  const setupPeerConnection = () => {
    clearVideo();

    peerConnection.ontrack = function (event) {
      const mediaPlayer = document.createElement(
        event.track.kind
      ) as HTMLMediaElement;
      mediaPlayer.id = event.track.kind;
      mediaPlayer.srcObject = event.streams[0];
      mediaPlayer.autoplay = true;
      videoRef?.current?.appendChild(mediaPlayer);
    };

    peerConnection.addTransceiver("video", { direction: "sendrecv" });
    peerConnection.addTransceiver("audio", { direction: "sendrecv" });

    peerConnection.addEventListener("datachannel", (event) => {
      const dataChannel = event.channel;
      dataChannel.onmessage = (e) => {
        console.log(
          "[" + new Date().toISOString() + "] WebRTC event received: " + e.data
        );
      };
      dataChannel.onclose = () => {
        console.log("Data channel closed");
      };
    });
    peerConnection.createDataChannel("eventChannel");
  };

  const clearVideo = () => {
    const videoElement = videoRef?.current;

    // Clean up existing video element if there is any
    if (videoElement?.innerHTML) {
      videoElement.innerHTML = "";
    }
  };

  const downloadRecording = () => {
    if (audioHandlerRef.current) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      audioHandlerRef.current.downloadRecording(
        `conversation-${timestamp}`,
        sessionId
      );
    }
  };

  useEffect(() => {
    const initAudioHandler = async () => {
      const handler = new AudioHandler();
      await handler.initialize();
      audioHandlerRef.current = handler;
    };

    initAudioHandler().catch(console.error);

    return () => {
      disconnect();
      audioHandlerRef.current?.close().catch(console.error);
    };
  }, []);

  useEffect(() => {
    const element = document.getElementById("messages-area");
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    // Function to detect mobile devices
    const checkForMobileDevice = () => {
      const userAgent = navigator.userAgent;
      const isMobileCheck =
        /iPad|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(
          userAgent
        );
      setIsMobile(isMobileCheck);
    };

    // Run the check when component mounts
    checkForMobileDevice();

    // Optionally, could add window resize listener here if needed
    // to detect orientation changes or responsive breakpoints
  }, []);

  useEffect(() => {
    const element = animationRef.current;
    if (isConnected && element && !isEnableAvatar) {
      audioHandlerRef.current?.setCircleElement(element);
    } else {
      audioHandlerRef.current?.setCircleElement(null);
    }
  }, [isConnected, isEnableAvatar]);

  useEffect(() => {
    if (isConnected && isEnableAvatar && isRecording) {
      intervalId = setInterval(() => {
        for (let i = 0; i < 20; i++) {
          const ele = document.getElementById(`item-${i}`);
          const height = 50 * Math.sin((Math.PI / 20) * i) * Math.random();
          if (ele) {
            ele.style.transition = "height 0.15s ease";
            ele.style.height = `${height}px`;
          }
        }
      }, 150);
    } else {
      if (intervalId) {
        clearInterval(intervalId);
      }
    }
  }, [isConnected, isEnableAvatar, isRecording]);

  // Apply settings from a predefined scenario
  const applyScenario = (scenarioKey: string) => {
    const scenario = predefinedScenarios[scenarioKey];
    if (!scenario) return;

    // Apply instructions
    if (scenario.instructions) {
      setInstructions(scenario.instructions);
    }

    // Apply proactive setting
    if (scenario.pro_active !== undefined) {
      setEnableProactive(scenario.pro_active);
    }

    // Apply voice settings
    if (scenario.voice) {
      if (scenario.voice.custom_voice) {
        setUseCNV(true);
        if (scenario.voice.deployment_id) {
          setVoiceDeploymentId(scenario.voice.deployment_id);
        }
        if (scenario.voice.voice_name) {
          setCustomVoiceName(scenario.voice.voice_name);
        }
        if (scenario.voice.temperature) {
          setVoiceTemperature(scenario.voice.temperature);
        }
      } else {
        setUseCNV(false);
        if (scenario.voice.voice_name) {
          setVoiceName(scenario.voice.voice_name);
        }
      }
    }

    // Apply avatar settings
    if (scenario.avatar) {
      setIsAvatar(scenario.avatar.enabled);
      if (scenario.avatar.enabled) {
        setIsCustomAvatar(scenario.avatar.customized);
        if (scenario.avatar.customized) {
          setCustomAvatarName(scenario.avatar.avatar_name);
        } else {
          setAvatarName(scenario.avatar.avatar_name);
        }
      }
    } else {
      setIsAvatar(false);
    }

    // Update selected scenario
    setSelectedScenario(scenarioKey);
  };

  // Returns true if agent mode is enabled or a cascaded model is selected
  function isCascaded(mode: "model" | "agent", model: string): boolean {
    if (mode === "agent") return true;
    // Add all cascaded model names here
    const cascadedModels = [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "phi4-mini",
    ];
    return cascadedModels.includes(model);
  }

  function handleSettings() {
    if (settingsRef.current) {
      if (isSettings) {
        settingsRef.current.style.display = "block";
        setIsSettings(false);
      } else {
        settingsRef.current.style.display = "none";
        setIsSettings(true);
      }
    }
  }

  return (
    <div className="flex h-screen">
      {/* Parameters Panel */}
      <div
        className="w-80 bg-gray-50 p-4 flex flex-col border-r"
        ref={settingsRef}
      >
        <div className="flex-1 overflow-y-auto">
          <Accordion type="single" collapsible className="space-y-4">
            {/* Instructions */}
            <AccordionItem value="instructions">
              <AccordionTrigger className="text-lg font-semibold">
                Instructions
              </AccordionTrigger>
              <AccordionContent>
                <div className="w-full min-h-[200px] p-4 border rounded bg-gray-50 font-sans text-sm text-gray-800 overflow-auto">
                  <ReactMarkdown
                    components={{
                      ol: ({ ...props }) => (
                        <ol className="list-decimal ml-6" {...props} />
                      ),
                      ul: ({ ...props }) => (
                        <ul className="list-disc ml-6" {...props} />
                      ),
                      li: ({ ...props }) => <li className="mb-1" {...props} />,
                      p: ({ ...props }) => <p className="my-2" {...props} />,
                    }}
                  >
                    {readme}
                  </ReactMarkdown>
                </div>
              </AccordionContent>
            </AccordionItem>
            {/* Connection Settings */}
            <AccordionItem value="connection">
              <AccordionTrigger className="text-lg font-semibold">
                Connection Settings
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                {/* Mode Switch */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Mode</label>
                  <Select
                    value={mode}
                    onValueChange={(v) => setMode(v as "model" | "agent")}
                    disabled={isConnected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="model">Model</SelectItem>
                      <SelectItem value="agent">Agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Always show endpoint and subscription key */}
                <Input
                  placeholder="Azure AI Services Endpoint"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  disabled={isConnected || configLoaded}
                />
                {(!configLoaded && mode === "model") && (
                  <Input
                    placeholder="Subscription Key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={isConnected}
                  />
                )}
                { mode === "agent" && (
                  <Input
                    placeholder="Entra Token"
                    value={entraToken}
                    onChange={(e) => setEntraToken(e.target.value)}
                    disabled={isConnected}
                  />
                )}
                {/* Entra token input */}
                {/* Show agent fields if agent mode */}
                {mode === "agent" ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Agent</label>
                    </div>
                    <Input
                      placeholder="Agent Project Name"
                      value={agentProjectName}
                      onChange={(e) => setAgentProjectName(e.target.value)}
                      disabled={isConnected}
                    />
                    {/* Agent ID as Select if agents available, else Input */}
                    {agents.length > 0 ? (
                      <Select
                        value={agentId}
                        onValueChange={setAgentId}
                        disabled={isConnected}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select Agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name || agent.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="Agent ID"
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                        disabled={isConnected}
                      />
                    )}
                    {/* <Input
                      placeholder="Agent Access Token"
                      value={agentAccessToken}
                      onChange={(e) => setAgentAccessToken(e.target.value)}
                      disabled={isConnected}
                    /> */}
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Model</label>
                      <Select
                        value={model}
                        onValueChange={setModel}
                        disabled={isConnected}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gpt-4o-realtime-preview">
                            GPT-4o Realtime
                          </SelectItem>
                          <SelectItem value="gpt-4o-mini-realtime-preview">
                            GPT-4o Mini Realtime
                          </SelectItem>
                          <SelectItem value="gpt-4.1">
                            GPT-4.1 (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4.1-mini">
                            GPT-4.1 Mini (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4.1-nano">
                            GPT-4.1 Nano (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4o">
                            GPT-4o (Cascaded)
                          </SelectItem>
                          <SelectItem value="gpt-4o-mini">
                            GPT-4o Mini (Cascaded)
                          </SelectItem>
                          <SelectItem value="phi4-mm">
                            Phi4-MM Realtime
                          </SelectItem>
                          <SelectItem value="phi4-mini">
                            Phi4 Mini (Cascaded)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </AccordionContent>
            </AccordionItem>
            {/* Conversation Settings */}
            <AccordionItem value="conversation">
              <AccordionTrigger className="text-lg font-semibold">
                Conversation Settings
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                {/* Predefined Scenarios dropdown */}
                {Object.keys(predefinedScenarios).length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Predefined Scenarios
                    </label>
                    <Select
                      value={selectedScenario}
                      onValueChange={(value) => applyScenario(value)}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a predefined scenario" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(predefinedScenarios).map(
                          ([key, scenario]) => (
                            <SelectItem key={key} value={key}>
                              {scenario.name || key}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {/* {selectedScenario && (
                      <div className="text-xs text-gray-500 italic mt-1">
                        Applied settings from "{selectedScenario}" scenario
                      </div>
                    )} */}
                  </div>
                )}

                {/* Recognition Language selection - only show if cascaded/agent */}
                {isCascaded(mode, model) && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Recognition Language
                    </label>
                    <Select
                      value={recognitionLanguage}
                      onValueChange={setRecognitionLanguage}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableLanguages.map((lang) => (
                          <SelectItem key={lang.id} value={lang.id}>
                            {lang.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Noise suppression</span>
                  <Switch
                    checked={useNS}
                    onCheckedChange={setUseNS}
                    disabled={isConnected}
                  />
                </div>
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Echo cancellation</span>
                  <Switch
                    checked={useEC}
                    onCheckedChange={setUseEC}
                    disabled={isConnected}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Turn detection</label>
                  <Select
                    value={
                      turnDetectionType === null
                        ? "none"
                        : turnDetectionType.type
                    }
                    onValueChange={(value: string) => {
                      setTurnDetectionType(
                        value === "none"
                          ? null
                          : ({ type: value } as TurnDetection)
                      );
                    }}
                    disabled={isConnected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTurnDetection.map((td) => (
                        <SelectItem key={td.id} value={td.id}>
                          {td.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {turnDetectionType?.type === "azure_semantic_vad" && (
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span>Remove filler words</span>
                      <Switch
                        checked={removeFillerWords}
                        onCheckedChange={setRemoveFillerWords}
                        disabled={isConnected}
                      />
                    </div>
                  )}
                </div>
                {isCascaded(mode, model) && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">EOU detection</label>
                    <Select
                      value={eouDetectionType}
                      onValueChange={setEouDetectionType}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableEouDetection.map((eou) => (
                          <SelectItem
                            key={eou.id}
                            value={eou.id}
                            disabled={eou.disabled}
                          >
                            {eou.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* Model instructions - only show in model mode */}
                {mode === "model" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Model instructions
                    </label>
                    <textarea
                      className="w-full min-h-[100px] p-2 border rounded"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      disabled={isConnected}
                    />
                  </div>
                )}
                {mode === "model" && (
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>Enable proactive responses</span>
                    <Switch
                      checked={enableProactive}
                      onCheckedChange={setEnableProactive}
                      disabled={isConnected}
                    />
                  </div>
                )}
                {/* Tools - only show in model mode */}
                {mode === "model" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tools</label>
                    {/* Add predefined tool selection */}
                    <div className="mb-2">
                      <div className="border rounded-md">
                        <div className="p-2 font-medium">
                          Add predefined tools
                        </div>
                        <div className="border-t p-2 space-y-2 max-h-48 overflow-y-auto">
                          {predefinedTools.map((tool) => (
                            <div
                              key={tool.id}
                              className="flex items-center space-x-2"
                            >
                              <input
                                type="checkbox"
                                id={tool.id}
                                className="rounded"
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setTools([...tools, tool.tool]);
                                  } else {
                                    setTools(
                                      tools.filter(
                                        (t) => t.name !== tool.tool.name
                                      )
                                    );
                                  }
                                  console.log("Tools: ", tools);
                                  if (tool.id === "search") {
                                    setEnableSearch(e.target.checked);
                                  }
                                }}
                                disabled={isConnected || !tool.enabled}
                              />
                              <label htmlFor={tool.id} className="text-sm">
                                {tool.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* if search enabled, let user input search endpoint, index, and key */}
                    {enableSearch && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Azure Search setting
                        </label>
                        <Input
                          placeholder="Search Endpoint"
                          value={searchEndpoint}
                          onChange={(e) => setSearchEndpoint(e.target.value)}
                          disabled={isConnected}
                        />
                        <Input
                          placeholder="Search Index"
                          value={searchIndex}
                          onChange={(e) => setSearchIndex(e.target.value)}
                          disabled={isConnected}
                        />
                        <Input
                          placeholder="Search Key"
                          value={searchApiKey}
                          onChange={(e) => setSearchApiKey(e.target.value)}
                          disabled={isConnected}
                        />
                        <Input
                          placeholder="Search Content Field (default: chunk)"
                          value={searchContentField}
                          onChange={(e) =>
                            setSearchContentField(e.target.value)
                          }
                          disabled={isConnected}
                        />
                        <Input
                          placeholder="Search Identifier Field (default: chunk_id)"
                          value={searchIdentifierField}
                          onChange={(e) =>
                            setSearchIdentifierField(e.target.value)
                          }
                          disabled={isConnected}
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Temperature ({temperature})
                  </label>
                  <Slider
                    value={[temperature]}
                    onValueChange={([value]) => setTemperature(value)}
                    min={0.6}
                    max={1.2}
                    step={0.1}
                    disabled={isConnected}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Use Custom Voice</span>
                  <Switch
                    checked={useCNV}
                    onCheckedChange={setUseCNV}
                    disabled={isConnected}
                  />
                </div>
                {useCNV && (
                  <>
                    <Input
                      placeholder="Voice Deployment ID"
                      value={voiceDeploymentId}
                      onChange={(e) => setVoiceDeploymentId(e.target.value)}
                      disabled={isConnected}
                    />
                    <Input
                      placeholder="Voice"
                      value={customVoiceName}
                      onChange={(e) => setCustomVoiceName(e.target.value)}
                      disabled={isConnected}
                    />
                  </>
                )}
                {!useCNV && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Voice</label>
                    <Select
                      value={voiceName}
                      onValueChange={setVoiceName}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableVoices
                          .filter(
                            (voice) =>
                              !(
                                isCascaded(mode, model) && !voice.id.includes("-")
                              )
                          )
                          .map((voice) => (
                            <SelectItem key={voice.id} value={voice.id}>
                              {voice.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {((useCNV &&
                  customVoiceName.toLowerCase().includes("dragonhd")) ||
                  (!useCNV &&
                    voiceName.toLowerCase().includes("dragonhd"))) && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Voice Temperature ({voiceTemperature})
                      </label>
                      <Slider
                        value={[voiceTemperature]}
                        onValueChange={([value]) => setVoiceTemperature(value)}
                        min={0.0}
                        max={1.0}
                        step={0.1}
                        disabled={isConnected}
                      />
                    </div>
                  )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span style={{ marginRight: 10 }}>Avatar</span>
                      <Switch
                        checked={isAvatar}
                        onCheckedChange={(checked: boolean) =>
                          setIsAvatar(checked)
                        }
                        disabled={isConnected}
                      />
                    </div>
                    {isAvatar && (
                      <div className="flex items-center">
                        <span style={{ marginRight: 10 }}>
                          Use Custom Avatar
                        </span>
                        <Switch
                          checked={isCustomAvatar}
                          onCheckedChange={(checked: boolean) =>
                            setIsCustomAvatar(checked)
                          }
                          disabled={isConnected}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  {isAvatar && !isCustomAvatar && (
                    <Select
                      value={avatarName}
                      onValueChange={setAvatarName}
                      disabled={isConnected}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {avatarNames.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {isAvatar && isCustomAvatar && (
                    <Input
                      placeholder="Character"
                      value={customAvatarName}
                      onChange={(e) => setCustomAvatarName(e.target.value)}
                      disabled={isConnected}
                    />
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Connect Button and Download Recording Button */}
        <div className="mt-4 space-y-2">
          <Button
            className="w-full"
            variant={isConnected ? "destructive" : "default"}
            onClick={handleConnect}
            disabled={isConnecting}
          >
            <Power className="w-4 h-4 mr-2" />
            {isConnecting
              ? "Connecting..."
              : isConnected
                ? "Disconnect"
                : "Connect"}
          </Button>

          {hasRecording && !isConnected && (
            <Button
              className="w-full"
              variant="outline"
              onClick={downloadRecording}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mr-2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download Recording
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          {/* Settings */}
          {isMobile && (
            <div
              className="flex items-center settings"
              role="button"
              onClick={handleSettings}
            >
              <span className="settings-svg">{settingsSvg()}</span>
              <span>Settings</span>
            </div>
          )}

          {/* Developer Mode */}
          <div className="flex items-center">
            <span className="developer-mode">Developer mode</span>
            <Switch
              checked={isDevelop}
              onCheckedChange={(checked: boolean) => setIsDevelop(checked)}
            />
          </div>

          {/* Clear Chat */}
          <div>
            <button
              style={{ opacity: messages.length > 0 ? "" : "0.5" }}
              onClick={() => messages.length > 0 && setMessages([])}
            >
              {clearChatSvg()}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={`flex ${isDevelop ? "developer-content" : "content"}`}>
          {isConnected &&
            (isEnableAvatar ? (
              <>
                {/* Video Window */}
                <div
                  ref={videoRef}
                  className={`flex flex-1 justify-center items-center`}
                ></div>
              </>
            ) : (
              <>
                {/* Animation Window */}
                <div className="flex flex-1 justify-center items-center">
                  <div
                    key="volume-circle"
                    ref={animationRef}
                    className="volume-circle"
                  ></div>
                  <div className="robot-svg">{robotSvg()}</div>
                </div>
              </>
            ))}

          {(isDevelop || !isConnected) && (
            <>
              {/* Chat Window */}
              <div className="flex flex-1 flex-col">
                {/* Messages Area */}
                <div
                  id="messages-area"
                  className="flex-1 p-4 overflow-y-auto messages-area"
                >
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`mb-4 p-3 rounded-lg ${getMessageClassNames(message.type)}`}
                    >
                      {message.content}
                    </div>
                  ))}
                </div>
                {isDevelop && (
                  <>
                    {/* Input Area */}
                    <div className="p-4 border-t">
                      <div className="flex gap-2">
                        <Input
                          value={currentMessage}
                          onChange={(e) => setCurrentMessage(e.target.value)}
                          placeholder="Type your message..."
                          onKeyUp={(e) => e.key === "Enter" && sendMessage()}
                          disabled={!isConnected}
                        />
                        <Button
                          variant="outline"
                          onClick={toggleRecording}
                          className={isRecording ? "bg-red-100" : ""}
                          disabled={!isConnected}
                        >
                          {isRecording ? recordingSvg() : offSvg()}
                        </Button>
                        <Button onClick={sendMessage} disabled={!isConnected}>
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isDevelop && (
          <>
            {/* Record Button */}
            <div className="flex flex-1 justify-center items-center">
              <div className="flex justify-center items-center recording-border">
                {isConnected && isEnableAvatar && isRecording && (
                  <div className="flex justify-center items-center sound-wave">
                    <div className="sound-wave-item" id="item-0"></div>
                    <div className="sound-wave-item" id="item-1"></div>
                    <div className="sound-wave-item" id="item-2"></div>
                    <div className="sound-wave-item" id="item-3"></div>
                    <div className="sound-wave-item" id="item-4"></div>
                    <div className="sound-wave-item" id="item-5"></div>
                    <div className="sound-wave-item" id="item-6"></div>
                    <div className="sound-wave-item" id="item-7"></div>
                    <div className="sound-wave-item" id="item-8"></div>
                    <div className="sound-wave-item" id="item-9"></div>
                  </div>
                )}
                <Button
                  variant="outline"
                  onClick={toggleRecording}
                  className={isRecording ? "bg-red-100" : ""}
                  disabled={!isConnected}
                >
                  {isRecording ? (
                    <div className="flex justify-center items-center">
                      {recordingSvg()}
                      <span className="microphone">Turn off microphone</span>
                    </div>
                  ) : (
                    <div className="flex justify-center items-center">
                      {offSvg()}
                      <span className="microphone">Turn on microphone</span>
                    </div>
                  )}
                </Button>
                {isConnected && isEnableAvatar && isRecording && (
                  <div className="flex justify-center items-center sound-wave sound-wave2">
                    <div className="sound-wave-item" id="item-10"></div>
                    <div className="sound-wave-item" id="item-11"></div>
                    <div className="sound-wave-item" id="item-12"></div>
                    <div className="sound-wave-item" id="item-13"></div>
                    <div className="sound-wave-item" id="item-14"></div>
                    <div className="sound-wave-item" id="item-15"></div>
                    <div className="sound-wave-item" id="item-16"></div>
                    <div className="sound-wave-item" id="item-17"></div>
                    <div className="sound-wave-item" id="item-18"></div>
                    <div className="sound-wave-item" id="item-19"></div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatInterface;
