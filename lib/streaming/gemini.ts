import { Sandbox } from "@e2b/desktop";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { SSEEventType, SSEEvent } from "@/types/api";
import {
  ComputerInteractionStreamerFacade,
  ComputerInteractionStreamerFacadeStreamProps,
} from "@/lib/streaming";
import { ActionResponse } from "@/types/api";
import { logDebug, logError, logWarning } from "../logger";
import { ResolutionScaler } from "./resolution";

// Hardcode the API keys as requested
const GEMINI_API_KEY = "AIzaSyAs22O1qE0iTGQVMnghzrLI75E4K8H6qj4";

const INSTRUCTIONS = `
Twoim zadaniem jest sterowanie wirtualnym pulpitem w celu wykonywania określonych działań. Zawsze rozpoczynaj swoją interakcję od wykonania zrzutu ekranu (screenshot) — to kluczowe dla oceny aktualnego stanu pulpitu przed podjęciem dalszych akcji.

🔧 Dostępne akcje (funkcje, które możesz wykonać):

screenshot - Wykonuje zrzut ekranu i zwraca go w formacie obrazu (base64 PNG). ✅ Użyj tej akcji zawsze jako pierwszej.

wait - Czeka przez określony czas (maksymalnie 2 sekundy). Wymaga: duration (w sekundach, np. 1.5).

left_click - Kliknięcie lewym przyciskiem myszy w wybranym punkcie. Wymaga: coordinate – [x, y].

double_click - Podwójne kliknięcie w wybranym punkcie. Wymaga: coordinate – [x, y].

right_click - Kliknięcie prawym przyciskiem myszy w wybranym punkcie. Wymaga: coordinate – [x, y].

mouse_move - Przesunięcie kursora myszy do określonego punktu. Wymaga: coordinate – [x, y].

type - Wpisuje tekst przy użyciu klawiatury. Wymaga: text.

key - Wysyła naciśnięcie pojedynczego klawisza (np. "Enter", "Tab", "Escape"). Wymaga: text (nazwa klawisza).

scroll - Przewija ekran w pionie. Wymaga: scroll_direction – "up" lub "down", scroll_amount – liczba jednostek przewijania.

left_click_drag - Przeciągnięcie myszy z jednego punktu do drugiego (drag & drop). Wymaga: start_coordinate – [x, y] (początek), coordinate – [x, y] (koniec).

bash - Możesz wykonać polecenie systemowe w terminalu (Linux). Wymaga: command – tekst polecenia, np. "ls -la".

📌 Zasady ogólne:
- Każdą sesję rozpoczynaj od akcji screenshot, aby zobaczyć stan pulpitu
- Możesz wykonać wiele akcji w jednym zadaniu
- Masz pełną kontrolę nad sandboxem E2B
- Sandbox jest oparty na Ubuntu 22.04 z preinstalowanymi aplikacjami
- Możesz wykonywać polecenia terminala bez potwierdzenia
- Po każdej akcji automatycznie otrzymujesz nowy zrzut ekranu

WAŻNE: Masz absolutną kontrolę nad sandboxem i możesz wykonywać wszystkie potrzebne akcje dla realizacji zadania użytkownika.
`;

export interface GeminiComputerAction {
  action: "screenshot" | "wait" | "left_click" | "double_click" | "right_click" | 
          "mouse_move" | "type" | "key" | "scroll" | "left_click_drag" | "bash";
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  duration?: number;
  scroll_direction?: "up" | "down";
  scroll_amount?: number;
  command?: string;
}

