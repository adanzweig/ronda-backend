import { MessageUpsertType, proto, WASocket } from "@whiskeysockets/baileys";
import {
  convertTextToSpeechAndSaveToFile,
  getBodyMessage,
  keepOnlySpecifiedChars,
  transferQueue,
  verifyMediaMessage,
  verifyMessage,
} from "../WbotServices/wbotMessageListener";
import { isNil, isNull } from "lodash";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import TicketTraking from "../../models/TicketTraking";

type Session = WASocket & {
  id?: number;
};

interface ImessageUpsert {
  messages: proto.IWebMessageInfo[];
  type: MessageUpsertType;
}

interface IOpenAi {
  name: string;
  prompt: string;
  voice: string;
  voiceKey: string;
  voiceRegion: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
  queueId: number;
  maxMessages: number;
  model: string;
  openAiApiKey?: string;
}

interface SessionOpenAi extends OpenAI {
  id?: number;
}

interface SessionGemini extends GoogleGenerativeAI {
  id?: number;
}

const sessionsOpenAi: SessionOpenAi[] = [];
const sessionsGemini: SessionGemini[] = [];

const deleteFileSync = (path: string): void => {
  try {
    fs.unlinkSync(path);
  } catch (error) {
    console.error("Erro ao deletar o arquivo:", error);
  }
};

const sanitizeName = (name: string): string => {
  let sanitized = name.split(" ")[0];
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
};

// Prepares the AI messages from past messages
const prepareMessagesAI = (pastMessages: Message[], isGeminiModel: boolean, promptSystem: string): any[] => {
  const messagesAI = [];

  // For OpenAI, include the system prompt as a 'system' role
  if (!isGeminiModel) {
    messagesAI.push({ role: "system", content: promptSystem });
  }

  // Map past messages to AI message format
  for (const message of pastMessages) {
    if (message.mediaType === "conversation" || message.mediaType === "extendedTextMessage") {
      if (message.fromMe) {
        messagesAI.push({ role: "assistant", content: message.body });
      } else {
        messagesAI.push({ role: "user", content: message.body });
      }
    }
  }

  return messagesAI;
};

