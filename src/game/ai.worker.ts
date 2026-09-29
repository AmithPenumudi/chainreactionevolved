import { chooseAIAction, type AIAction, type AIDifficulty } from "./ai";
import type { GameState } from "./engine";

/** Runs the (potentially slow) AI search off the UI thread. */
interface Request {
  id: number;
  state: GameState;
  difficulty: AIDifficulty;
}

export interface Response {
  id: number;
  action: AIAction | null;
  error?: string;
}

const scope = self as unknown as {
  onmessage: ((e: { data: Request }) => void) | null;
  postMessage: (msg: Response) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, action: chooseAIAction(data.state, data.difficulty) });
  } catch (err) {
    scope.postMessage({ id: data.id, action: null, error: String(err) });
  }
};