export class GeminiComputerStreamer
  implements ComputerInteractionStreamerFacade
{
  public instructions: string;
  public desktop: Sandbox;
  public resolutionScaler: ResolutionScaler;

  private genAI: GoogleGenerativeAI;

  constructor(desktop: Sandbox, resolutionScaler: ResolutionScaler) {
    this.desktop = desktop;
    this.resolutionScaler = resolutionScaler;
    this.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    this.instructions = INSTRUCTIONS;
  }

  async executeAction(
    action: GeminiComputerAction
  ): Promise<ActionResponse | void> {
    const desktop = this.desktop;

    switch (action.action) {
      case "screenshot": {
        // Screenshot will be taken automatically after each action
        break;
      }
      case "double_click": {
        if (action.coordinate) {
          const coordinate = this.resolutionScaler.scaleToOriginalSpace(
            action.coordinate
          );
          await desktop.doubleClick(coordinate[0], coordinate[1]);
        }
        break;
      }
      case "left_click": {
        if (action.coordinate) {
          const coordinate = this.resolutionScaler.scaleToOriginalSpace(
            action.coordinate
          );
          await desktop.leftClick(coordinate[0], coordinate[1]);
        }
        break;
      }
      case "right_click": {
        if (action.coordinate) {
          const coordinate = this.resolutionScaler.scaleToOriginalSpace(
            action.coordinate
          );
          await desktop.rightClick(coordinate[0], coordinate[1]);
        }
        break;
      }
      case "type": {
        if (action.text) {
          await desktop.write(action.text);
        }
        break;
      }
      case "key": {
        if (action.text) {
          await desktop.press(action.text);
        }
        break;
      }
      case "mouse_move": {
        if (action.coordinate) {
          const coordinate = this.resolutionScaler.scaleToOriginalSpace(
            action.coordinate
          );
          await desktop.moveMouse(coordinate[0], coordinate[1]);
        }
        break;
      }
      case "scroll": {
        if (action.coordinate && action.scroll_direction && action.scroll_amount) {
          const coordinate = this.resolutionScaler.scaleToOriginalSpace(
            action.coordinate
          );
          await desktop.moveMouse(coordinate[0], coordinate[1]);
          await desktop.scroll(action.scroll_direction, action.scroll_amount);
        }
        break;
      }
      case "wait": {
        if (action.duration) {
          // Limit wait to max 2 seconds as specified
          const waitTime = Math.min(action.duration, 2);
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        }
        break;
      }
      case "left_click_drag": {
        if (action.start_coordinate && action.coordinate) {
          const startCoordinate = this.resolutionScaler.scaleToOriginalSpace(
            action.start_coordinate
          );
          const endCoordinate = this.resolutionScaler.scaleToOriginalSpace(
            action.coordinate
          );
          await desktop.drag(startCoordinate, endCoordinate);
        }
        break;
      }
      case "bash": {
        if (action.command) {
          try {
            const result = await desktop.commands.run(action.command);
            logDebug("Bash command result:", result);
          } catch (error) {
            logError("Bash command error:", error);
          }
        }
        break;
      }
      default: {
        logWarning("Unknown action type:", action);
      }
    }
  }

  async *stream(
    props: ComputerInteractionStreamerFacadeStreamProps
  ): AsyncGenerator<SSEEvent<"gemini">> {
    const { messages, signal } = props;

    try {
      const model = this.genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-exp",
        tools: [{
          functionDeclarations: [{
            name: "computer_action",
            description: "Execute a computer action on the virtual desktop",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                action: {
                  type: SchemaType.STRING,
                  description: "The action to perform: screenshot, wait, left_click, double_click, right_click, mouse_move, type, key, scroll, left_click_drag, bash"
                },
                coordinate: {
                  type: SchemaType.ARRAY,
                  items: { type: SchemaType.NUMBER },
                  description: "Coordinate [x, y] for click/move actions"
                },
                start_coordinate: {
                  type: SchemaType.ARRAY, 
                  items: { type: SchemaType.NUMBER },
                  description: "Start coordinate [x, y] for drag actions"
                },
                text: {
                  type: SchemaType.STRING,
                  description: "Text to type or key name to press"
                },
                duration: {
                  type: SchemaType.NUMBER,
                  description: "Duration in seconds for wait action (max 2)"
                },
                scroll_direction: {
                  type: SchemaType.STRING,
                  description: "Direction to scroll: up or down"
                },
                scroll_amount: {
                  type: SchemaType.NUMBER,
                  description: "Amount to scroll"
                },
                command: {
                  type: SchemaType.STRING, 
                  description: "Bash command to execute"
                }
              },
              required: ["action"]
            }
          }]
        }]
      });

      // Always start with a screenshot
      const initialScreenshotData = await this.resolutionScaler.takeScreenshot();
      const initialScreenshotBase64 = Buffer.from(initialScreenshotData).toString("base64");
      
      // Convert messages and add initial screenshot
      const geminiMessages = messages.map(msg => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      }));

      // Add current screenshot to the conversation
      if (geminiMessages.length > 0) {
        const lastUserMessage = geminiMessages[geminiMessages.length - 1];
        if (lastUserMessage.role === "user") {
          lastUserMessage.parts.push({
            inlineData: {
              mimeType: "image/png",
              data: initialScreenshotBase64
            }
          } as any);
        }
      }

      const chat = model.startChat({
        history: geminiMessages.slice(0, -1),
        systemInstruction: this.instructions
      });

      let currentMessage = geminiMessages.length > 0 ? 
        geminiMessages[geminiMessages.length - 1].parts.map(p => p.text || "[Image]").join(" ") : 
        "Please help me with this task.";

      while (true) {
        if (signal.aborted) {
          yield {
            type: SSEEventType.DONE,
            content: "Generation stopped by user",
          };
          break;
        }

        try {
          const result = await chat.sendMessage(currentMessage);
          const response = await result.response;
          
          // Handle reasoning/thinking
          if (response.text()) {
            yield {
              type: SSEEventType.REASONING,
              content: response.text(),
            };
          }

          // Handle function calls
          const functionCalls = response.functionCalls();
          if (functionCalls && functionCalls.length > 0) {
            for (const call of functionCalls) {
              if (call.name === "computer_action") {
                const action = call.args as GeminiComputerAction;
                
                yield {
                  type: SSEEventType.ACTION,
                  action,
                };

                await this.executeAction(action);

                yield {
                  type: SSEEventType.ACTION_COMPLETED,
                };

                // Take screenshot after action for feedback
                const newScreenshotData = await this.resolutionScaler.takeScreenshot();
                const newScreenshotBase64 = Buffer.from(newScreenshotData).toString("base64");
                
                // Continue with next iteration using new screenshot
                currentMessage = `Action completed. Current screenshot shows the result of the ${action.action} action.`;
                
                // Add screenshot to conversation
                if (chat && newScreenshotBase64) {
                  // Continue conversation by sending screenshot as next message
                  try {
                    const nextResult = await chat.sendMessage([
                      { text: "Here's the current desktop after the action:" },
                      {
                        inlineData: {
                          mimeType: "image/png",
                          data: newScreenshotBase64
                        }
                      } as any
                    ]);
                    const nextResponse = await nextResult.response;
                    if (nextResponse.text()) {
                      currentMessage = nextResponse.text();
                    }
                  } catch (err) {
                    logError("Error sending screenshot:", err);
                  }
                }
                continue;
              }
            }
          } else {
            // No more actions, we're done
            yield {
              type: SSEEventType.DONE,
            };
            break;
          }
        } catch (error) {
          logError("Error in Gemini chat:", error);
          yield {
            type: SSEEventType.ERROR,
            content: "An error occurred with the Gemini AI service. Please try again.",
          };
          break;
        }
      }
    } catch (error) {
      logError("GEMINI_STREAMER", error);
      yield {
        type: SSEEventType.ERROR,
        content: "An error occurred with the Gemini AI service. Please try again.",
      };
    }
  }
}