// Processes the AI response (text or audio)
const processResponse = async (
  responseText: string,
  wbot: Session,
  msg: proto.IWebMessageInfo,
  ticket: Ticket,
  contact: Contact,
  openAiSettings: IOpenAi,
  ticketTraking: TicketTraking
): Promise<void> => {
  let response = responseText;

  // Check for transfer action trigger
  if (response?.toLowerCase().includes("Acción: Transferir al sector de atención")) {
    await transferQueue(openAiSettings.queueId, ticket, contact);
    response = response.replace(/Acción: Transferir al sector de atención/i, "").trim();
  }

  const publicFolder: string = path.resolve(__dirname, "..", "..", "..", "public", `company${ticket.companyId}`);

  // Send response based on preferred format (text or voice)
  if (openAiSettings.voice === "texto") {
    const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
      text: `\u200e ${response}`,
    });
    await verifyMessage(sentMessage!, ticket, contact);
  } else {
    const fileNameWithOutExtension = `${ticket.id}_${Date.now()}`;
    try {
      await convertTextToSpeechAndSaveToFile(
        keepOnlySpecifiedChars(response),
        `${publicFolder}/${fileNameWithOutExtension}`,
        openAiSettings.voiceKey,
        openAiSettings.voiceRegion,
        openAiSettings.voice,
        "mp3"
      );
      const sendMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        audio: { url: `${publicFolder}/${fileNameWithOutExtension}.mp3` },
        mimetype: "audio/mpeg",
        ptt: true,
      });
      await verifyMediaMessage(sendMessage!, ticket, contact, ticketTraking, false, false, wbot);
      deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.mp3`);
      deleteFileSync(`${publicFolder}/${fileNameWithOutExtension}.wav`);
    } catch (error) {
      console.error(`Erro para responder com audio: ${error}`);
      // Fallback to text response
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `\u200e ${response}`,
      });
      await verifyMessage(sentMessage!, ticket, contact);
    }
  }
};

// Handles OpenAI request
const handleOpenAIRequest = async (openai: SessionOpenAi, messagesAI: any[], openAiSettings: IOpenAi): Promise<string> => {
  try {
    const chat = await openai.chat.completions.create({
      model: openAiSettings.model,
      messages: messagesAI,
      max_tokens: openAiSettings.maxTokens,
      temperature: openAiSettings.temperature,
    });
    return chat.choices[0].message?.content || "";
  } catch (error) {
    console.error("OpenAI request error:", error);
    throw error;
  }
};

// Handles Gemini request
const handleGeminiRequest = async (
  gemini: SessionGemini,
  messagesAI: any[],
  openAiSettings: IOpenAi,
  bodyMessage: string,
  promptSystem: string
): Promise<string> => {
  try {
    const model = gemini.getGenerativeModel({
      model: openAiSettings.model,
      systemInstruction: promptSystem, // Use system instruction for Gemini
    });

    // Map messages to Gemini format
    const geminiHistory = messagesAI.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(bodyMessage);
    return result.response.text();
  } catch (error) {
    console.error("Gemini request error:", error);
    throw error;
  }
};

// Main function to handle AI interactions
export const handleOpenAi = async (
  openAiSettings: IOpenAi,
  msg: proto.IWebMessageInfo,
  wbot: Session,
  ticket: Ticket,
  contact: Contact,
  mediaSent: Message | undefined,
  ticketTraking: TicketTraking
): Promise<void> => {
  if (contact.disableBot) {
    return;
  }

  const bodyMessage = getBodyMessage(msg);
  if (!bodyMessage && !msg.message?.audioMessage) return;

  if (!openAiSettings) return;

  if (msg.messageStubType) return;

  const publicFolder: string = path.resolve(__dirname, "..", "..", "..", "public", `company${ticket.companyId}`);

  const isOpenAIModel = ["gpt-3.5-turbo-1106", "gpt-4o"].includes(openAiSettings.model);
  const isGeminiModel = ["gemini-2.0-pro", "gemini-2.0-flash"].includes(openAiSettings.model);

  let openai: SessionOpenAi | null = null;
  let gemini: SessionGemini | null = null;

  // Initialize AI provider based on model
  if (isOpenAIModel) {
    const openAiIndex = sessionsOpenAi.findIndex(s => s.id === ticket.id);
    if (openAiIndex === -1) {
      openai = new OpenAI({ apiKey: openAiSettings.apiKey }) as SessionOpenAi;
      openai.id = ticket.id;
      sessionsOpenAi.push(openai);
    } else {
      openai = sessionsOpenAi[openAiIndex];
    }
  } else if (isGeminiModel) {
    const geminiIndex = sessionsGemini.findIndex(s => s.id === ticket.id);
    if (geminiIndex === -1) {
      gemini = new GoogleGenerativeAI(openAiSettings.apiKey) as SessionGemini;
      gemini.id = ticket.id;
      sessionsGemini.push(gemini);
    } else {
      gemini = sessionsGemini[geminiIndex];
    }
  } else {
    console.error(`Unsupported model: ${openAiSettings.model}`);
    return;
  }

  // Initialize OpenAI for transcription if specified
  if (isOpenAIModel && openAiSettings.openAiApiKey && !openai) {
    const openAiIndex = sessionsOpenAi.findIndex(s => s.id === ticket.id);
    if (openAiIndex === -1) {
      openai = new OpenAI({ apiKey: openAiSettings.openAiApiKey || openAiSettings.apiKey }) as SessionOpenAi;
      openai.id = ticket.id;
      sessionsOpenAi.push(openai);
    } else {
      openai = sessionsOpenAi[openAiIndex];
    }
  }

  // Fetch past messages
  const messages = await Message.findAll({
    where: { ticketId: ticket.id },
    order: [["createdAt", "ASC"]],
    limit: openAiSettings.maxMessages,
  });

  // Format system prompt
  const clientName = sanitizeName(contact.name || "Amigo(a)");
  const promptSystem = `Instrucciones del sistema:
- Usa el nombre ${clientName} en las respuestas para que el cliente se sienta más cercano y bien atendido.
- Asegúrate de que la respuesta tenga hasta ${openAiSettings.maxTokens} tokens y esté completa.
- Si no sabes el nombre, pregúntalo.
- Si es necesario transferir, empieza con 'Acción: Transferir al sector de atención'.

Prompt específico:
${openAiSettings.prompt}

Sigue estas instrucciones para asegurar una atención clara y amable.`;

  // Handle text message
  if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
    const messagesAI = prepareMessagesAI(messages, isGeminiModel, promptSystem);

    try {
      let responseText: string | null = null;

      if (isOpenAIModel && openai) {
        messagesAI.push({ role: "user", content: bodyMessage! });
        responseText = await handleOpenAIRequest(openai, messagesAI, openAiSettings);
      } else if (isGeminiModel && gemini) {
        responseText = await handleGeminiRequest(gemini, messagesAI, openAiSettings, bodyMessage!, promptSystem);
      }

      if (!responseText) {
        console.error("No response from AI provider");
        return;
      }

      await processResponse(responseText, wbot, msg, ticket, contact, openAiSettings, ticketTraking);
    } catch (error: any) {
      console.error("AI request failed:", error);
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: "Disculpe, estoy con dificultades técnicas para processar su solicitud en este momento. Por favor, intente nuevamente más tarde.",
      });
      await verifyMessage(sentMessage!, ticket, contact);
    }
  }
  // Handle audio message
  else if (msg.message?.audioMessage && mediaSent) {
    const messagesAI = prepareMessagesAI(messages, isGeminiModel, promptSystem);

    try {
      const mediaUrl = mediaSent.mediaUrl!.split("/").pop();
      const audioFilePath = `${publicFolder}/${mediaUrl}`;

      if (!fs.existsSync(audioFilePath)) {
        console.error(`Arquivo de áudio não encontrado: ${audioFilePath}`);
        const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
          text: "Disculpe, no se pudo procesar su audio. Por favor, intente nuevamente.",
        });
        await verifyMessage(sentMessage!, ticket, contact);
        return;
      }

      let transcription: string | null = null;

      if (isOpenAIModel && openai) {
        const file = fs.createReadStream(audioFilePath) as any;
        const transcriptionResult = await openai.audio.transcriptions.create({
          model: "whisper-1",
          file: file,
        });
        transcription = transcriptionResult.text;

        const sentTranscriptMessage = await wbot.sendMessage(msg.key.remoteJid!, {
          text: `🎤 *Sua mensagem de voz:* ${transcription}`,
        });
        await verifyMessage(sentTranscriptMessage!, ticket, contact);

        messagesAI.push({ role: "user", content: transcription });
        const responseText = await handleOpenAIRequest(openai, messagesAI, openAiSettings);
        if (responseText) {
          await processResponse(responseText, wbot, msg, ticket, contact, openAiSettings, ticketTraking);
        }
      } else if (isGeminiModel && gemini) {
        const model = gemini.getGenerativeModel({
          model: openAiSettings.model,
          systemInstruction: promptSystem,
        });

        const audioFileBase64 = fs.readFileSync(audioFilePath, { encoding: 'base64' });
        const fileExtension = path.extname(audioFilePath).toLowerCase();
        let mimeType = 'audio/mp3';
        switch (fileExtension) {
          case '.wav': mimeType = 'audio/wav'; break;
          case '.mp3': mimeType = 'audio/mp3'; break;
          case '.aac': mimeType = 'audio/aac'; break;
          case '.ogg': mimeType = 'audio/ogg'; break;
          case '.flac': mimeType = 'audio/flac'; break;
          case '.aiff': mimeType = 'audio/aiff'; break;
        }

        const transcriptionRequest = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { text: "Gere uma transcrição precisa deste áudio." },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: audioFileBase64,
                  },
                },
              ],
            },
          ],
        });

        transcription = transcriptionRequest.response.text();

        const sentTranscriptMessage = await wbot.sendMessage(msg.key.remoteJid!, {
          text: `🎤 *Su mensaje de voz:* ${transcription}`,
        });
        await verifyMessage(sentTranscriptMessage!, ticket, contact);

        messagesAI.push({ role: "user", content: transcription });
        const responseText = await handleGeminiRequest(gemini, messagesAI, openAiSettings, transcription, promptSystem);
        if (responseText) {
          await processResponse(responseText, wbot, msg, ticket, contact, openAiSettings, ticketTraking);
        }
      }

      if (!transcription) {
        console.warn("Transcripción vacía recibida");
        const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
          text: "Disculpe, no conseguí entender el audio. Por favor, intente nuevamente o envíe un mensaje de texto.",
        });
        await verifyMessage(sentMessage!, ticket, contact);
      }
    } catch (error: any) {
      console.error("Error en el procesamiento de audio:", error);
      const errorMessage = error?.response?.error?.message || error.message || "Error desconocido";
      const sentMessage = await wbot.sendMessage(msg.key.remoteJid!, {
        text: `Disculpe, hubo un error al procesar su mensaje de audio: ${errorMessage}`,
      });
      await verifyMessage(sentMessage!, ticket, contact);
    }
  }
};

export default handleOpenAi;

